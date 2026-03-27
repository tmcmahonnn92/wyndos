import Link from "next/link";
import { getResetTokenInfo } from "@/lib/auth-actions";
import { ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function ResetPasswordPage({ params }: Props) {
  const { token } = await params;
  const info = await getResetTokenInfo(token);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl md:grid-cols-[1.1fr_0.9fr]">
          <div className="hidden bg-gradient-to-br from-blue-600 via-sky-500 to-cyan-400 p-10 md:block">
            <div className="max-w-sm space-y-5 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/80">Wyndos.io</p>
              <h1 className="text-4xl font-black leading-tight">
                {info.valid ? "Set a new password." : "Link expired."}
              </h1>
              <p className="text-sm leading-6 text-white/90">
                {info.valid
                  ? "Choose a strong password with at least 8 characters."
                  : "Reset links expire after 24 hours. Request a new one below."}
              </p>
            </div>
          </div>
          <div className="p-6 sm:p-10">
            <div className="mx-auto max-w-md space-y-6">
              {info.valid ? (
                <>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-400">New password</p>
                    <h2 className="mt-2 text-3xl font-bold text-white">Reset password</h2>
                    <p className="mt-2 text-sm text-slate-400">
                      Setting password for <span className="text-slate-300 font-medium">{info.email}</span>
                    </p>
                  </div>
                  <ResetPasswordForm token={token} />
                </>
              ) : (
                <div className="space-y-5">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-400">Invalid link</p>
                    <h2 className="mt-2 text-3xl font-bold text-white">Link expired</h2>
                  </div>
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-300">
                    {info.error}
                  </div>
                  <Link
                    href="/auth/forgot-password"
                    className="block w-full rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-blue-500"
                  >
                    Request a new reset link
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
