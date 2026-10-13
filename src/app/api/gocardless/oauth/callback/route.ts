import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/guards";
import { finishConnect, siteOrigin } from "@/lib/gocardless/oauth";

export const runtime = "nodejs";

/** GoCardless sends the owner back here after they allow (or refuse) Wyndos. */
export async function GET(req: NextRequest) {
  const origin = siteOrigin(req.nextUrl.origin);
  const p = req.nextUrl.searchParams;
  const back = (msg: string) => {
    const res = NextResponse.redirect(`${origin}/settings?gc=${encodeURIComponent(msg)}`);
    res.cookies.delete("gc_oauth_state");
    return res;
  };
  const actor = await requireOwner().catch(() => null);
  if (!actor) return NextResponse.redirect(`${origin}/auth/signin`);
  if (p.get("error")) return back(p.get("error") === "access_denied" ? "You didn't allow Wyndos in GoCardless, so nothing changed." : `GoCardless: ${p.get("error_description") || p.get("error")}`);
  const [state, tenant] = (req.cookies.get("gc_oauth_state")?.value ?? "").split(".");
  if (!state || state !== p.get("state") || Number(tenant) !== actor.tenantId) return back("That link had expired or didn't match. Press Connect GoCardless again.");
  const code = p.get("code");
  if (!code) return back("GoCardless didn't send a code back. Press Connect GoCardless again.");
  try {
    await finishConnect(actor.tenantId, code, origin);
    return back("connected");
  } catch (e) {
    return back(e instanceof Error ? e.message : "Couldn't connect GoCardless.");
  }
}
