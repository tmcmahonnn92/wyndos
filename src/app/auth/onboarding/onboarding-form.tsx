"use client";

import { useState } from "react";
import { completeOwnerOnboarding } from "@/lib/auth-actions";

const CUSTOMER_COUNTS = ["Just starting", "Under 100", "100–300", "300–600", "600+"];
const TEAM_SIZES = ["Just me", "Me + 1 or 2", "3 or more cleaners"];
const PAYMENT_METHODS = ["Cash", "Bank transfer", "Card", "Direct Debit", "Cheque"];
const HEARD_FROM = ["Google", "Facebook group", "Another window cleaner", "Social media", "Other"];
const START_OPTIONS = [
  { href: "/customers/import", title: "Import my customers", desc: "Upload a spreadsheet (CSV or Excel). Areas are made for you." },
  { href: "/customers?action=new-customer", title: "Add customers one by one", desc: "Good if you're just starting out." },
  { href: "/", title: "Just look around", desc: "Head to the dashboard. You can import any time." },
];

const STEPS = ["Your business", "How you work", "Get going"];

export function OnboardingForm({
  initialCompanyName,
  initialOwnerName,
}: {
  initialCompanyName: string;
  initialOwnerName: string;
}) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [ownerName, setOwnerName] = useState(initialOwnerName);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");

  const [customerCount, setCustomerCount] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [payments, setPayments] = useState<string[]>([]);
  const [bankDetails, setBankDetails] = useState("");
  const [heardFrom, setHeardFrom] = useState("");

  const [startAt, setStartAt] = useState(START_OPTIONS[0].href);

  const next = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (step === 0 && (!companyName.trim() || !ownerName.trim())) {
      setError("Add your business name and your name.");
      return;
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    void finish();
  };

  async function finish() {
    setLoading(true);
    try {
      const result = await completeOwnerOnboarding({
        companyName, ownerName, phone, address, website,
        customerCount, teamSize, paymentMethods: payments, heardFrom,
        bankDetails: payments.includes("Bank transfer") ? bankDetails : "",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      window.location.assign(startAt);
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
  const labelCls = "mb-1.5 block text-xs font-medium text-slate-400";
  const chip = (on: boolean) =>
    `rounded-xl border px-3 py-2 text-sm font-medium transition ${on ? "border-blue-500 bg-blue-600/20 text-white" : "border-slate-700 text-slate-300 hover:border-slate-500"}`;

  return (
    <form onSubmit={next} className="space-y-5">
      {/* Progress */}
      <ol className="flex gap-2" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={`h-1.5 rounded-full ${i <= step ? "bg-blue-500" : "bg-slate-700"}`} />
            <p className={`mt-1.5 text-[11px] font-medium ${i === step ? "text-white" : "text-slate-500"}`} aria-current={i === step ? "step" : undefined}>
              {i + 1}. {s}
            </p>
          </li>
        ))}
      </ol>

      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">{error}</p>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ob-company">Business / trading name <span className="text-red-400">*</span></label>
              <input id="ob-company" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Smith Window Cleaning" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="ob-owner">Your name <span className="text-red-400">*</span></label>
              <input id="ob-owner" required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Dave Smith" className={inputCls} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ob-phone">Business phone</label>
              <input id="ob-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 07700 900000" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="ob-web">Website or Facebook page</label>
              <input id="ob-web" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="optional" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="ob-address">Business address</label>
            <input id="ob-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12 High Street, Worksop, S80 1AA" className={inputCls} />
          </div>
          <p className="text-xs text-slate-500">Your phone and name go on texts and invoices to customers.</p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <fieldset>
            <legend className={labelCls}>Roughly how many customers?</legend>
            <div className="flex flex-wrap gap-2">
              {CUSTOMER_COUNTS.map((c) => (
                <button key={c} type="button" aria-pressed={customerCount === c} onClick={() => setCustomerCount(c)} className={chip(customerCount === c)}>{c}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className={labelCls}>Who does the cleaning?</legend>
            <div className="flex flex-wrap gap-2">
              {TEAM_SIZES.map((t) => (
                <button key={t} type="button" aria-pressed={teamSize === t} onClick={() => setTeamSize(t)} className={chip(teamSize === t)}>{t}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className={labelCls}>How do customers pay you? <span className="text-slate-500">(pick all that apply)</span></legend>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => {
                const on = payments.includes(m);
                return (
                  <button key={m} type="button" aria-pressed={on} onClick={() => setPayments(on ? payments.filter((x) => x !== m) : [...payments, m])} className={chip(on)}>{m}</button>
                );
              })}
            </div>
          </fieldset>
          {payments.includes("Bank transfer") && (
            <div>
              <label className={labelCls} htmlFor="ob-bank">Bank details for customers</label>
              <input id="ob-bank" value={bankDetails} onChange={(e) => setBankDetails(e.target.value)} placeholder="e.g. Smith WC, sort code 12-34-56, account 12345678" className={inputCls} />
              <p className="mt-1 text-xs text-slate-500">Shown on invoices and &ldquo;windows cleaned, please pay&rdquo; texts. You can change it in Settings.</p>
            </div>
          )}
          <div>
            <label className={labelCls} htmlFor="ob-heard">How did you hear about Wyndos?</label>
            <select id="ob-heard" value={heardFrom} onChange={(e) => setHeardFrom(e.target.value)} className={inputCls}>
              <option value="">Choose…</option>
              {HEARD_FROM.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-slate-300">Where do you want to start?</p>
          <div role="radiogroup" aria-label="Where to start" className="space-y-2">
            {START_OPTIONS.map((o) => (
              <button key={o.href} type="button" role="radio" aria-checked={startAt === o.href} onClick={() => setStartAt(o.href)}
                className={`block w-full rounded-xl border px-4 py-3 text-left transition ${startAt === o.href ? "border-blue-500 bg-blue-600/15" : "border-slate-700 hover:border-slate-500"}`}>
                <span className="block text-sm font-semibold text-white">{o.title}</span>
                <span className="block text-xs text-slate-400">{o.desc}</span>
              </button>
            ))}
          </div>
          {teamSize && teamSize !== "Just me" && (
            <p className="rounded-xl border border-slate-700 bg-slate-800/30 px-4 py-3 text-xs text-slate-400">
              Invite your cleaners from <strong className="text-slate-200">Settings → Team</strong>. They get an email with a link to join.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3">
        {step > 0 && (
          <button type="button" onClick={() => { setError(""); setStep(step - 1); }}
            className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500">
            Back
          </button>
        )}
        <button type="submit" disabled={loading}
          className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60">
          {loading ? "Setting up…" : step < STEPS.length - 1 ? "Next" : "Finish setup"}
        </button>
      </div>
      {step === 1 && (
        <p className="text-center text-xs text-slate-500">All optional. It helps us set things up for you.</p>
      )}
    </form>
  );
}
