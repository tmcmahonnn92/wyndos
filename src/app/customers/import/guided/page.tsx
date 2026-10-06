import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { plannerAvailable } from "@/lib/area-planner";
import { requirePermission } from "@/lib/tenant-context";
import { GUIDED_IMPORT_ENABLED } from "@/lib/features";
import { GuidedImportClient } from "./guided-import-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Guided import" };

export default async function GuidedImportPage() {
  if (!GUIDED_IMPORT_ENABLED) redirect("/customers/import");
  await requirePermission("customers");
  const available = await plannerAvailable().catch(() => null);
  if (!available) redirect("/customers/import"); // owner only
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div>
        <Link href="/customers/import" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Normal import</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Guided import</h1>
        <p className="text-sm text-slate-500">Upload your list as it is. We work out the columns and tidy it up. You check everything before it&apos;s saved.</p>
      </div>
      {available.ai ? (
        <GuidedImportClient />
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The guided import isn&apos;t switched on yet. Use the <Link href="/customers/import" className="font-semibold underline">normal import</Link>.
        </div>
      )}
    </div>
  );
}
