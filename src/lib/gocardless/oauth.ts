import "server-only";
import prisma from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/secrets";

/**
 * "Connect with GoCardless" (OAuth, Wyndos as a GoCardless partner app). Needs, in the server's env:
 *   GOCARDLESS_CLIENT_ID, GOCARDLESS_CLIENT_SECRET, GOCARDLESS_OAUTH_ENV (sandbox | live),
 *   and optionally GOCARDLESS_REDIRECT_URI (default: <site>/api/gocardless/oauth/callback).
 * The redirect URL must also be added to the app in GoCardless (exact match).
 */
export function oauthConfig() {
  const clientId = process.env.GOCARDLESS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOCARDLESS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const env = process.env.GOCARDLESS_OAUTH_ENV?.trim() === "live" ? "live" : "sandbox";
  return { clientId, clientSecret, env, host: env === "live" ? "https://connect.gocardless.com" : "https://connect-sandbox.gocardless.com" } as const;
}

/** The public site address (behind nginx the request's own origin can be http://localhost:3000). */
export function siteOrigin(reqOrigin: string) {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || reqOrigin).trim().replace(/\/+$/, "");
}

export function redirectUri(origin: string) {
  return process.env.GOCARDLESS_REDIRECT_URI?.trim() || `${origin}/api/gocardless/oauth/callback`;
}

/** Swap the code GoCardless sent back for the business's access token, and save it (encrypted). */
export async function finishConnect(tenantId: number, code: string, origin: string) {
  const cfg = oauthConfig();
  if (!cfg) throw new Error("GoCardless connect isn't set up on this server.");
  const res = await fetch(`${cfg.host}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin), client_id: cfg.clientId, client_secret: cfg.clientSecret }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; organisation_id?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(body.error_description || body.error || `GoCardless said no (${res.status}).`);
  await prisma.tenantSettings.update({
    where: { tenantId },
    data: {
      goCardlessAccessToken: encryptSecret(body.access_token),
      goCardlessEnvironment: cfg.env,
      goCardlessOrganisationId: body.organisation_id ?? null,
      goCardlessLastError: "",
    },
  });
}

/** Disconnect: tell GoCardless to cancel the token (if it came from Connect), then forget it. */
export async function disconnect(tenantId: number) {
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { goCardlessAccessToken: true, goCardlessOrganisationId: true } });
  const cfg = oauthConfig();
  const token = decryptSecret(s?.goCardlessAccessToken);
  if (cfg && token && s?.goCardlessOrganisationId) {
    await fetch(`${cfg.host}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    }).catch(() => undefined);
  }
  await prisma.tenantSettings.update({ where: { tenantId }, data: { goCardlessAccessToken: "", goCardlessOrganisationId: null } });
}
