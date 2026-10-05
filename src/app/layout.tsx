import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";
import { auth } from "@/auth";
import { Nav } from "@/components/nav";
import { SupportSessionBanner } from "@/components/support-session-banner";
import prisma from "@/lib/db";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";
import { resolveActiveMembership, resolveActivePermissions } from "@/lib/memberships";
import { PWAInstallPrompt } from "@/components/pwa-install-prompt";
import { OfflineStatus } from "@/components/offline-status";
import { BillingLock, TrialBar } from "@/components/billing-banners";
import { VerifyEmailBar } from "@/components/verify-email-bar";
import { emailVerificationState } from "@/lib/auth-actions";
import { billingStateForTenant, type BillingState } from "@/lib/billing";
import { legalAccepted } from "@/lib/legal-state";
import { LegalAcceptGate } from "@/components/legal-accept-gate";
import { PageGate } from "@/components/page-gate";

// Fonts are bundled in the repo (src/app/fonts) so builds never depend on reaching Google Fonts.
const syne = localFont({
  src: [
    { path: "./fonts/syne-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/syne-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-syne",
  display: "swap",
});

const dmSans = localFont({
  src: [
    { path: "./fonts/dm-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

const dmMono = localFont({
  src: [{ path: "./fonts/dm-mono-latin-400-normal.woff2", weight: "400", style: "normal" }],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wyndos.io – Route Management",
  description: "Window cleaning round management app",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wyndos",
  },
  icons: {
    apple: "/icons/icon-192.png",
  },
  verification: {
    google: "Hw_XHoX_NS86rDAVSE7qL9PksCwlkcX-D0n-U05ie7A",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f172a",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  let tenantName: string | null = null;
  let activeRole: "SUPER_ADMIN" | "OWNER" | "WORKER" | null = session?.user?.role ?? null;
  let activePermissions: string[] = [];
  const companyCount = session?.user?.memberships?.length ?? 0;
  let supportSession: { reason: string; startedAt: string } | null = null;
  let billing: BillingState | null = null;
  let businessTenantId: number | null = null;

  if (session?.user) {
    const role = session.user.role;

    if (role === "SUPER_ADMIN") {
      const cookieStore = await cookies();
      const rawTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
      const rawSupportId = cookieStore.get(SUPPORT_ACCESS_COOKIE)?.value;
      const tenantId = rawTenantId ? parseInt(rawTenantId, 10) : NaN;
      const supportLogId = rawSupportId ? parseInt(rawSupportId, 10) : NaN;
      // Their own business, used as themselves (not a support session).
      const own = Number.isNaN(tenantId) ? null : resolveActiveMembership(session.user, tenantId);
      if (own) {
        tenantName = own.tenantName;
        activeRole = own.role;
        activePermissions = resolveActivePermissions(session.user, tenantId);
        billing = await billingStateForTenant(own.tenantId);
        businessTenantId = own.tenantId;
      }

      if (!Number.isNaN(tenantId)) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        });
        tenantName = tenant?.name ?? null;
      }

      if (!Number.isNaN(supportLogId)) {
        const log = await prisma.supportAccessLog.findUnique({
          where: { id: supportLogId },
          select: { reason: true, createdAt: true, endedAt: true },
        });
        if (log && !log.endedAt) {
          supportSession = {
            reason: log.reason,
            startedAt: log.createdAt.toISOString(),
          };
        }
      }
    } else {
      const cookieStore = await cookies();
      const rawTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
      const preferredTenantId = rawTenantId ? parseInt(rawTenantId, 10) : null;
      const activeMembership = resolveActiveMembership(session.user, preferredTenantId);
      tenantName = activeMembership?.tenantName ?? null;
      activeRole = activeMembership?.role ?? session.user.role ?? null;
      activePermissions = resolveActivePermissions(session.user, preferredTenantId);
      // The subscription belongs to the business: workers are covered by the owner's.
      if (activeMembership?.tenantId) billing = await billingStateForTenant(activeMembership.tenantId);
      businessTenantId = activeMembership?.tenantId ?? null;
    }
  }

  // Owners who signed up with email and password confirm the address once.
  const emailCheck = session?.user && activeRole === "OWNER"
    ? await emailVerificationState().catch(() => null)
    : null;
  // When the trial has ended only planning and the day sheets stop; customers, payments,
  // settings, backups and everything else stay open so nobody is cut off from their data.
  // Which page is open is decided in the browser (PageGate): the legal pages and support always open.
  const billingEnded = Boolean(billing && !billing.access);
  const needsLegal = Boolean(session?.user && activeRole === "OWNER" && businessTenantId)
    && !(await legalAccepted(businessTenantId!).catch(() => true));
  const showTrialBar = Boolean(billing && activeRole === "OWNER"
    && ((billing.kind === "trial" && billing.daysLeft <= 15) || billing.kind === "past_due" || billing.kind === "ended"));

  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('wyndos-theme');if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()` }} />
      </head>
      <body className="antialiased">
        {session?.user && (
          <Nav
            user={session.user}
            tenantName={tenantName}
            permissions={activePermissions}
            activeRole={activeRole}
            companyCount={companyCount}
            showBilling={activeRole === "OWNER" && Boolean(billing) && billing?.kind !== "free"}
          />
        )}
        <main className={`${session?.user ? "md:ml-56 pt-14 md:pt-0 pb-28 md:pb-0 print:m-0 print:p-0" : ""} min-h-screen`}>
          {session?.user?.role === "SUPER_ADMIN" && tenantName && supportSession && (
            <SupportSessionBanner tenantName={tenantName} reason={supportSession.reason} startedAt={supportSession.startedAt} />
          )}
          {session?.user && <div className="print:hidden"><OfflineStatus /></div>}
          <PageGate
            needsLegal={needsLegal}
            legalGate={<LegalAcceptGate />}
            billingEnded={billingEnded}
            lockScreen={<BillingLock isOwner={activeRole === "OWNER"} hadSubscription={billing?.hadSubscription} priceLabel={billing?.priceLabel} />}
            trialBar={showTrialBar && billing ? <TrialBar state={billing} /> : null}
            verifyBar={emailCheck && !emailCheck.verified ? <VerifyEmailBar email={emailCheck.email} /> : null}
          >
            {children}
          </PageGate>
        </main>
        {session?.user && <PWAInstallPrompt />}
      </body>
    </html>
  );
}
