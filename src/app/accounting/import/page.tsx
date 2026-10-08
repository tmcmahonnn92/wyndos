import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireOwner } from "@/lib/guards";
import { smartImportAvailable } from "@/lib/smart-import/actions";
import { ExpenseImport } from "./expense-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import expenses" };

/** Import expenses from a bank statement, receipts spreadsheet or the Wyndos template, with a preview first. */
export default async function ExpenseImportPage() {
  await requireOwner().catch(() => redirect("/accounting"));
  const available = await smartImportAvailable();
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <div>
        <Link href="/accounting" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Accounting</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Import expenses</h1>
        <p className="text-sm text-slate-500">
          Upload a bank or card statement, a spreadsheet of receipts, or the Wyndos template. Each expense is put in a category that matches
          HMRC&apos;s Making Tax Digital boxes, and you check them all in a preview. Nothing is saved until you say it looks right.
        </p>
      </div>
      <ExpenseImport available={available} />
    </div>
  );
}
