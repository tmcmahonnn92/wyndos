import { getInviteInfo } from "@/lib/auth-actions";
import { InviteAcceptForm } from "./invite-accept-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function InviteAcceptPage({ params }: Props) {
  const { token } = await params;
  const invite = await getInviteInfo(token);

  if (!invite) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-5xl">🔗</div>
          <h1 className="text-2xl font-bold text-white">Invite not found</h1>
          <p className="text-slate-400 text-sm">
            This invite link is invalid, has already been used, or has expired.
          </p>
          <Link
            href="/auth/signin"
            className="inline-block rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md items-center justify-center">
        <div className="w-full rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">

          <div className="mb-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">
              You&apos;ve been invited
            </p>
            <h1 className="text-3xl font-bold text-white">Join {invite.tenantName}</h1>
            <p className="text-sm text-slate-400">
              You&apos;ve been invited to join <strong className="text-slate-200">{invite.tenantName}</strong> as a worker.
              Create your password below to accept.
            </p>
          </div>

          <div className="mb-5 rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-slate-300">
            <span className="text-slate-500">Email: </span>{invite.email}
          </div>

          <InviteAcceptForm token={token} email={invite.email} />
        </div>
      </div>
    </div>
  );
}
