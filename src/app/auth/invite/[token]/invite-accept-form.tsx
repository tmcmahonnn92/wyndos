"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "@/lib/auth-actions";

export function InviteAcceptForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inputCls =
    "w-full rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p className="rounded-xl border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

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
        {loading ? "Creating account…" : "Accept invite and join"}
      </button>
    </form>
  );
}
