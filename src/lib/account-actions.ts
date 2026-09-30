"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { getActor } from "@/lib/guards";
import { notifyPrefsOf, type NotifyPrefs } from "@/lib/notifications";
import { platformEmailConfigured } from "@/lib/platform-email";
import { parsePermissions } from "@/lib/permissions";

/** The signed-in person's email notification choices for this business. */
export async function getMyNotifyPrefs() {
  const actor = await getActor();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId: actor.userId, tenantId: actor.tenantId } },
    select: { notifyPrefs: true, role: true, permissions: true, user: { select: { email: true } } },
  });
  const role = membership?.role ?? "OWNER";
  return {
    prefs: notifyPrefsOf(membership?.notifyPrefs, role),
    email: membership?.user.email ?? "",
    // Day emails only go to people who plan the round.
    followsDays: role === "OWNER" || parsePermissions(membership?.permissions).includes("scheduler"),
    emailReady: platformEmailConfigured(),
  };
}

export async function saveMyNotifyPrefs(prefs: NotifyPrefs) {
  const actor = await getActor();
  const clean: NotifyPrefs = { dayStarted: !!prefs.dayStarted, dayCompleted: !!prefs.dayCompleted, workAssigned: !!prefs.workAssigned };
  await prisma.membership.update({
    where: { userId_tenantId: { userId: actor.userId, tenantId: actor.tenantId } },
    data: { notifyPrefs: JSON.stringify(clean) },
  });
  revalidatePath("/account");
  return clean;
}
