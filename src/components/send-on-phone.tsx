"use client";

import { useEffect, useState } from "react";
import { encodeIdRanges } from "@/lib/id-ranges";
import QRCode from "qrcode";
import { Copy, Smartphone } from "lucide-react";

/**
 * Link a phone opens to send these texts (no ids = everything waiting).
 * Kept short so the QR code stays simple: ids go as base-36 ranges ("r=2s-3d.40").
 */
export function sendLink(ids?: number[]) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return ids && ids.length > 0 ? `${origin}/send?r=${encodeIdRanges(ids)}` : `${origin}/send`;
}

/**
 * Texts go from your own phone. On a computer, this hands them over: scan the code
 * with the phone camera and the same list opens on the phone, ready to send.
 */
export function SendOnPhone({ ids, compact = false }: { ids?: number[]; compact?: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [big, setBig] = useState(false);
  const link = sendLink(ids);

  useEffect(() => {
    let cancelled = false;
    // Low error correction = fewer, bigger squares. Drawn at 600px and shown smaller, so it stays sharp.
    QRCode.toDataURL(link, { errorCorrectionLevel: "L", margin: 2, width: 600, color: { dark: "#000000", light: "#ffffff" } })
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
          <button type="button" onClick={() => setBig(true)} title="Tap to make it bigger" className="flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Code to open these texts on your phone" width={compact ? 170 : 210} height={compact ? 170 : 210} className="rounded-lg bg-white [image-rendering:pixelated]" />
            <span className="mt-1 block text-center text-[11px] font-semibold text-blue-700">Tap to make bigger</span>
          </button>
        ) : (
          <div className={compact ? "h-[170px] w-[170px] flex-shrink-0 rounded-lg bg-white" : "h-[210px] w-[210px] flex-shrink-0 rounded-lg bg-white"} />
        )}
        {big && qr && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white p-6" onClick={() => setBig(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="Code to open these texts on your phone" className="aspect-square w-full max-w-[min(80vh,520px)] [image-rendering:pixelated]" />
            <p className="text-sm text-slate-600">Point your phone camera at this. Tap anywhere to close.</p>
          </div>
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
