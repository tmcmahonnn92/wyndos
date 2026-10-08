import { CheckCircle2 } from "lucide-react";

export const metadata = { title: "Direct Debit set up" };

/** Where GoCardless sends a customer after they've set up (or left) their Direct Debit. Public. */
export default function DirectDebitDone() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <CheckCircle2 size={36} className="mx-auto text-green-600" />
        <h1 className="text-lg font-bold text-slate-800">Thank you</h1>
        <p className="text-sm text-slate-600">
          If you completed the form, your Direct Debit is set up with GoCardless and you&apos;ll get an email from them to confirm it.
          You can close this page.
        </p>
      </div>
    </div>
  );
}
