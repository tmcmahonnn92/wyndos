import Link from "next/link";

export const metadata = {
  title: "Terms of Service | Wyndos.io",
  description: "Terms of Service for Wyndos.io.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-3xl space-y-8 rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl sm:p-10">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">Wyndos.io</p>
          <h1 className="text-3xl font-black text-white">Terms of Service</h1>
          <p className="text-sm text-slate-400">Last updated: 2 April 2026</p>
        </div>

        <section className="space-y-3 text-sm leading-7 text-slate-300">
          <p>
            Wyndos.io is provided as a software service for managing window cleaning business operations.
          </p>
          <p>
            By using the service, you agree to use it only for lawful business purposes and to keep your account credentials secure.
          </p>
          <p>
            You are responsible for the accuracy of the information you enter into the application, including customer, scheduling, and payment data.
          </p>
          <p>
            We may update, maintain, or improve the service over time. Access may be suspended or restricted where necessary for security, maintenance, or breach of these terms.
          </p>
          <p>
            The service is provided on an as-available basis. To the extent permitted by law, liability is limited for indirect or consequential losses arising from use of the application.
          </p>
          <p>
            Continued use of the service after updates to these terms constitutes acceptance of the revised terms.
          </p>
        </section>

        <div className="flex flex-wrap gap-4 border-t border-slate-800 pt-4 text-sm text-slate-400">
          <Link href="/home" className="hover:text-slate-200">Home</Link>
          <Link href="/privacy" className="hover:text-slate-200">Privacy Policy</Link>
          <Link href="/auth/signin" className="hover:text-slate-200">Sign in</Link>
        </div>
      </div>
    </div>
  );
}