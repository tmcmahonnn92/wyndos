"use client";

import { composeAddress, normalisePostcode, type AddressParts } from "@/lib/address";

const input =
  "w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

/**
 * One address, four boxes. House + street are what the day list sorts by,
 * so they are the ones that matter; town and postcode are optional.
 */
export function AddressFields({
  value,
  onChange,
  showPreview = true,
}: {
  value: AddressParts;
  onChange: (next: AddressParts) => void;
  showPreview?: boolean;
}) {
  const set = (key: keyof AddressParts, v: string) => onChange({ ...value, [key]: v });
  const line = composeAddress(value);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[0.8fr_1.2fr] gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">House no. / name *</label>
          <input
            type="text"
            placeholder="29 or Eden House"
            value={value.houseNameNumber}
            onChange={(e) => set("houseNameNumber", e.target.value)}
            className={input}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Street</label>
          <input
            type="text"
            placeholder="Beardsley Road"
            value={value.street}
            onChange={(e) => set("street", e.target.value)}
            className={input}
          />
        </div>
      </div>
      <div className="grid grid-cols-[1.2fr_0.8fr] gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Town / village</label>
          <input
            type="text"
            placeholder="Edwinstowe"
            value={value.town}
            onChange={(e) => set("town", e.target.value)}
            className={input}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Postcode</label>
          <input
            type="text"
            placeholder="NG21 9AA"
            value={value.postcode}
            onChange={(e) => set("postcode", e.target.value)}
            onBlur={(e) => set("postcode", normalisePostcode(e.target.value))}
            className={`${input} uppercase`}
          />
        </div>
      </div>
      {showPreview && line && (
        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Shows as: <strong>{line}</strong>
        </p>
      )}
    </div>
  );
}
