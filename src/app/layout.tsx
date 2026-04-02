import type { Metadata, Viewport } from "next";
import { Syne, DM_Sans, DM_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { auth } from "@/auth";
import { Nav } from "@/components/nav";
import { SplashScreen } from "@/components/splash-screen";
import { SupportSessionBanner } from "@/components/support-session-banner";
import prisma from "@/lib/db";
import { ACTIVE_TENANT_COOKIE, SUPPORT_ACCESS_COOKIE } from "@/lib/auth-cookies";

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wyndos.io – Route Management",
  description: "Window cleaning round management app",
  verification: {
    google: "Hw_XHoX_NS86rDAVSE7qL9PksCwlkcX-D0n-U05ie7A",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const db = prisma as any;

  let tenantName: string | null = null;
  let supportSession: { reason: string; startedAt: string } | null = null;

  if (session?.user) {
    const role = session.user.role;

    if (role === "SUPER_ADMIN") {
      const cookieStore = await cookies();
      const rawTenantId = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
      const rawSupportId = cookieStore.get(SUPPORT_ACCESS_COOKIE)?.value;
      const tenantId = rawTenantId ? parseInt(rawTenantId, 10) : NaN;
      const supportLogId = rawSupportId ? parseInt(rawSupportId, 10) : NaN;

      if (!Number.isNaN(tenantId)) {
        const tenant = await db.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        });
        tenantName = tenant?.name ?? null;
      }

      if (!Number.isNaN(supportLogId)) {
        const log = await db.supportAccessLog.findUnique({
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
    } else if (session.user.tenantId) {
      const tenant = await db.tenant.findUnique({
        where: { id: session.user.tenantId },
        select: { name: true },
      });
      tenantName = tenant?.name ?? null;
    }
  }

  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('wyndos-theme');if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()` }} />
      </head>
      <body className="antialiased">
        <SplashScreen />
        {session?.user && <Nav user={session.user} tenantName={tenantName} permissions={session.user.permissions ?? []} />}
        <main className={`${session?.user ? "md:ml-56 pt-14 md:pt-0 pb-16 md:pb-0" : ""} min-h-screen`}>
          {session?.user?.role === "SUPER_ADMIN" && tenantName && supportSession && (
            <SupportSessionBanner tenantName={tenantName} reason={supportSession.reason} startedAt={supportSession.startedAt} />
          )}
          {children}
        </main>
      </body>
    </html>
  );
}
