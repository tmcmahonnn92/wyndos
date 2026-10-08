import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import prisma from "@/lib/db";
import { requireOwner } from "@/lib/guards";
import { GOCARDLESS_ENABLED } from "@/lib/features";
import { getDirectDebitBoard, getGoCardlessOverview } from "@/lib/gocardless/actions";
import { DirectDebitClient } from "./dd-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Direct Debit" };

export default async function DirectDebitPage() {
  if (!GOCARDLESS_ENABLED) redirect("/payments");
  const actor = await requireOwner().catch(() => redirect("/payments"));
  const [overview, board, customers] = await Promise.all([
    getGoCardlessOverview(),
    getDirectDebitBoard(),
    prisma.customer.findMany({ where: { tenantId: actor.tenantId, active: true }, select: { id: true, name: true, address: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
      <div>
        <Link href="/payments" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Payments</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Direct Debit</h1>
        <p className="text-sm text-slate-500">Take payments for completed cleans through GoCardless. Money received is recorded against the clean automatically.</p>
      </div>
      <DirectDebitClient overview={overview} board={board} customers={customers} />
    </div>
  );
}
