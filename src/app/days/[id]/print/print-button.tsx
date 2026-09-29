"use client";

import Link from "next/link";
import { ChevronLeft, Printer } from "lucide-react";

export function PrintButton({ backHref }: { backHref: string }) {
  return (
    <div className="flex flex-shrink-0 gap-2 print:hidden">
      <Link
        href={backHref}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
      >
        <ChevronLeft size={15} /> Back
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
      >
        <Printer size={15} /> Print / Save PDF
      </button>
    </div>
  );
}
