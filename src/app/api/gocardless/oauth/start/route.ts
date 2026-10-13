import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { goCardlessOn } from "@/lib/trial-features";
import { oauthConfig, redirectUri, siteOrigin } from "@/lib/gocardless/oauth";

export const runtime = "nodejs";

/** Settings → "Connect GoCardless": off to GoCardless to log in (or sign up) and allow Wyndos. */
export async function GET(req: NextRequest) {
  const origin = siteOrigin(req.nextUrl.origin);
  const back = (msg: string) => NextResponse.redirect(`${origin}/settings?gc=${encodeURIComponent(msg)}`);
  const actor = await requireOwner().catch(() => null);
  if (!actor) return NextResponse.redirect(`${origin}/auth/signin`);
  if (!(await goCardlessOn(actor.tenantId))) return back("Direct Debit isn't switched on for your account.");
  const cfg = oauthConfig();
  if (!cfg) return back("GoCardless connect isn't set up on this server yet.");
  const s = await prisma.tenantSettings.findUnique({ where: { tenantId: actor.tenantId }, select: { businessName: true, email: true } });
  const state = randomBytes(24).toString("hex");
  const url = new URL(`${cfg.host}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("state", state);
  url.searchParams.set("initial_view", req.nextUrl.searchParams.get("signup") === "1" ? "signup" : "login");
  url.searchParams.set("prefill[country_code]", "GB");
  if (s?.email) url.searchParams.set("prefill[email]", s.email);
  if (s?.businessName) url.searchParams.set("prefill[organisation_name]", s.businessName);
  const res = NextResponse.redirect(url.toString());
  // Checked when GoCardless sends them back, so nobody else's code can be slipped in.
  res.cookies.set("gc_oauth_state", `${state}.${actor.tenantId}`, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
