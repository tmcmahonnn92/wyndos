import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePermission } from "@/lib/tenant-context";
import { getActor } from "@/lib/guards";
import { getMtdOverview } from "@/lib/mtd/actions";
import { MtdClient } from "./mtd-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Making Tax Digital" };

export default async function MtdPage({ searchParams }: { searchParams?: Promise<{ year?: string; tab?: string }> }) {
  await requirePermission("accounting");
  const params = (await searchParams) ?? {};
  const year = Number.parseInt(params.year ?? "", 10);
  const [overview, actor] = await Promise.all([getMtdOverview(Number.isInteger(year) ? year : undefined), getActor()]);
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <div>
        <Link href="/accounting" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ChevronLeft size={16} /> Accounting</Link>
        <h1 className="mt-1 text-xl font-bold text-slate-800">Making Tax Digital</h1>
        <p className="text-sm text-slate-500">Your quarterly figures in HMRC&apos;s boxes, ready to send with bridging software. Mark a quarter as submitted once it&apos;s sent, so it can&apos;t change by accident.</p>
      </div>
      <MtdClient overview={overview} isOwner={!actor.isWorker} initialTab={params.tab ?? "quarters"} />
    </div>
  );
}
