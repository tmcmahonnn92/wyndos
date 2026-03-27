import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { listAllTenants } from "@/lib/auth-actions";
import { TenantSwitcher } from "./tenant-switcher";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();

  if (session?.user?.role !== "SUPER_ADMIN") redirect("/");

  const tenants = await listAllTenants();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-8">

        {/* Header */}
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">
            Super Admin
          </p>
          <h1 className="text-3xl font-bold text-white">All Accounts</h1>
          <p className="text-sm text-slate-400">
            {tenants.length} window cleaning {tenants.length === 1 ? "business" : "businesses"} registered.
            Select one to view their data.
          </p>
        </div>

        {/* Tenant list */}
        {tenants.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-500">
            No accounts registered yet.
          </div>
        ) : (
          <TenantSwitcher tenants={tenants} />
        )}

      </div>
    </div>
  );
}
