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

/**
 * An error nobody caught while handling a page, server action or API call: email Tom
 * (at most once an hour for the same error). Redirects and "not found" aren't errors.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  try {
    const digest = String((error as { digest?: unknown })?.digest ?? "");
    if (digest.startsWith("NEXT_") || digest === "DYNAMIC_SERVER_USAGE") return;
    const message = error instanceof Error ? error.message : String(error);
    let h = 5381;
    for (const ch of `${context.routePath}|${message.slice(0, 200)}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    const key = `req:${h.toString(36)}`;
    const { alertAdmin } = await import("@/lib/alerts");
    await alertAdmin(key, `Server error on ${context.routePath || request.path}`, error, {
      Path: request.path.split("?")[0],
      Method: request.method,
      Kind: context.routeType,
      Digest: digest || undefined,
    });
  } catch {
    // never let reporting break anything
  }
}
