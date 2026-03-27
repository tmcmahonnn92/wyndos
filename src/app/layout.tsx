import type { Metadata, Viewport } from "next";
import { Syne, DM_Sans, DM_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { auth } from "@/auth";
import { Nav } from "@/components/nav";
import { SplashScreen } from "@/components/splash-screen";
import prisma from "@/lib/db";
import { ACTIVE_TENANT_COOKIE } from "@/lib/tenant-context";

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const db = prisma as any;

  let tenantName: string | null = null;

  if (session?.user) {
    const role = session.user.role;

    if (role === "SUPER_ADMIN") {
      // Read the active tenant cookie to show which round is being viewed
      const cookieStore = await cookies();
      const raw = cookieStore.get(ACTIVE_TENANT_COOKIE)?.value;
      const tenantId = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(tenantId)) {
        const tenant = await db.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        });
        tenantName = tenant?.name ?? null;
      }
    } else if (session.user.tenantId) {
      // Regular OWNER / WORKER — show their own company name
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
        {/* Prevent flash-of-wrong-theme */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('wyndos-theme');if(t==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})()` }} />
      </head>
      <body className="antialiased">
        <SplashScreen />
        {session?.user && <Nav user={session.user} tenantName={tenantName} permissions={session.user.permissions ?? []} />}
        <main className={`${session?.user ? "md:ml-56 pt-14 md:pt-0 pb-16 md:pb-0" : ""} min-h-screen`}>
          {children}
        </main>
      </body>
    </html>
  );
}
