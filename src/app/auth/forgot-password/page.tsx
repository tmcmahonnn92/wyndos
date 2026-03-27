import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-form";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl md:grid-cols-[1.1fr_0.9fr]">
          <div className="hidden bg-gradient-to-br from-blue-600 via-sky-500 to-cyan-400 p-10 md:block">
            <div className="max-w-sm space-y-5 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/80">Wyndos.io</p>
              <h1 className="text-4xl font-black leading-tight">Reset your password.</h1>
              <p className="text-sm leading-6 text-white/90">
                Enter your account email and we'll send you a reset link — or show it directly if email isn't configured yet.
              </p>
            </div>
          </div>
          <div className="p-6 sm:p-10">
            <div className="mx-auto max-w-md space-y-6">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-400">Account recovery</p>
                <h2 className="mt-2 text-3xl font-bold text-white">Forgot password?</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Remember it?{" "}
                  <Link href="/auth/signin" className="font-semibold text-blue-400 hover:text-blue-300">
                    Sign in
                  </Link>
                </p>
              </div>
              <ForgotPasswordForm />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
