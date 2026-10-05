"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const LEGAL_EXEMPT = ["/auth", "/terms", "/privacy", "/cookies", "/support", "/guide"];
const LOCKED_WHEN_ENDED = ["/scheduler", "/days"];
const under = (path: string, roots: string[]) => roots.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Decides, from the page actually open, whether to show the terms screen, the "trial ended"
 * screen, or the page itself. (The legal pages always open, so people can read before accepting.)
 */
export function PageGate({
  needsLegal, legalGate, billingEnded, lockScreen, trialBar, verifyBar, children,
}: {
  needsLegal: boolean;
  legalGate: ReactNode;
  billingEnded: boolean;
  lockScreen: ReactNode;
  trialBar: ReactNode;
  verifyBar: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname() ?? "";
  const showLegal = needsLegal && !under(path, LEGAL_EXEMPT);
  const locked = billingEnded && under(path, LOCKED_WHEN_ENDED);
  return (
    <>
      {!under(path, ["/auth"]) && verifyBar}
      {!under(path, ["/billing", "/auth"]) && trialBar}
      {showLegal ? legalGate : locked ? lockScreen : children}
    </>
  );
}
