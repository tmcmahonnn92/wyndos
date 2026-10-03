import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { redirect } from "next/navigation";
import { plannerAvailable } from "@/lib/area-planner";
import { requirePermission } from "@/lib/tenant-context";
import { OrganiseClient } from "./organise-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sort into areas" };

export default async function OrganisePage() {
  await requirePermission("customers");
  const available = await plannerAvailable().catch(() => null);
  if (!available) redirect("/customers"); // owner only
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
      <div>
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Customers</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Sort customers into areas</h1>
        <p className="text-sm text-slate-500">A few quick questions, then we suggest areas (about a day&apos;s work each). You check and change them before anything is saved.</p>
      </div>
      <OrganiseClient aiAvailable={available.ai} />
    </div>
  );
}
