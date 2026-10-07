import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/guards";
import { getAreas } from "@/lib/actions";
import { smartImportAvailable } from "@/lib/smart-import/actions";
import { SmartImport } from "./smart-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Smart import" };

/** Upload any customer file: Wyndos works out how to read it and shows a preview first. */
export default async function SmartImportPage() {
  await requireOwner().catch(() => redirect("/customers/import"));
  const [available, areas] = await Promise.all([smartImportAvailable(), getAreas()]);
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <div>
        <Link href="/customers/import" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Import</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Smart import</h1>
        <p className="text-sm text-slate-500">
          Upload your customer list in whatever format you have it. Wyndos works out how to read it and shows you exactly what
          will be added. Nothing is saved until you say it looks right.
        </p>
      </div>
      <SmartImport available={available} areas={areas.map((a) => ({ id: a.id, name: a.name, frequencyWeeks: a.frequencyWeeks }))} />
    </div>
  );
}
