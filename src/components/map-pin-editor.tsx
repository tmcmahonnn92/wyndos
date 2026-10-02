"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, MapPin } from "lucide-react";
import { setCustomerPin } from "@/lib/actions";
import { parsePin } from "@/lib/maps-link";

/**
 * A map pin for a house the address lookup gets wrong. When set, maps, routes and the
 * route optimiser go to the pin instead of the address.
 */
export function MapPinEditor({ customerId, latitude, longitude }: { customerId: number; latitude: number | null; longitude: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [isPending, startTransition] = useTransition();
  const pinned = latitude !== null && longitude !== null;

  const save = (pin: { latitude: number; longitude: number } | null) => {
    setError(null);
    startTransition(async () => {
      try {
        await setCustomerPin(customerId, pin);
        setOpen(false);
        setText("");
        router.refresh();
      } catch (issue) {
        setError(issue instanceof Error ? issue.message : "Couldn't save the pin.");
      }
    });
  };

  const useHere = () => {
    if (!navigator.geolocation) { setError("This device can't share its location."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        save({ latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)) });
      },
      () => { setLocating(false); setError("Couldn't get your location. Allow location for Wyndos and try again."); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Map pin</span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
          <MapPin size={11} />
          {pinned ? `${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}` : "Set a pin"}
        </button>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <p className="text-[11px] text-slate-500">
            Use this when the address lands in the wrong place. Maps and routes will go to the pin.
          </p>
          <button
            type="button"
            onClick={useHere}
            disabled={locating || isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Crosshair size={14} /> {locating ? "Finding you…" : "I'm at the house: use my location"}
          </button>
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Or paste 53.21, -1.12 or a Google Maps link"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={!text.trim() || isPending}
              onClick={() => {
                const pin = parsePin(text);
                if (!pin) { setError("That doesn't look like a map position. Try “53.21, -1.12”."); return; }
                save(pin);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
          {pinned && (
            <button type="button" onClick={() => save(null)} disabled={isPending} className="text-xs text-red-600 hover:underline">
              Remove pin (use the address)
            </button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
