import Link from "next/link";
import { CreditCard, Lock } from "lucide-react";
import type { BillingState } from "@/lib/billing";

/** Slim bar for owners during the trial, or when a payment has failed. */
export function TrialBar({ state }: { state: BillingState }) {
  const failed = state.kind === "past_due";
  return (
    <div className={`print:hidden flex items-center justify-between gap-3 px-4 py-2 text-xs ${failed ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-900"}`}>
      <span>
        {failed
          ? "Your last payment didn't go through."
          : `Free trial: ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left.`}
      </span>
      <Link href="/billing" className="flex-shrink-0 rounded-lg bg-white/70 px-2.5 py-1 font-semibold hover:bg-white">
        {failed ? "Update card" : "Subscribe"}
      </Link>
    </div>
  );
}

/** Shown instead of the page once the trial has ended without a subscription. */
export function BillingLock({ isOwner, hadSubscription = false }: { isOwner: boolean; hadSubscription?: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-600"><Lock size={24} /></span>
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{hadSubscription ? "Your subscription has ended" : "Your free trial has ended"}</h1>
      {isOwner ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Subscribe to carry on where you left off. Your customers, rounds and history are all still here.
          </p>
          <Link href="/billing" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">
            <CreditCard size={16} /> Subscribe for £9.99/month
          </Link>
          <p className="text-xs text-slate-400">You can still download a backup or export your data from Settings → Data.</p>
        </>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This business&apos;s Wyndos subscription needs renewing. Please ask the owner to subscribe.
        </p>
      )}
    </div>
  );
}
