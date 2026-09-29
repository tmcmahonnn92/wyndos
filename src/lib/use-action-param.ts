"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Opens a modal when the URL has ?action=<name> (the + quick actions link here).
 * Closing it drops the param, so tapping the same quick action again opens it again,
 * even when you're already on that page.
 */
export function useActionParam(action: string) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("action") === action;
  const [open, setOpen] = useState(requested);
  const [lastRequested, setLastRequested] = useState(requested);
  if (requested !== lastRequested) {
    setLastRequested(requested);
    if (requested) setOpen(true);
  }
  const close = () => {
    setOpen(false);
    if (requested) router.replace(pathname, { scroll: false });
  };
  return { open, setOpen, close };
}
