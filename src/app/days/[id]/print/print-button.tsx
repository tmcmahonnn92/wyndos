"use client";

import Link from "next/link";
import { ChevronLeft, Printer } from "lucide-react";
import { SharePdfButton } from "@/components/share-pdf-button";

export function PrintButton({ backHref, pdfHref, fileName }: { backHref: string; pdfHref: string; fileName: string }) {
  return (
    <div className="flex flex-shrink-0 flex-wrap gap-2 print:hidden">
      <Link
        href={backHref}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
      >
        <ChevronLeft size={15} /> Back
      </Link>
      <SharePdfButton href={pdfHref} fileName={fileName} title="Run sheet" label="Share PDF"
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700" />
      <button
        type="button"
        onClick={() => window.print()}
        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white"
      >
        <Printer size={15} /> Print
      </button>
    </div>
  );
}
