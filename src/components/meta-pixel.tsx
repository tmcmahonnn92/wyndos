"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Meta (Facebook) Pixel, for measuring Facebook adverts. Only on the public pages (the website,
 * sign-up, guides), never inside the app (customers' details stay out of Meta), and only after
 * the visitor agrees (UK PECR / GDPR: advertising cookies need consent).
 * The choice is kept on the device; it can be changed on the Cookie Policy page.
 */
export const META_PIXEL_ID = "274026224259554";
export const ADS_CONSENT_KEY = "wyndos-ads-consent";

const PUBLIC = [/^\/auth\/signin$/, /^\/auth\/signup$/, /^\/guide(\/|$)/, /^\/cookies$/, /^\/privacy$/, /^\/terms$/];

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: unknown };
declare global { interface Window { fbq?: Fbq; _fbq?: Fbq } }

function consent(): "yes" | "no" | null {
  try { const v = localStorage.getItem(ADS_CONSENT_KEY); return v === "yes" || v === "no" ? v : null; } catch { return null; }
}

/** Meta's standard loader (from the Pixel code), run only after consent. */
function load() {
  if (typeof window === "undefined" || window.fbq) return;
  const n: Fbq = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args); else n.queue!.push(args);
  } as Fbq;
  window.fbq = n; if (!window._fbq) window._fbq = n;
  n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
  const t = document.createElement("script");
  t.async = true; t.src = "https://connect.facebook.net/en_US/fbevents.js";
  const s = document.getElementsByTagName("script")[0];
  s.parentNode!.insertBefore(t, s);
  window.fbq("init", META_PIXEL_ID);
}

/** Tell Meta about something (e.g. a sign-up). Does nothing without consent. */
export function trackMeta(event: string, data?: Record<string, unknown>) {
  if (consent() !== "yes") return;
  load();
  try { window.fbq?.("track", event, data); } catch {}
}

export function MetaPixel() {
  const pathname = usePathname() ?? "";
  const onPublicPage = PUBLIC.some((r) => r.test(pathname));
  const [choice, setChoice] = useState<"yes" | "no" | null | "unknown">("unknown");

  useEffect(() => { setChoice(consent()); }, []);
  useEffect(() => {
    const onChange = () => setChoice(consent());
    window.addEventListener("wyndos-ads-consent", onChange);
    return () => window.removeEventListener("wyndos-ads-consent", onChange);
  }, []);
  // A page view on each public page visited, once they've agreed.
  useEffect(() => {
    if (!onPublicPage || choice !== "yes") return;
    load();
    window.fbq?.("track", "PageView");
  }, [pathname, onPublicPage, choice]);

  if (!onPublicPage || choice !== null) return null;
  const decide = (v: "yes" | "no") => {
    try { localStorage.setItem(ADS_CONSENT_KEY, v); } catch {}
    setChoice(v);
  };
  return (
    <div role="dialog" aria-label="Cookies" className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-2xl sm:inset-x-auto sm:right-4 sm:left-auto">
      <p>
        Can we use cookies to see whether our Facebook adverts work? They&apos;re set by Meta and only on this website,
        never inside the app. <a href="/cookies" className="font-semibold text-blue-700 underline">Cookie Policy</a>
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => decide("yes")} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">Allow</button>
        <button type="button" onClick={() => decide("no")} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700">No thanks</button>
      </div>
    </div>
  );
}

/** "Change my choice" on the Cookie Policy page. */
export function AdsConsentChoice() {
  const [choice, setChoice] = useState<"yes" | "no" | null | "unknown">("unknown");
  useEffect(() => { setChoice(consent()); }, []);
  if (choice === "unknown") return null;
  const set = (v: "yes" | "no") => {
    try { localStorage.setItem(ADS_CONSENT_KEY, v); } catch {}
    setChoice(v);
    window.dispatchEvent(new Event("wyndos-ads-consent"));
    // Turning it off: remove Meta's cookies set on this site and stop the pixel for this visit.
    if (v === "no") {
      for (const name of ["_fbp", "_fbc"]) document.cookie = `${name}=; Max-Age=0; path=/; domain=.${location.hostname.replace(/^www\./, "")}`;
      for (const name of ["_fbp", "_fbc"]) document.cookie = `${name}=; Max-Age=0; path=/`;
      if (window.fbq) location.reload();
    }
  };
  return (
    <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      Facebook advert cookies on this device: <strong>{choice === "yes" ? "allowed" : choice === "no" ? "not allowed" : "not chosen yet"}</strong>.{" "}
      {choice === "yes"
        ? <button type="button" onClick={() => set("no")} className="font-semibold text-blue-700 underline">Turn them off</button>
        : <button type="button" onClick={() => set("yes")} className="font-semibold text-blue-700 underline">Allow them</button>}
    </p>
  );
}
