"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/lib/auth-actions";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.58 2.68-3.91 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.33l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33c.71-2.12 2.7-3.7 5.04-3.7Z" />
    </svg>
  );
}

export function InviteAcceptForm({
  token,
  email,
  googleEnabled,
  signedInEmail,
}: {
  token: string;
  email: string;
  googleEnabled: boolean;
  signedInEmail: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const isSignedInAsInvite = (signedInEmail ?? "").toLowerCase() === email.toLowerCase();
  const inviteCallbackUrl = `/auth/invite/${token}`;

  const inputCls =
    "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  async function handleJoinExistingAccount() {
    setError("");
    setLoading(true);

    try {
      const result = await acceptInvite({ token });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError("");
    setGoogleLoading(true);
    await signIn("google", { callbackUrl: inviteCallbackUrl });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const fd = new FormData(e.currentTarget);
      const name = fd.get("name") as string;
      const password = fd.get("password") as string;
      const confirm = fd.get("confirm") as string;

      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }

      const result = await acceptInvite({ token, name, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const resp = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (resp?.error) {
        setError("Account created but sign-in failed. Please sign in manually.");
        router.push("/auth/signin");
        return;
      }

      router.push("/");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {signedInEmail && !isSignedInAsInvite ? (
        <div className="space-y-3 rounded-2xl border border-amber-800/60 bg-amber-950/30 p-4">
          <p className="text-sm text-amber-200">
            You&apos;re signed in as <strong>{signedInEmail}</strong>. This invite is for <strong>{email}</strong>.
          </p>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: inviteCallbackUrl })}
            className="w-full rounded-xl border border-amber-500/40 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/40"
          >
            Sign out and use the invited account
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
            <p className="text-sm text-slate-300">
              Already have an account with <strong className="text-slate-100">{email}</strong>? Sign in first, then accept the invite.
            </p>
            {isSignedInAsInvite ? (
              <button
                type="button"
                onClick={handleJoinExistingAccount}
                disabled={loading}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
              >
                {loading ? "Joining company…" : "Accept invite with this account"}
              </button>
            ) : (
              <div className="space-y-2">
                <Link
                  href={`/auth/signin?callbackUrl=${encodeURIComponent(inviteCallbackUrl)}`}
                  className="block w-full rounded-xl border border-slate-600 px-4 py-3 text-center text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
                >
                  Sign in with email
                </Link>
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={!googleEnabled || googleLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-400 disabled:opacity-70"
                >
                  <GoogleMark />
                  {googleEnabled ? (googleLoading ? "Redirecting to Google..." : "Continue with Google") : "Google sign-in is not configured"}
                </button>
              </div>
            )}
          </div>

          {!signedInEmail && (
            <>
              <div className="relative py-1 text-center">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-800" />
                <span className="relative bg-slate-900 px-3 text-xs uppercase tracking-[0.25em] text-slate-500">or create a new account</span>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">Your full name</label>
                  <input name="name" type="text" required placeholder="e.g. Jane Smith" className={inputCls} />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">Create a password</label>
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    placeholder="Minimum 8 characters"
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">Confirm password</label>
                  <input
                    name="confirm"
                    type="password"
                    required
                    minLength={8}
                    placeholder="Repeat your password"
                    className={inputCls}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
                >
                  {loading ? "Creating account…" : "Create account and join"}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  );
}
