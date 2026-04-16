import { createHmac } from "node:crypto";
import { cookies } from "next/headers";

const PASSKEY_CHALLENGE_COOKIE = "wyndos_passkey_challenge";

type ChallengeAction = "register" | "authenticate";

type StoredChallenge = {
  action: ChallengeAction;
  challenge: string;
  userId?: string;
  email?: string;
  expiresAt: number;
};

type PasskeyGrantPayload = {
  userId: string;
  expiresAt: number;
};

function getAuthSecret() {
  if (process.env.AUTH_SECRET) {
    return process.env.AUTH_SECRET;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production.");
  }

  return "dev-secret-change-me";
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function getPasskeyRpID() {
  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.APP_URL || "http://localhost:3000";
  return new URL(baseUrl).hostname;
}

export function getPasskeyOrigin() {
  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.APP_URL || "http://localhost:3000";
  return new URL(baseUrl).origin;
}

export async function storePasskeyChallenge(payload: StoredChallenge) {
  const cookieStore = await cookies();
  cookieStore.set(PASSKEY_CHALLENGE_COOKIE, encodeBase64Url(JSON.stringify(payload)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 5,
  });
}

export async function readPasskeyChallenge(expectedAction: ChallengeAction) {
  const cookieStore = await cookies();
  const rawValue = cookieStore.get(PASSKEY_CHALLENGE_COOKIE)?.value;
  if (!rawValue) return null;

  try {
    const parsed = JSON.parse(decodeBase64Url(rawValue)) as StoredChallenge;
    if (parsed.action !== expectedAction) return null;
    if (parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPasskeyChallenge() {
  const cookieStore = await cookies();
  cookieStore.set(PASSKEY_CHALLENGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function createPasskeyGrant(userId: string) {
  const payload: PasskeyGrantPayload = {
    userId,
    expiresAt: Date.now() + 1000 * 60 * 3,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", getAuthSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function verifyPasskeyGrant(grant: string | null | undefined) {
  if (!grant || !grant.includes(".")) return null;

  const [encodedPayload, signature] = grant.split(".");
  const expected = createHmac("sha256", getAuthSecret()).update(encodedPayload).digest("base64url");
  if (signature !== expected) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as PasskeyGrantPayload;
    if (!payload.userId || payload.expiresAt < Date.now()) return null;
    return payload.userId;
  } catch {
    return null;
  }
}