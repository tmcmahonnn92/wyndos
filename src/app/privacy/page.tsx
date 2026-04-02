import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Wyndos.io",
  description: "Privacy Policy for Wyndos.io.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-3xl space-y-8 rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl sm:p-10">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">Wyndos.io</p>
          <h1 className="text-3xl font-black text-white">Privacy Policy</h1>
          <p className="text-sm text-slate-400">Last updated: 2 April 2026</p>
        </div>

        <section className="space-y-3 text-sm leading-7 text-slate-300">
          <p>
            Wyndos.io provides software for window cleaning businesses to manage customers, schedules, job history, and payments.
          </p>
          <p>
            We may process business and customer information such as names, addresses, contact details, job records, and payment records solely for the purpose of operating the service.
          </p>
          <p>
            Authentication information provided through supported sign-in providers is used only to identify users and secure access to accounts.
          </p>
          <p>
            We use reasonable technical and organizational measures to protect stored information and limit access to authorized users.
          </p>
          <p>
            We do not sell personal data. Information is used to operate, maintain, secure, and improve the application.
          </p>
          <p>
            If you have questions about this policy, contact the operator of the Wyndos.io service through the contact details provided on the application home page or support channel.
          </p>
        </section>

        <div className="flex flex-wrap gap-4 border-t border-slate-800 pt-4 text-sm text-slate-400">
          <Link href="/home" className="hover:text-slate-200">Home</Link>
          <Link href="/terms" className="hover:text-slate-200">Terms of Service</Link>
          <Link href="/auth/signin" className="hover:text-slate-200">Sign in</Link>
        </div>
      </div>
    </div>
  );
}