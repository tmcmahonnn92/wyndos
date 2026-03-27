import { auth } from "@/auth";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-2xl items-center justify-center">
        <div className="w-full rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8 lg:p-10">

          <div className="mb-6 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-400">
              Welcome, {session?.user?.name?.split(" ")[0] ?? "there"}!
            </p>
            <h1 className="text-3xl font-bold text-white">Set up your business</h1>
            <p className="text-sm leading-6 text-slate-400">
              Tell us a bit about your window cleaning business. You can update these details
              any time from Settings.
            </p>
          </div>

          <OnboardingForm
            initialCompanyName={session?.user?.name ? `${session.user.name}'s Window Cleaning` : ""}
            initialOwnerName={session?.user?.name ?? ""}
          />
        </div>
      </div>
    </div>
  );
}
