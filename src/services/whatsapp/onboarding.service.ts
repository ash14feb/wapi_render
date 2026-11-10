import { prisma } from "../../config/prisma";
import { config } from "../../config/env";
import { encryptToken } from "../../utils/crypto";
import {
  exchangeSignupCode,
  fetchPhoneProfile,
  listOwnedWabas,
  listWabaPhones,
  registerWabaPhone,
  subscribeAppToWaba,
} from "../meta/meta-client";
import { WhatsappServiceError } from "./whatsapp.service";
import type { CompleteOnboardingInput } from "../../validators/onboarding.validator";

export interface OnboardedAccount {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  businessName: string | null;
  status: string;
}

/**
 * Independent Tech Provider onboarding: exchange the Embedded Signup `code`
 * for a business token, subscribe our app, register numbers, store encrypted
 * tokens per number (multi-number capable). Profile enrichment is best-effort
 * and never fails the onboarding.
 */
export async function completeOnboarding(
  tenantId: string,
  input: CompleteOnboardingInput,
): Promise<{ accounts: OnboardedAccount[]; wabaId: string }> {
  if (!config.meta.appId || !config.meta.appSecret) {
    throw new WhatsappServiceError("META_NOT_CONFIGURED", "META_APP_ID / META_APP_SECRET are not set", 500);
  }

  const { accessToken } = await exchangeSignupCode({
    appId: config.meta.appId,
    appSecret: config.meta.appSecret,
    code: input.code,
    ...(config.meta.redirectUri ? { redirectUri: config.meta.redirectUri } : {}),
  }).catch((err: Error) => {
    throw new WhatsappServiceError("ONBOARDING_CODE_INVALID", err.message, 400);
  });
  let tokenForCleanup = accessToken;

  try {
    // Resolve WABA: explicit > single owned > error asking user to pick.
    // When explicit, it must appear in the caller's owned WABAs — otherwise a
    // tenant could claim a WABA (and its numbers) they don't actually own.
    let wabaId = input.wabaId;
    if (!wabaId) {
      if (!input.businessId) {
        throw new WhatsappServiceError("WABA_REQUIRED", "Provide wabaId or businessId to discover WABAs", 400);
      }
      const wabas = await listOwnedWabas(input.businessId, accessToken, config.meta.graphVersion);
      if (wabas.length === 0) throw new WhatsappServiceError("NO_WABA", "No WhatsApp Business Accounts found", 404);
      if (wabas.length > 1 && !input.wabaId) {
        throw new WhatsappServiceError(
          "MULTIPLE_WABAS",
          `Found ${wabas.length} accounts; provide wabaId`,
          409,
        );
      }
      wabaId = wabas[0].id;
    } else {
      if (!input.businessId) {
        throw new WhatsappServiceError(
          "BUSINESS_REQUIRED",
          "businessId is required to verify ownership of the requested WABA",
          400,
        );
      }
      const owned = await listOwnedWabas(input.businessId, accessToken, config.meta.graphVersion);
      if (!owned.some((w) => w.id === wabaId)) {
        throw new WhatsappServiceError("WABA_NOT_OWNED", "The requested WABA is not owned by this business", 403);
      }
    }

    await subscribeAppToWaba(wabaId, accessToken, config.meta.graphVersion).catch((err: Error) => {
      throw new WhatsappServiceError("SUBSCRIBE_FAILED", err.message, 502);
    });

    const phones = await listWabaPhones(wabaId, accessToken, config.meta.graphVersion);
    const available = new Set(phones.map((p) => p.id));
    const wanted = input.phoneNumberIds ?? phones.map((p) => p.id);
    if (wanted.length === 0) throw new WhatsappServiceError("NO_NUMBERS", "No phone numbers on this WABA", 404);

    // Only numbers actually listed on this WABA may be connected. Without
    // this, a client-supplied phoneNumberId would let a tenant register a
    // number that belongs to someone else's WABA.
    const foreign = wanted.filter((id) => !available.has(id));
    if (foreign.length > 0) {
      throw new WhatsappServiceError(
        "PHONE_NUMBER_NOT_OWNED",
        `Phone number(s) not on WABA ${wabaId}: ${foreign.join(", ")}`,
        403,
      );
    }

    const accounts: OnboardedAccount[] = [];
    for (const phoneNumberId of wanted) {
      // The number may already be connected elsewhere (e.g. a previous tenant).
      // Connecting it here would silently rebind the inbound webhook routing.
      const claimed = await prisma.whatsappAccount.findFirst({
        where: { phoneNumberId, NOT: { tenantId } },
        select: { id: true },
      });
      if (claimed) {
        throw new WhatsappServiceError(
          "PHONE_NUMBER_ALREADY_CONNECTED",
          `Phone number ${phoneNumberId} is already connected to another workspace`,
          409,
        );
      }

      await registerWabaPhone(phoneNumberId, accessToken, config.meta.graphVersion, input.pin).catch((err: Error) => {
        throw new WhatsappServiceError("REGISTER_FAILED", `${phoneNumberId}: ${err.message}`, 502);
      });

      // Best-effort profile enrichment — never fail onboarding on this.
      let businessName: string | null = null;
      let displayPhoneNumber: string | null = null;
      try {
        const profile = await fetchPhoneProfile(phoneNumberId, accessToken, config.meta.graphVersion);
        businessName = profile.verifiedName ?? null;
        displayPhoneNumber = profile.displayPhoneNumber ?? null;
      } catch {
        // keep nulls; backfilled on next sync/refresh
      }

      const saved = await prisma.whatsappAccount.upsert({
        where: { phoneNumberId },
        update: {
          wabaId,
          encryptedAccessToken: encryptToken(accessToken),
          status: "ACTIVE",
          ...(businessName ? { businessName } : {}),
          ...(displayPhoneNumber ? { displayPhoneNumber } : {}),
        },
        create: {
          tenantId,
          wabaId,
          phoneNumberId,
          encryptedAccessToken: encryptToken(accessToken),
          status: "ACTIVE",
          businessName,
          displayPhoneNumber,
        },
        select: { id: true, wabaId: true, phoneNumberId: true, displayPhoneNumber: true, businessName: true, status: true },
      });
      accounts.push(saved);
    }

    return { accounts, wabaId };
  } finally {
    tokenForCleanup = "";
  }
}

/** Public halves for the UI popup — never includes secrets. */
export function onboardingConfig(): { appId: string; configId: string; graphVersion: string } {
  return { appId: config.meta.appId, configId: config.meta.configId, graphVersion: config.meta.graphVersion };
}
