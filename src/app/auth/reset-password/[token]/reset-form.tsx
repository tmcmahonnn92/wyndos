"use client";

import Link from "next/link";
import { FormEvent, useState, useTransition } from "react";
import { resetPassword } from "@/lib/auth-actions";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMessage("");
    if (password !== confirm) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }
    startTransition(async () => {
      const result = await resetPassword(token, password);
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error ?? "Something went wrong.");
      } else {
        setStatus("success");
        setMessage("Password updated successfully! You can now sign in.");
      }
    });
  };

  if (status === "success") {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-green-500/30 bg-green-500/10 px-5 py-4 text-sm text-green-300">
          {message}
        </div>
        <Link
          href="/auth/signin"
          className="block w-full rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            New password
          </label>
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            {showPw ? "Hide" : "Show"}
          </button>
        </div>
        <input
          type={showPw ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          Confirm password
        </label>
        <input
          type={showPw ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500"
          placeholder="Repeat new password"
          autoComplete="new-password"
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
        {isPending ? "Updating…" : "Set new password"}
      </button>

      <p className="text-center text-sm text-slate-500">
        <Link href="/auth/forgot-password" className="text-blue-400 hover:text-blue-300">
          Request a different link
        </Link>
      </p>
    </form>
  );
}
