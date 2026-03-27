"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { requestPasswordReset } from "@/lib/auth-actions";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setStatus("idle");
    setResetLink(null);

    startTransition(async () => {
      const result = await requestPasswordReset(email.trim());
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      if (result.emailSent) {
        setStatus("success");
        setMessage("If that email is registered, a reset link has been sent. Check your inbox.");
      } else {
        // No SMTP configured — show the link directly
        setStatus("success");
        setMessage("Email sending isn't configured yet. Use the link below to reset your password:");
        setResetLink(result.resetLink);
      }
    });
  };

  if (status === "success") {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-green-500/30 bg-green-500/10 px-5 py-4 text-sm text-green-300">
          {message}
        </div>

        {resetLink && (
          <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-5 py-4 text-sm space-y-3">
            <p className="text-slate-300 text-xs font-semibold uppercase tracking-wider">Your reset link</p>
            <Link
              href={resetLink}
              className="block break-all font-mono text-xs text-blue-400 hover:text-blue-300 underline"
            >
              {resetLink}
            </Link>
            <Link
              href={resetLink}
              className="inline-block mt-1 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              Go to reset page →
            </Link>
          </div>
        )}

        <p className="text-center text-sm text-slate-500">
          <Link href="/auth/signin" className="text-blue-400 hover:text-blue-300">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Email address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500"
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </div>

      {status === "error" && (
        <p className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Sending…" : "Send reset link"}
      </button>

      <p className="text-center text-sm text-slate-500">
        <Link href="/auth/signin" className="text-blue-400 hover:text-blue-300">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
