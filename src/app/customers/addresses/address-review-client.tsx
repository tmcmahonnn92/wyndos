"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { saveAddressParts } from "@/lib/actions";
import { composeAddress, type AddressParts } from "@/lib/address";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Row = {
  id: number;
  name: string;
  address: string;
  areaName: string;
  active: boolean;
  saved: boolean;
  parts: AddressParts;
};

const cell = "w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

/**
 * Old addresses were one line. This splits each into house / street / town / postcode
 * (a best guess), lets you fix any it got wrong, then saves them all.
 * The day list sorts by street and house number, so the street box matters most.
 */
export function AddressReviewClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<number, AddressParts>>({});
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const [message, setMessage] = useState<string | null>(null);

  const partsOf = (row: Row) => edits[row.id] ?? row.parts;
  const set = (row: Row, key: keyof AddressParts, value: string) =>
    setEdits((prev) => ({ ...prev, [row.id]: { ...partsOf(row), [key]: value } }));

  const visible = useMemo(
    () => rows.filter((row) => filter === "all" || !row.saved || edits[row.id]),
    [rows, filter, edits],
  );
  const noStreet = visible.filter((row) => !partsOf(row).street.trim()).length;
  // Save everything shown that isn't saved yet, plus anything edited.
  const toSave = rows.filter((row) => !row.saved || edits[row.id]);

  const saveAll = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await saveAddressParts(toSave.map((row) => ({ id: row.id, ...partsOf(row) })));
      setEdits({});
      setMessage(`Saved ${result.saved} address${result.saved === 1 ? "" : "es"}.`);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/customers" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Tidy addresses</h1>
            <p className="text-sm text-slate-500">
              Each address split into house, street, town and postcode. Check the guesses, fix any that are wrong, then save.
              The day list sorts by street, then house number.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as "todo" | "all")}
            className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
          >
            <option value="todo">Not saved yet</option>
            <option value="all">All customers</option>
          </select>
          <Button onClick={saveAll} disabled={isPending || toSave.length === 0}>
            {isPending ? "Saving..." : `Save ${toSave.length}`}
          </Button>
        </div>
      </div>

      {message && <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</p>}
      {noStreet > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {noStreet} with no street (named houses, farms): they sort after the streets of their town. Add a street if you know it.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500">
          All addresses are saved in parts. Switch to “All customers” to change any.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Customer / was</th>
                <th className="w-40 px-2 py-2">House no. / name</th>
                <th className="px-2 py-2">Street</th>
                <th className="w-40 px-2 py-2">Town</th>
                <th className="w-28 px-2 py-2">Postcode</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const parts = partsOf(row);
                const becomes = composeAddress(parts);
                return (
                  <tr key={row.id} className={cn("border-t border-slate-100 align-top", !row.active && "opacity-60")}>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-800">{row.name}</div>
                      <div className="text-xs text-slate-500">{row.areaName} · was: {row.address}</div>
                      {becomes && becomes !== row.address && <div className="text-xs text-blue-700">now: {becomes}</div>}
                    </td>
                    <td className="px-2 py-2"><input aria-label="House" className={cell} value={parts.houseNameNumber} onChange={(e) => set(row, "houseNameNumber", e.target.value)} /></td>
                    <td className="px-2 py-2"><input aria-label="Street" className={cell} value={parts.street} onChange={(e) => set(row, "street", e.target.value)} /></td>
                    <td className="px-2 py-2"><input aria-label="Town" className={cell} value={parts.town} onChange={(e) => set(row, "town", e.target.value)} /></td>
                    <td className="px-2 py-2"><input aria-label="Postcode" className={cn(cell, "uppercase")} value={parts.postcode} onChange={(e) => set(row, "postcode", e.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
