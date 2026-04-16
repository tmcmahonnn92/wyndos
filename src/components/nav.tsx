"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  CalendarDays,
  CalendarClock,
  Users,
  UserPlus,
  Zap,
  Layers,
  CreditCard,
  Receipt,
  Settings,
  Sun,
  Moon,
  LogOut,
  ShieldCheck,
  ArrowLeftRight,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/",          label: "Dashboard", icon: LayoutDashboard, desktopOnly: false, permission: "dashboard"  },
  { href: "/days",      label: "Schedule",  icon: CalendarDays,   desktopOnly: false, permission: "schedule"   },
  { href: "/scheduler", label: "Scheduler", icon: CalendarClock,  desktopOnly: true,  permission: "scheduler"  },
  { href: "/customers", label: "Customers", icon: Users,          desktopOnly: false, permission: "customers"  },
  { href: "/areas",     label: "Areas",     icon: Layers,         desktopOnly: false, permission: "areas"      },
  { href: "/payments",  label: "Payments",  icon: CreditCard,     desktopOnly: false, permission: "payments"   },
  { href: "/accounting",label: "Accounting",icon: Receipt,        desktopOnly: false, permission: "payments"   },
  { href: "/settings",  label: "Settings",  icon: Settings,       desktopOnly: false, permission: "settings"   },
];

/**
 * WyndosLogo — stacked (default) or horizontal lockup.
 * stacked: pin icon centered above wordmark + subtitle (sidebar / splash)
 * horizontal: pin left, text right (mobile header)
 */
function WyndosLogo({
  variant = "stacked",
  pinHeight = 72,
}: {
  variant?: "stacked" | "horizontal";
  pinHeight?: number;
}) {
  const pinW = Math.round(pinHeight * (64 / 84));

  const pin = (
    <svg
      width={pinW}
      height={pinHeight}
      viewBox="0 0 64 84"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
    >
      <ellipse cx="32" cy="66" rx="22" ry="6"   stroke="#3D8EF5" strokeWidth="1.5" opacity="0.22"/>
      <ellipse cx="32" cy="66" rx="15" ry="4"   stroke="#3D8EF5" strokeWidth="1.5" opacity="0.38"/>
      <ellipse cx="32" cy="66" rx="8"  ry="2.5" stroke="#3D8EF5" strokeWidth="1.5" opacity="0.55"/>
      <path d="M32 6C21.5 6 13 14.5 13 25C13 39 32 64 32 64C32 64 51 39 51 25C51 14.5 42.5 6 32 6Z" fill="#3D8EF5"/>
      <circle cx="32" cy="25" r="8" fill="#0A0E1A"/>
    </svg>
  );

  if (variant === "horizontal") {
    // Compact horizontal for mobile header
    const h = pinHeight;
    const wdFs = Math.round(h * (28 / 80));
    const subFs = Math.max(7, Math.round(h * (10 / 80)));
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "10px", userSelect: "none" }}>
        {pin}
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontFamily: "var(--font-syne), sans-serif", fontWeight: 800, fontSize: `${wdFs}px`, letterSpacing: "-0.03em", color: "#F8FAFF", lineHeight: 1, whiteSpace: "nowrap" }}>
            WYNDOS<span style={{ color: "#3D8EF5" }}>.io</span>
          </span>
          <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: `${subFs}px`, letterSpacing: "0.12em", color: "#4A5568", textTransform: "uppercase", lineHeight: 1, whiteSpace: "nowrap" }}>
            Route Management · Planning
          </span>
        </div>
      </div>
    );
  }

  // Stacked — pin centered above wordmark
  const wdFs = Math.round(pinHeight * (30 / 84));
  const subFs = Math.max(7, Math.round(pinHeight * (9 / 84)));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", userSelect: "none", maxWidth: "100%" }}>
      {pin}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}>
        <span style={{ fontFamily: "var(--font-syne), sans-serif", fontWeight: 800, fontSize: `${wdFs}px`, letterSpacing: "-0.03em", color: "#F8FAFF", lineHeight: 1, whiteSpace: "nowrap" }}>
          WYNDOS<span style={{ color: "#3D8EF5" }}>.io</span>
        </span>
        <span style={{ fontFamily: "var(--font-dm-mono), monospace", fontSize: `${subFs}px`, letterSpacing: "0.06em", color: "#4A5568", textTransform: "uppercase", lineHeight: 1, whiteSpace: "nowrap" }}>
          Route Management · Planning
        </span>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("wyndos-theme", next ? "dark" : "light");
  };

  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="p-1.5 rounded-lg transition-colors text-[#4A5568] hover:text-[#F8FAFF] hover:bg-[#131929]"
    >
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

export function Nav({
  user,
  tenantName,
  permissions = [],
  activeRole,
  companyCount = 0,
}: {
  user: {
    name?: string | null;
    email?: string | null;
    role?: string | null;
    onboardingComplete?: boolean;
  };
  tenantName?: string | null;
  permissions?: string[];
  activeRole?: string | null;
  companyCount?: number;
}) {
  const pathname = usePathname();
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const currentRole = activeRole ?? user.role;
  const isWorker = currentRole === "WORKER";
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/auth/signin" });
  };

  const shownNavItems = [
    ...navItems.filter(
      (item) => item.permission === null || !isWorker || permissions.includes(item.permission)
    ),
    ...(isSuperAdmin
      ? [{ href: "/admin", label: "Admin", icon: ShieldCheck, desktopOnly: false, permission: null }]
      : []),
  ];

  const preferredMobilePrimaryHrefs = ["/", "/days", "/customers", "/accounting", "/settings"];
  const mobilePrimaryItems = preferredMobilePrimaryHrefs
    .map((href) => shownNavItems.find((item) => item.href === href))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 5);
  const mobilePrimaryHrefSet = new Set(mobilePrimaryItems.map((item) => item.href));
  const mobileMoreItems = shownNavItems.filter((item) => !mobilePrimaryHrefSet.has(item.href));
  const leftMobileItems = mobilePrimaryItems.slice(0, 2);
  const rightMobileItems = mobilePrimaryItems.slice(2);
  const mobileQuickActions = [
    { href: "/customers?action=new-customer", label: "New Customer", icon: UserPlus },
    { href: "/accounting?action=scan-receipt", label: "Scan Receipt", icon: Receipt },
    { href: "/days?action=new-one-off", label: "One-off Job", icon: Zap },
  ];

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 min-h-screen bg-[#0A0E1A] fixed left-0 top-0 z-40">
        <div className="px-4 py-6 border-b border-[#1E2840] flex justify-center">
          <WyndosLogo variant="stacked" pinHeight={56} />
        </div>

        {/* Super-admin "viewing as" banner */}
        {isSuperAdmin && tenantName && (
          <div className="mx-3 mt-3 rounded-xl border border-blue-800/60 bg-blue-950/40 px-3 py-2.5 text-xs">
            <p className="font-semibold text-blue-300 truncate">Viewing: {tenantName}</p>
            <Link href="/admin" className="mt-1 flex items-center gap-1 text-blue-500 hover:text-blue-300">
              <ArrowLeftRight size={11} />
              Switch account
            </Link>
          </div>
        )}

        <nav className="flex flex-col gap-1 px-3 py-4 flex-1">
          {shownNavItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive(href)
                  ? "bg-[#3D8EF5] text-white"
                  : "text-[#4A5568] hover:text-white hover:bg-[#131929]"
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-[#1E2840] space-y-3">
          <div className="rounded-2xl border border-[#1E2840] bg-[#131929] px-3 py-3">
            <p className="truncate text-sm font-semibold text-white">{user.name || user.email || "Signed in"}</p>
            <p className="mt-0.5 truncate text-[11px] uppercase tracking-[0.18em] text-[#4A5568]">
              {isSuperAdmin ? "Super Admin" : currentRole === "OWNER" ? "Owner" : currentRole === "WORKER" ? "Worker" : currentRole ?? "User"}
            </p>
            {tenantName && !isSuperAdmin && (
              <p className="mt-0.5 truncate text-[11px] text-[#4A5568]">{tenantName}</p>
            )}
            {!isSuperAdmin && companyCount > 1 && (
              <Link href="/auth/company-select" className="mt-2 inline-block text-xs font-semibold text-[#3D8EF5] hover:text-[#8bbcff]">
                Switch company
              </Link>
            )}
            {!user.onboardingComplete && !isSuperAdmin && (
              <Link href="/auth/onboarding" className="mt-2 inline-block text-xs font-semibold text-[#3D8EF5] hover:text-[#8bbcff]">
                Finish setup
              </Link>
            )}
          </div>
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1E2840] px-2.5 py-1.5 text-xs font-semibold text-[#cbd5e1] hover:border-[#334155] hover:bg-[#131929] hover:text-white"
            >
              <LogOut size={13} />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile top header ─────────────────────────────────── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0A0E1A] border-b border-[#1E2840] flex items-center justify-between px-4 h-14">
        <WyndosLogo variant="horizontal" pinHeight={32} />
        <div className="flex items-center gap-2">
          {isSuperAdmin && tenantName && (
            <Link href="/admin" className="text-[10px] font-semibold uppercase tracking-[0.15em] text-blue-400">
              {tenantName}
            </Link>
          )}
          {!isSuperAdmin && companyCount > 1 && (
            <Link href="/auth/company-select" className="text-[10px] font-semibold uppercase tracking-[0.15em] text-blue-400">
              Switch
            </Link>
          )}
          {!user.onboardingComplete && !isSuperAdmin && (
            <Link href="/auth/onboarding" className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#3D8EF5]">
              Setup
            </Link>
          )}
          <button onClick={handleSignOut} className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#F8FAFF] hover:bg-[#131929]" aria-label="Sign out">
            <LogOut size={14} />
          </button>
          <ThemeToggle />
        </div>
      </header>

      {/* ── Mobile bottom tab bar ────────────────────────────── */}
      {mobileMenuOpen && <button type="button" onClick={() => setMobileMenuOpen(false)} className="md:hidden fixed inset-0 z-40 bg-slate-950/45" aria-label="Close mobile actions" />}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0A0E1A] border-t border-[#1E2840]">
        {mobileMenuOpen && (
          <div className="absolute bottom-20 left-4 right-4 rounded-3xl border border-[#1E2840] bg-[#0F1626] p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between px-1">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4A5568]">Quick Add</p>
              </div>
              <button type="button" onClick={() => setMobileMenuOpen(false)} className="rounded-full border border-[#1E2840] p-2 text-[#94a3b8]">
                <X size={14} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {mobileQuickActions.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-medium transition-colors border-[#1E2840] bg-[#131929] text-[#cbd5e1] hover:bg-[#16233D] hover:text-[#F8FAFF]"
                >
                  <Icon size={16} />
                  <span className="truncate">{label}</span>
                </Link>
              ))}
            </div>
            {mobileMoreItems.length > 0 && (
              <>
                <div className="my-2 h-px bg-[#1E2840]" />
                <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#4A5568]">More</p>
                <div className="grid grid-cols-1 gap-2">
                  {mobileMoreItems.map(({ href, label, icon: Icon }) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileMenuOpen(false)}
                      className="flex items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-medium transition-colors border-[#1E2840] bg-[#131929] text-[#cbd5e1] hover:bg-[#16233D] hover:text-[#F8FAFF]"
                    >
                      <Icon size={16} />
                      <span className="truncate">{label}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="relative flex items-center h-16 px-1">
          <div className="flex flex-1 items-center justify-around pr-7">
            {leftMobileItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors min-w-0 flex-1",
                  isActive(href) ? "text-[#3D8EF5]" : "text-[#4A5568]"
                )}
              >
                <Icon size={18} />
                <span className="text-[9px] font-medium truncate">{label}</span>
              </Link>
            ))}
          </div>
          <div className="flex flex-1 items-center justify-around pl-7">
            {rightMobileItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors min-w-0 flex-1",
                  isActive(href) ? "text-[#3D8EF5]" : "text-[#4A5568]"
                )}
              >
                <Icon size={18} />
                <span className="text-[9px] font-medium truncate">{label}</span>
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className={cn(
              "absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 inline-flex h-14 w-14 items-center justify-center rounded-full border-4 border-[#0A0E1A] shadow-lg transition-colors",
              mobileMenuOpen ? "bg-white text-[#0A0E1A]" : "bg-[#3D8EF5] text-white"
            )}
            aria-label={mobileMenuOpen ? "Close quick actions" : "Open quick actions"}
          >
            {mobileMenuOpen ? <X size={20} /> : <Plus size={22} />}
          </button>
        </div>
      </nav>
    </>
  );
}
