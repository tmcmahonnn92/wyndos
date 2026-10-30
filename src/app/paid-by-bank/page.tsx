import { CheckCircle2, CircleSlash } from "lucide-react";

export const metadata = { title: "Payment" };

/** Where GoCardless sends a customer after paying by bank (or leaving). Public. */
export default async function PaidByBank({ searchParams }: { searchParams: Promise<{ stopped?: string }> }) {
  const stopped = (await searchParams).stopped === "1";
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-center">
        {stopped ? <CircleSlash size={36} className="mx-auto text-slate-400" /> : <CheckCircle2 size={36} className="mx-auto text-green-600" />}
        <h1 className="text-lg font-bold text-slate-800">{stopped ? "Payment not made" : "Thank you"}</h1>
        <p className="text-sm text-slate-600">
          {stopped
            ? "Nothing has been taken. You can use the same link again to pay."
            : "If you approved the payment in your bank, it's on its way. GoCardless will email you a receipt. You can close this page."}
        </p>
      </div>
    </div>
  );
}
