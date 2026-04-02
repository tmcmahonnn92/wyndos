import Link from "next/link";

export const metadata = {
  title: "Wyndos.io | Window Cleaning Route Management",
  description: "Wyndos.io helps window cleaning businesses manage customers, rounds, schedules, payments, and day-to-day operations.",
};

export default function PublicHomePage() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-8 shadow-2xl sm:p-12">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">Wyndos.io</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight text-white sm:text-5xl">
            Route management for window cleaning businesses.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
            Wyndos.io is a web application for managing customers, work days, recurring rounds, scheduling, and payment tracking for window cleaning businesses.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/auth/signin" className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500">
              Sign in
            </Link>
            <Link href="/auth/signup" className="rounded-2xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500 hover:bg-slate-800">
              Create account
            </Link>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-bold text-white">Customer Management</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Store customer details, pricing, notes, service frequency, and account history in one place.
            </p>
          </section>
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-bold text-white">Scheduling and Rounds</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Organize work days, recurring area schedules, one-off jobs, and round planning for teams and owner-operators.
            </p>
          </section>
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-bold text-white">Payments and Balances</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Record payments against specific jobs, track outstanding balances, and review payment history.
            </p>
          </section>
        </div>

        <div className="flex flex-wrap gap-4 border-t border-slate-800 pt-6 text-sm text-slate-400">
          <Link href="/privacy" className="hover:text-slate-200">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-slate-200">Terms of Service</Link>
          <Link href="/auth/signin" className="hover:text-slate-200">App Sign In</Link>
        </div>
      </div>
    </div>
  );
}