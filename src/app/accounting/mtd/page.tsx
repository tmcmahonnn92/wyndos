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
      <details className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-semibold text-slate-800">What Wyndos does, and what it doesn&apos;t</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Does:</b> keeps your records digitally (payments, expenses, mileage, use of home, assets) and works out each quarter&apos;s figures in HMRC&apos;s categories, year to date as HMRC now wants them.</li>
          <li><b>Doesn&apos;t send anything to HMRC</b> and isn&apos;t on HMRC&apos;s list of Making Tax Digital software. You, or your accountant, send the figures with HMRC-recognised bridging software, using the Excel export.</li>
          <li><b>Doesn&apos;t do your end-of-year tax return</b> (the final declaration) or work out your tax bill. It gives you the year&apos;s figures and allowances to use for it.</li>
          <li><b>Only covers your window cleaning business.</b> Other income (another job, property, pensions) isn&apos;t in these figures.</li>
          <li>The figures follow the usual rules for a sole trader, but they&apos;re only as good as what&apos;s recorded. Check them, or ask an accountant, before you send.</li>
        </ul>
      </details>
      <MtdClient overview={overview} isOwner={!actor.isWorker} initialTab={params.tab ?? "quarters"} />
    </div>
  );
}
