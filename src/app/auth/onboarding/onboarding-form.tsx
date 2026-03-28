"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { completeOwnerOnboarding } from "@/lib/auth-actions";

export function OnboardingForm({
  initialCompanyName,
  initialOwnerName,
}: {
  initialCompanyName: string;
  initialOwnerName: string;
}) {
  const { update } = useSession();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const fd = new FormData(e.currentTarget);
      const result = await completeOwnerOnboarding({
        companyName: fd.get("companyName") as string,
        ownerName: fd.get("ownerName") as string,
        phone: fd.get("phone") as string,
        address: fd.get("address") as string,
        website: fd.get("website") as string,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      await update({
        name: (fd.get("ownerName") as string) || initialOwnerName,
        onboardingComplete: true,
      });
      window.location.assign("/");
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Company / trading name <span className="text-red-400">*</span>
          </label>
          <input
            name="companyName"
            type="text"
            required
            defaultValue={initialCompanyName}
            placeholder="e.g. Smith Window Cleaning"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Your name <span className="text-red-400">*</span>
          </label>
          <input
            name="ownerName"
            type="text"
            required
            defaultValue={initialOwnerName}
            placeholder="e.g. Dave Smith"
            className={inputCls}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Phone number</label>
          <input
            name="phone"
            type="tel"
            placeholder="e.g. 07700 900000"
            className={inputCls}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Website</label>
          <input
            name="website"
            type="url"
            placeholder="https://example.com"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">Business address</label>
        <input
          name="address"
          type="text"
          placeholder="e.g. 12 High Street, Townsville"
          className={inputCls}
        />
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/30 p-4 text-sm text-slate-400">
        <p className="font-medium text-slate-300">What happens next?</p>
        <ul className="mt-2 space-y-1">
          <li>Your round dashboard will be ready immediately</li>
          <li>You can add areas and customers from the <strong className="text-slate-200">Areas</strong> and <strong className="text-slate-200">Customers</strong> pages</li>
          <li>Invite workers from <strong className="text-slate-200">Settings / Team</strong></li>
        </ul>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
      >
        {loading ? "Saving..." : "Finish setup and go to dashboard"}
      </button>
    </form>
  );
}
