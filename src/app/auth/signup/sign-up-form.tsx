"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { registerOwner } from "@/lib/auth-actions";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.58 2.68-3.91 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.33l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33c.71-2.12 2.7-3.7 5.04-3.7Z"
      />
    </svg>
  );
}

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isGooglePending, setIsGooglePending] = useState(false);

  const handleGoogle = async () => {
    setError("");
    setIsGooglePending(true);
    await signIn("google", { callbackUrl: "/auth/onboarding" });
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const fd = new FormData(e.currentTarget);
      const name = fd.get("name") as string;
      const companyName = fd.get("companyName") as string;
      const email = fd.get("email") as string;
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

      const result = await registerOwner({ name, companyName, email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Sign in immediately after registration
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

      router.push("/auth/onboarding");
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleGoogle}
        disabled={!googleEnabled || isGooglePending}
        className="flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-400 disabled:opacity-70"
      >
        <GoogleMark />
        {googleEnabled ? (isGooglePending ? "Redirecting to Google..." : "Continue with Google") : "Google sign-up needs AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET"}
      </button>

      <div className="relative py-1 text-center">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-800" />
        <span className="relative bg-slate-900 px-3 text-xs uppercase tracking-[0.25em] text-slate-500">or</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Your full name</label>
          <input name="name" type="text" required placeholder="e.g. Dave Smith" className={inputCls} />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Company / trading name</label>
          <input
            name="companyName"
            type="text"
            required
            placeholder="e.g. Smith Window Cleaning"
            className={inputCls}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Email address</label>
          <input name="email" type="email" required placeholder="you@example.com" className={inputCls} />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Password</label>
          <input name="password" type="password" required minLength={8} placeholder="Minimum 8 characters" className={inputCls} />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">Confirm password</label>
          <input name="confirm" type="password" required minLength={8} placeholder="Repeat your password" className={inputCls} />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-60"
        >
          {loading ? "Creating your account..." : "Create account"}
        </button>
      </form>

      <p className="text-center text-xs text-slate-500">
        By signing up you agree to use this service responsibly. Your data is completely private and separate from other users.
      </p>
    </div>
  );
}
