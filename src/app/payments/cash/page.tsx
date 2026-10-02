import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCashWithTeam } from "@/lib/cash-actions";
import { requirePermission } from "@/lib/tenant-context";
import { CashClient } from "./cash-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cash with the team" };

export default async function CashPage() {
  await requirePermission("payments");
  const data = await getCashWithTeam().catch(() => null);
  if (!data) redirect("/payments");
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <div>
        <Link href="/payments" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Payments</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Cash with the team</h1>
        <p className="text-sm text-slate-500">Cash your team took at the door. Mark it handed over when they give it to you.</p>
      </div>
      <CashClient held={data.held} handovers={data.handovers} />
    </div>
  );
}
