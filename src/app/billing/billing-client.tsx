"use client";

import { useState } from "react";
import { Check, CreditCard, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { BillingState } from "@/lib/billing";

const FEATURES = [
  "Unlimited customers, areas and team members",
  "Drag-and-drop scheduler that keeps every round on cycle",
  "Day sheets, routes and one-tap job completion",
  "Payments, balances, invoices and VAT invoices",
  "Customer texts sent from your own phone",
  "Accounts, tax-year totals and backups",
];

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function BillingClient({ state, isOwner, justSubscribed, price, trialDays, ready }: {
  state: BillingState | null;
  isOwner: boolean;
  justSubscribed: boolean;
  price: string;
  trialDays: number;
  ready: boolean;
}) {
  const [busy, setBusy] = useState<"" | "checkout" | "portal">("");
  const [error, setError] = useState("");

  const go = async (kind: "checkout" | "portal") => {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch(`/api/stripe/${kind}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || `Something went wrong (${res.status}).`);
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy("");
    }
  };

  const kind = state?.kind ?? "ended";
  const subscribed = kind === "subscribed" || kind === "past_due";

  let headline = "";
  let sub = "";
  if (kind === "free") { headline = "You're all set"; sub = "Nothing to pay on this account."; }
  else if (kind === "subscribed") {
    headline = state?.cancelAtPeriodEnd ? "Subscription ending" : "Subscribed";
    sub = state?.currentPeriodEnd
      ? state.cancelAtPeriodEnd ? `You'll keep access until ${day(state.currentPeriodEnd)}.` : `Next payment ${day(state.currentPeriodEnd)}.`
      : "Thanks for using Wyndos.";
  } else if (kind === "past_due") { headline = "Payment didn't go through"; sub = "Please update your card so nothing is interrupted."; }
  else if (kind === "trial") {
    headline = `${state?.daysLeft} day${state?.daysLeft === 1 ? "" : "s"} left of your free trial`;
    sub = `Your trial ends ${state ? day(state.trialEndsAt) : ""}. Subscribe any time: you won't be charged until it ends.`;
  } else { headline = state?.hadSubscription ? "Your subscription has ended" : "Your free trial has ended"; sub = "Subscribe to carry on. Everything you've set up is still here."; }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-5">
      <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100"><CreditCard size={20} className="text-blue-600" /> Billing</h1>

      {justSubscribed && subscribed && (
        <p className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">Thank you! Your subscription is set up.</p>
      )}

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{headline}</p>
            <p className="text-sm text-slate-500">{sub}</p>
          </div>

          {kind !== "free" && (
            <div className="rounded-xl border border-slate-200 p-4 dark:border-[#1E2840]">
              <p className="text-sm text-slate-500">Wyndos, everything included</p>
              <p className="mt-1 text-3xl font-bold text-slate-800 dark:text-slate-100">{price}<span className="text-base font-medium text-slate-500"> / month</span></p>
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                {FEATURES.map((f) => <li key={f} className="flex items-start gap-2"><Check size={15} className="mt-0.5 flex-shrink-0 text-green-600" />{f}</li>)}
              </ul>
              {!subscribed && <p className="mt-3 text-xs text-slate-400">{trialDays}-day free trial, no card needed to start. Cancel any time.</p>}
            </div>
          )}

          {!isOwner && kind !== "free" && (
            <p className="text-sm text-slate-600">Only the business owner can manage the subscription.</p>
          )}

          {isOwner && kind !== "free" && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {!subscribed && (
                <Button className="flex-1" disabled={busy !== ""} onClick={() => (ready ? go("checkout") : setError("Payments aren't switched on on the server yet (STRIPE_SECRET_KEY missing). Please contact support."))}>
                  {busy === "checkout" ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                  Subscribe for {price}/month
                </Button>
              )}
              {subscribed && (
                <Button className="flex-1" variant={kind === "past_due" ? "primary" : "outline"} disabled={busy !== ""} onClick={() => go("portal")}>
                  {busy === "portal" ? <Loader2 size={15} className="animate-spin" /> : null}
                  {kind === "past_due" ? "Update card" : "Manage billing, invoices or cancel"}
                </Button>
              )}
            </div>
          )}
          {!ready && isOwner && kind !== "free" && <p className="text-xs text-amber-700">Payments aren&apos;t switched on yet. Please contact support.</p>}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <p className="text-[11px] text-slate-400">Payments are handled securely by Stripe. Wyndos never sees your card details.</p>
        </CardContent>
      </Card>
    </div>
  );
}
