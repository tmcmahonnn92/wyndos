"use client";

import { useRef, useState } from "react";
import { Loader2, Share2 } from "lucide-react";

/**
 * Makes the PDF and opens the phone's share menu (WhatsApp, email, Messages…).
 * Falls back to downloading it where sharing files isn't supported (most computers).
 */
export function SharePdfButton({
  href,
  fileName,
  title,
  className,
  label = "Share",
}: {
  href: string;
  fileName: string;
  title: string;
  className?: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const fileRef = useRef<{ href: string; promise: Promise<File> } | null>(null);

  // Start making the PDF as soon as a finger touches the button, so it's ready by the tap.
  const prepare = () => {
    if (fileRef.current?.href === href) return fileRef.current.promise;
    const promise = fetch(href, { cache: "no-store" }).then(async (res) => {
      if (!res.ok) throw new Error("Could not make the PDF.");
      const blob = await res.blob();
      return new File([blob], fileName, { type: "application/pdf" });
    });
    fileRef.current = { href, promise };
    promise.catch(() => { fileRef.current = null; });
    return promise;
  };

  const download = (file: File) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const share = async () => {
    setState((s) => (s === "ready" ? s : "loading"));
    let file: File;
    try {
      file = await prepare();
    } catch {
      setState("error");
      return;
    }
    const canShareFiles = typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] });
    if (!canShareFiles) {
      download(file);
      setState("idle");
      return;
    }
    try {
      await navigator.share({ files: [file], title });
      setState("idle");
    } catch (issue) {
      // The phone blocks sharing if making the PDF took too long after the tap: it's ready now, so tap again.
      if (issue instanceof DOMException && issue.name === "NotAllowedError") setState("ready");
      else setState("idle"); // AbortError = they closed the share menu
    }
  };

  return (
    <button
      type="button"
      onPointerDown={() => { prepare().catch(() => {}); }}
      onClick={share}
      disabled={state === "loading"}
      className={className ?? "flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"}
    >
      {state === "loading" ? <Loader2 size={15} className="animate-spin" /> : <Share2 size={15} />}
      {state === "ready" ? "Tap to share" : state === "error" ? "Try again" : label}
    </button>
  );
}
