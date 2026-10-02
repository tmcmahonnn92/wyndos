import Link from "next/link";
import type { ReactNode } from "react";
import { TERMS_UPDATED } from "@/lib/legal";

/** Shared look for Terms, Privacy and Cookies. Readable signed in or out. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-3xl space-y-8 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-10">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">Wyndos</p>
          <h1 className="text-3xl font-black text-white">{title}</h1>
          <p className="text-sm text-slate-400">Last updated: {TERMS_UPDATED}</p>
        </div>
        <div className="legal space-y-6 text-sm leading-7 text-slate-300 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-white [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:text-blue-400 [&_a]:underline [&_strong]:text-slate-100 [&_table]:w-full [&_td]:border-t [&_td]:border-slate-800 [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:pb-2 [&_th]:pr-3 [&_th]:text-left [&_th]:text-slate-400">
          {children}
        </div>
        <div className="flex flex-wrap gap-4 border-t border-slate-800 pt-4 text-sm text-slate-400">
          <Link href="/" className="hover:text-slate-200">Wyndos</Link>
          <Link href="/terms" className="hover:text-slate-200">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-slate-200">Privacy Policy</Link>
          <Link href="/cookies" className="hover:text-slate-200">Cookie Policy</Link>
        </div>
      </div>
    </div>
  );
}
