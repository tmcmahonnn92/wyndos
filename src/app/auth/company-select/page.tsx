import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { normalizeMemberships } from "@/lib/memberships";

export const dynamic = "force-dynamic";

export default async function CompanySelectPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/signin");
  }

  if (session.user.role === "SUPER_ADMIN") {
    redirect("/admin");
  }

  const memberships = normalizeMemberships(session.user.memberships);
  if (memberships.length <= 1) {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center justify-center">
        <div className="w-full rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
          <div className="mb-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">Choose company</p>
            <h1 className="text-3xl font-bold text-white">Select where you want to work</h1>
            <p className="text-sm text-slate-400">
              Your account is linked to more than one company. Pick the company you want to use for this session.
            </p>
          </div>

          <div className="space-y-3">
            {memberships.map((membership) => (
              <form key={membership.tenantId} action="/api/auth/select-company" method="post" className="rounded-2xl border border-slate-700 bg-slate-800/50 p-4">
                <input type="hidden" name="tenantId" value={membership.tenantId} />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-white">{membership.tenantName}</p>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{membership.role === "OWNER" ? "Owner access" : "Worker access"}</p>
                  </div>
                  <button
                    type="submit"
                    className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
                  >
                    Open company
                  </button>
                </div>
              </form>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}