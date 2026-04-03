import Link from "next/link";
import { SignUpForm } from "./sign-up-form";

export const dynamic = "force-dynamic";

export default function SignUpPage() {
  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-4xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl lg:grid-cols-[1fr_1.1fr]">

          {/* Left panel */}
          <div className="hidden bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-10 lg:flex lg:flex-col lg:justify-center">
            <div className="max-w-xs space-y-5">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">
                Join Wyndos.io
              </p>
              <h1 className="text-4xl font-black leading-tight text-white">
                Your window cleaning business, fully organised.
              </h1>
              <p className="text-sm leading-6 text-slate-300">
                Create your account and get your complete round — customers, areas,
                scheduling, payments and invoicing — in one place.
              </p>
              <ul className="space-y-2 text-sm text-slate-400">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-blue-400">✓</span>
                  Manage your full round end-to-end
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-blue-400">✓</span>
                  Invite your workers to join your account
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 text-blue-400">✓</span>
                  Your data, completely separate from other users
                </li>
              </ul>
              <p className="text-sm text-slate-400">
                Already have an account?{" "}
                <Link href="/auth/signin" className="font-semibold text-blue-400 hover:text-blue-300">
                  Sign in
                </Link>
              </p>
            </div>
          </div>

          {/* Right panel — form */}
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mx-auto max-w-sm space-y-6">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-400">
                  Get started — it&apos;s free
                </p>
                <h2 className="mt-2 text-3xl font-bold text-white">Create your account</h2>
                <p className="mt-2 text-sm text-slate-400">
                  Enter your details below to set up your window cleaning round.
                </p>
              </div>
              <SignUpForm googleEnabled={googleEnabled} />
              <p className="text-center text-sm text-slate-500 lg:hidden">
                Already have an account?{" "}
                <Link href="/auth/signin" className="font-semibold text-blue-400 hover:text-blue-300">
                  Sign in
                </Link>
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
