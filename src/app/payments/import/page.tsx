import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getBankImportData, getRecentBankImports } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { BankImportClient } from "./bank-import-client";

export const dynamic = "force-dynamic";

export default async function BankImportPage() {
  await requirePermission("payments");
  const [data, recent] = await Promise.all([getBankImportData(), getRecentBankImports()]);
  return (
    <div className="px-4 py-5 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/payments" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 dark:hover:bg-slate-800">
          <ChevronLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Match bank payments</h1>
          <p className="text-xs text-slate-500 mt-0.5">Upload a bank statement or payments spreadsheet (.csv, .xlsx, .xls)</p>
        </div>
      </div>
      <BankImportClient
        tenantId={data.tenantId}
        allowCredit={data.allowCredit}
        customers={data.customers}
        references={data.references}
        recent={recent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), undoneAt: r.undoneAt ? r.undoneAt.toISOString() : null }))}
      />
    </div>
  );
}
