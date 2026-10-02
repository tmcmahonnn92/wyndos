"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Smartphone } from "lucide-react";

/** Link a phone opens to send these texts (no ids = everything waiting). */
export function sendLink(ids?: number[]) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return ids && ids.length > 0 ? `${origin}/send?ids=${ids.join(",")}` : `${origin}/send`;
}

/**
 * Texts go from your own phone. On a computer, this hands them over: scan the code
 * with the phone camera and the same list opens on the phone, ready to send.
 */
export function SendOnPhone({ ids, compact = false }: { ids?: number[]; compact?: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = sendLink(ids);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(link, { margin: 1, width: 220 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => {});
    return () => { cancelled = true; };
  }, [link]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Smartphone size={15} /> Send these from your phone
      </p>
      <div className={compact ? "mt-2 flex items-start gap-3" : "mt-2 flex flex-col items-center gap-3 sm:flex-row sm:items-start"}>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="Code to open these texts on your phone" width={compact ? 110 : 150} height={compact ? 110 : 150} className="flex-shrink-0 rounded-lg bg-white p-1" />
        ) : (
          <div className="h-[110px] w-[110px] flex-shrink-0 rounded-lg bg-white" />
        )}
        <ol className="list-decimal space-y-1 pl-4 text-xs leading-snug">
          <li>Open the camera on your phone and point it at the code.</li>
          <li>Tap the link that pops up. Sign in to Wyndos if it asks.</li>
          <li>Tap <strong>Open in Messages</strong>, press Send, come back. The next one is ready.</li>
          <li className="list-none -ml-4 pt-1 text-blue-800">
            No camera? On your phone open Wyndos and go to <strong>{typeof window !== "undefined" ? window.location.host : ""}/send</strong>.
          </li>
        </ol>
      </div>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
        }}
        className="mt-2 flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
      >
        <Copy size={12} /> {copied ? "Link copied" : "Copy link"}
      </button>
    </div>
  );
}
