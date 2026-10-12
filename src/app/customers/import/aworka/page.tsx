import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/guards";
import { MoveImport } from "../cleanerplanner/cleanerplanner-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import from Aworka" };

export default async function MoveImportPage() {
  await requireOwner().catch(() => redirect("/customers/import")); // owner only
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div>
        <Link href="/customers/import" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Import</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Move from Aworka</h1>
        <p className="text-sm text-slate-500">
          Bring your customers, rounds, prices, due dates, balances, history and expenses across from an Aworka full export. You check everything before it&apos;s saved.
        </p>
      </div>
      <MoveImport source="Aworka" />
    </div>
  );
}
