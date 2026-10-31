/**
 * Runs once when the server starts. Hourly jobs that must happen even if nobody opens the app:
 * trial reminder emails (3 days before and on the day a free trial ends).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const run = async () => {
    try {
      const { sendTrialReminders } = await import("@/lib/trial-reminders");
      await sendTrialReminders();
    } catch (issue) {
      console.error("[hourly] trial reminders", issue);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, 60 * 60_000);
}
