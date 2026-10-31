import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, AlertCircle, MailCheck } from "lucide-react";
import { verifyEmail, emailVerificationState } from "@/lib/auth-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm email" };

/**
 * The link in the "Confirm your email" message. Opening it doesn't confirm on its own: email
 * services (Outlook, Hotmail, Gmail) open links to check them, which would use the link up before
 * the person clicks. So it shows a button, and confirming happens when that's pressed.
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string; error?: string }> }) {
  const { token, done, error } = await searchParams;

  async function confirm(formData: FormData) {
    "use server";
    const result = await verifyEmail(String(formData.get("token") ?? ""));
    if (result.ok) redirect("/auth/verify-email?done=1");
    // Already confirmed (an earlier click, or the link was opened twice): that's fine.
    const state = await emailVerificationState().catch(() => null);
    if (state?.verified) redirect("/auth/verify-email?done=1");
    redirect(`/auth/verify-email?error=${encodeURIComponent(result.error ?? "Couldn't confirm.")}`);
  }

  const already = !done && !error ? await emailVerificationState().catch(() => null) : null;
  const ok = done === "1" || Boolean(already?.verified);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      {ok ? (
        <>
          <CheckCircle2 size={44} className="text-green-500" />
          <h1 className="text-xl font-bold text-slate-800">Email confirmed</h1>
          <p className="text-sm text-slate-600">Thanks. You&apos;re all set.</p>
          <Link href="/" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Go to Wyndos</Link>
        </>
      ) : error ? (
        <>
          <AlertCircle size={44} className="text-amber-500" />
          <h1 className="text-xl font-bold text-slate-800">Couldn&apos;t confirm your email</h1>
          <p className="text-sm text-slate-600">{error} Sign in and use “Resend” on the yellow bar.</p>
          <Link href="/" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Go to Wyndos</Link>
        </>
      ) : (
        <>
          <MailCheck size={44} className="text-blue-600" />
          <h1 className="text-xl font-bold text-slate-800">Confirm your email</h1>
          <p className="text-sm text-slate-600">One tap and you&apos;re done.</p>
          <form action={confirm}>
            <input type="hidden" name="token" value={token ?? ""} />
            <button type="submit" className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700">Confirm my email</button>
          </form>
        </>
      )}
    </div>
  );
}
