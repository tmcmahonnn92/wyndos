import Link from "next/link";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { verifyEmail } from "@/lib/auth-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const result = await verifyEmail(token ?? "");
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
      {result.ok ? (
        <>
          <CheckCircle2 size={44} className="text-green-500" />
          <h1 className="text-xl font-bold text-slate-800">Email confirmed</h1>
          <p className="text-sm text-slate-600">Thanks. You&apos;re all set.</p>
        </>
      ) : (
        <>
          <AlertCircle size={44} className="text-amber-500" />
          <h1 className="text-xl font-bold text-slate-800">Couldn&apos;t confirm your email</h1>
          <p className="text-sm text-slate-600">{result.error} Sign in and use “Resend” on the yellow bar.</p>
        </>
      )}
      <Link href="/" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Go to Wyndos</Link>
    </div>
  );
}
