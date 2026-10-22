"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/db";
import { auth } from "@/auth";
import { requireSuperAdmin } from "@/lib/tenant-context";
import { deleteBusinessData } from "@/lib/delete-business";

/** What deleting this business would remove, for the admin's confirm box. */
export async function adminDeletePreview(tenantId: number) {
  await requireSuperAdmin();
  const id = Number(tenantId);
  const members = await prisma.membership.findMany({ where: { tenantId: id }, select: { userId: true, user: { select: { email: true, role: true } } } });
  const kept: string[] = [];
  let removed = 0;
  for (const m of members) {
    const others = await prisma.membership.count({ where: { userId: m.userId, tenantId: { not: id } } });
    if (others > 0 || m.user.role === "SUPER_ADMIN") kept.push(m.user.email); else removed++;
  }
  const [customers, payments, settings] = await Promise.all([
    prisma.customer.count({ where: { tenantId: id } }),
    prisma.payment.count({ where: { tenantId: id } }),
    prisma.tenantSettings.findUnique({ where: { tenantId: id }, select: { goCardlessAccessToken: true } }).catch(() => null),
  ]);
  return { customers, payments, loginsRemoved: removed, loginsKept: kept, goCardless: Boolean(settings?.goCardlessAccessToken) };
}

/**
 * Super admin: delete one business and all its data. Its name must be typed to confirm.
 * People who also work for another business keep their login and that business.
 */
export async function adminDeleteBusiness(tenantId: number, typedName: string) {
  await requireSuperAdmin();
  const session = await auth();
  const id = Number(tenantId);
  const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!tenant) throw new Error("That business no longer exists.");
  if (typedName.trim().toLowerCase() !== tenant.name.trim().toLowerCase()) throw new Error("Type the business name exactly to confirm.");
  await deleteBusinessData(id);
  console.info(`[admin] business ${id} "${tenant.name}" deleted by ${session?.user?.email ?? session?.user?.id}`);
  revalidatePath("/admin");
  return { ok: true };
}
