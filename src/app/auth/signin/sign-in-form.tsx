"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState, useTransition } from "react";
import { signIn } from "next-auth/react";

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isGooglePending, setIsGooglePending] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    startTransition(async () => {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl,
      });

      if (result?.error) {
        setError("Incorrect email or password.");
        return;
      }

      router.push(result?.url || callbackUrl);
      router.refresh();
    });
  };

  const handleGoogle = async () => {
    setError("");
    setIsGooglePending(true);
    await signIn("google", { callbackUrl: "/auth/onboarding" });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Email</label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500"
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Password</label>
            <Link href="/auth/forgot-password" className="text-xs font-medium text-slate-500 hover:text-slate-300">Forgot password?</Link>
          </div>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-blue-500"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>

        {error && <p className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="relative py-1 text-center">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-800" />
        <span className="relative bg-slate-900 px-3 text-xs uppercase tracking-[0.25em] text-slate-500">or</span>
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={!googleEnabled || isGooglePending}
        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {googleEnabled ? (isGooglePending ? "Redirecting to Google..." : "Continue with Google") : "Google sign-in needs AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET"}
      </button>
    </div>
  );
}
