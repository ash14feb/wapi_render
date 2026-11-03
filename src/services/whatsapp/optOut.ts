import { prisma } from "../../config/prisma";

/**
 * Opt-out ("STOP") handling.
 *
 * A contact that replies with an opt-out keyword gets the `opted_out` tag added
 * to `Contact.tags` (a comma-separated string). Every outbound send path —
 * campaigns, manual templates, free-text inbox replies, WhatsApp Flows, bot
 * replies and Shopify notifications — must check `isOptedOut()` first.
 *
 * The tag is cleared automatically when the contact messages the business
 * again, and can be removed manually by the business from Contacts.
 */

export const OPTED_OUT_TAG = "opted_out";

/** Keep in sync with the keyword list published in the Unifylead privacy policy. */
const OPT_OUT_KEYWORDS = ["stop", "unsubscribe", "opt out", "opt-out"];

export function splitTags(tags?: string | null): string[] {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function isOptedOut(tags?: string | null): boolean {
  return splitTags(tags).some((t) => t.toLowerCase() === OPTED_OUT_TAG);
}

/** True when inbound text is a request to stop receiving messages. */
export function isOptOutRequest(text?: string | null): boolean {
  if (!text) return false;
  return OPT_OUT_KEYWORDS.includes(text.trim().toLowerCase());
}

function withTag(tags: string | null | undefined, tag: string): string | null {
  const list = splitTags(tags);
  if (list.some((t) => t.toLowerCase() === tag.toLowerCase())) return list.join(",");
  const next = [...list, tag];
  return next.length > 0 ? next.join(",") : null;
}

function withoutTag(tags: string | null | undefined, tag: string): string | null {
  const next = splitTags(tags).filter((t) => t.toLowerCase() !== tag.toLowerCase());
  return next.length > 0 ? next.join(",") : null;
}

/** Adds `opted_out` without clobbering the contact's existing tags. */
export async function markOptedOut(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { tags: true },
  });
  if (!contact || isOptedOut(contact.tags)) return;
  await prisma.contact.update({
    where: { id: contactId },
    data: { tags: withTag(contact.tags, OPTED_OUT_TAG) },
  });
}

/** Re-subscribes a contact: removes `opted_out`, keeps every other tag. */
export async function clearOptOut(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { tags: true },
  });
  if (!contact || !isOptedOut(contact.tags)) return;
  await prisma.contact.update({
    where: { id: contactId },
    data: { tags: withoutTag(contact.tags, OPTED_OUT_TAG) },
  });
}

export const OPTED_OUT_MESSAGE =
  "This contact opted out of WhatsApp messages (reply STOP). Remove the 'opted_out' tag from the contact to message them again.";
