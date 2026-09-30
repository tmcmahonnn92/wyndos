"use client";

import { useMemo, useState } from "react";
import { Navigation } from "lucide-react";
import { Modal } from "@/components/ui/modal";

/** One stop on the day, in the order it'll be worked. */
export type RouteStop = {
  /** Full address to navigate to, e.g. "4 Cresswell Rd, Cuckney, NG20 9NJ". */
  address: string;
  /** Street and town, for the "one stop per street" option. Empty when there's no street. */
  street: string;
  town: string;
  postcode: string;
  label: string;
};

// Google Maps takes a start, a destination and up to 9 stops in between in one link.
const STOPS_PER_LINK = 10;

function mapsLink(stops: string[], origin: string | null) {
  const params = new URLSearchParams({ api: "1", travelmode: "driving" });
  if (origin) params.set("origin", origin); // no origin = start from where you are
  params.set("destination", stops[stops.length - 1]);
  if (stops.length > 1) params.set("waypoints", stops.slice(0, -1).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Route the day's remaining houses in Google Maps, in the order shown on the day.
 * Each house, or one stop per street (the whole street is walked from one stop).
 */
export function MapsRouteModal({ open, onClose, stops }: { open: boolean; onClose: () => void; stops: RouteStop[] }) {
  const [perStreet, setPerStreet] = useState(false);
  const [fromFirst, setFromFirst] = useState(false);

  const points = useMemo(() => {
    if (!perStreet) return stops.map((s) => ({ address: s.address, label: s.label, count: 1 }));
    const out: Array<{ address: string; label: string; count: number; key: string }> = [];
    for (const s of stops) {
      const key = s.street ? `${s.street}|${s.town}`.toLowerCase() : `house|${s.address}`.toLowerCase();
      const last = out[out.length - 1];
      if (last && last.key === key) { last.count += 1; continue; }
      out.push({
        key,
        address: s.street ? [s.street, s.town, s.postcode].filter(Boolean).join(", ") : s.address,
        label: s.street ? `${s.street}${s.town ? `, ${s.town}` : ""}` : s.label,
        count: 1,
      });
    }
    return out;
  }, [stops, perStreet]);

  const parts = useMemo(() => {
    const out: Array<{ href: string; from: string; to: string; count: number }> = [];
    // Start from where you are, or from the first house (it then isn't a stop itself).
    const start = fromFirst && points.length > 1 ? points[0] : null;
    const route = start ? points.slice(1) : points;
    for (let i = 0; i < route.length; i += STOPS_PER_LINK) {
      const chunk = route.slice(i, i + STOPS_PER_LINK);
      // Each later part carries on from the last stop of the previous part.
      const origin = i === 0 ? (start?.address ?? null) : route[i - 1].address;
      out.push({
        href: mapsLink(chunk.map((p) => p.address), origin),
        from: i === 0 && start ? start.label : chunk[0].label,
        to: chunk[chunk.length - 1].label,
        count: chunk.length + (i === 0 && start ? 1 : 0),
      });
    }
    return out;
  }, [points, fromFirst]);

  return (
    <Modal open={open} onClose={onClose} title="Route in Google Maps">
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Stops" className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
          <button type="button" role="radio" aria-checked={!perStreet} onClick={() => setPerStreet(false)}
            className={`rounded-lg py-2 ${!perStreet ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            Every house
          </button>
          <button type="button" role="radio" aria-checked={perStreet} onClick={() => setPerStreet(true)}
            className={`rounded-lg py-2 ${perStreet ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            One stop per street
          </button>
        </div>

        <div role="radiogroup" aria-label="Start from" className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm font-semibold">
          <button type="button" role="radio" aria-checked={!fromFirst} onClick={() => setFromFirst(false)}
            className={`rounded-lg py-2 ${!fromFirst ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            From where I am
          </button>
          <button type="button" role="radio" aria-checked={fromFirst} onClick={() => setFromFirst(true)}
            className={`rounded-lg py-2 ${fromFirst ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            From the first stop
          </button>
        </div>

        {points.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Nothing left to do on this day.</p>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              {points.length} stop{points.length === 1 ? "" : "s"} in the order on your list, starting {fromFirst ? `at ${points[0].label}` : "from where you are"}.
              {parts.length > 1 && ` Google Maps takes ${STOPS_PER_LINK} stops at a time, so it's in ${parts.length} parts: open the next part when you finish one.`}
            </p>
            <div className="space-y-2">
              {parts.map((part, i) => (
                <a key={i} href={part.href} target="_blank" rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 hover:border-blue-300 hover:bg-blue-50">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                    <Navigation size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">
                      {parts.length > 1 ? `Part ${i + 1}: ` : ""}{part.count} stop{part.count === 1 ? "" : "s"}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{part.from} → {part.to}</span>
                  </span>
                  <span className="text-xs font-semibold text-blue-600">Open</span>
                </a>
              ))}
            </div>
            {perStreet && (
              <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-slate-100 p-2 text-xs text-slate-600">
                {points.map((p, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">{i + 1}. {p.label}</span>
                    <span className="flex-shrink-0 text-slate-400">{p.count} house{p.count === 1 ? "" : "s"}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
