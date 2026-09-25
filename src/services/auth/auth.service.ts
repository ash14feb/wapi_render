import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma";
import type { LoginInput, RegisterInput } from "../../validators/auth.validator";

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "workspace"
  );
}

function signAccess(userId: string, tenantId: string, role: string): string {
  return jwt.sign({ userId, tenantId, role }, process.env.JWT_ACCESS_SECRET ?? "", {
    expiresIn: "15m",
  });
}

function signRefresh(userId: string, tenantId: string): string {
  return jwt.sign({ userId, tenantId, type: "refresh" }, process.env.JWT_REFRESH_SECRET ?? "", {
    expiresIn: "30d",
  });
}

function requireSecrets(): void {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new AuthError("SERVER_MISCONFIGURED", "JWT secrets are not configured", 500);
  }
}

export async function register(input: RegisterInput) {
  requireSecrets();
  const baseSlug = slugify(input.tenantName ?? input.email.split("@")[0] ?? "workspace");
  const slug = `${baseSlug}-${Date.now().toString(36)}`;
  const passwordHash = await bcrypt.hash(input.password, 10);

  // Email is unique per tenant; a fresh tenant means no conflict.
  const tenant = await prisma.tenant.create({
    data: { name: input.tenantName ?? "My workspace", slug, status: "ACTIVE" },
  });
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash,
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  return {
    accessToken: signAccess(user.id, tenant.id, user.role),
    refreshToken: signRefresh(user.id, tenant.id),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
  };
}

export async function login(input: LoginInput) {
  requireSecrets();
  const user = await prisma.user.findFirst({
    where: { email: input.email.toLowerCase(), status: "ACTIVE" },
    include: { tenant: true },
  });
  if (!user) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password", 401);

  return {
    accessToken: signAccess(user.id, user.tenantId, user.role),
    refreshToken: signRefresh(user.id, user.tenantId),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: { id: user.tenantId, name: user.tenant.name, slug: user.tenant.slug },
  };
}

export async function refresh(refreshToken: string) {
  requireSecrets();
  let payload: { userId: string; tenantId: string; type?: string };
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET ?? "") as typeof payload;
  } catch {
    throw new AuthError("INVALID_REFRESH_TOKEN", "Invalid or expired refresh token", 401);
  }
  if (payload.type !== "refresh") {
    throw new AuthError("INVALID_REFRESH_TOKEN", "Invalid refresh token", 401);
  }
  const user = await prisma.user.findFirst({
    where: { id: payload.userId, tenantId: payload.tenantId, status: "ACTIVE" },
  });
  if (!user) throw new AuthError("INVALID_REFRESH_TOKEN", "User no longer active", 401);
  return { accessToken: signAccess(user.id, user.tenantId, user.role) };
}

export async function me(userId: string, tenantId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    include: { tenant: true },
  });
  if (!user) throw new AuthError("NOT_FOUND", "User not found", 404);
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
  };
}
