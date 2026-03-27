"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { registerOwner } from "@/lib/auth-actions";

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

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
        {loading ? "Creating your account…" : "Create account"}
      </button>

      <p className="text-center text-xs text-slate-500">
        By signing up you agree to use this service responsibly. Your data is completely private and separate from other users.
      </p>
    </form>
  );
}
