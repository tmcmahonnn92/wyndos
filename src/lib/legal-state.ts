import prisma from "@/lib/db";
import { TERMS_VERSION } from "@/lib/legal";

/** Has this business accepted the current terms and confirmed it may hold its customers' details? */
export async function legalAccepted(tenantId: number): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { termsVersion: true, dataPermissionAcceptedAt: true },
  });
  if (!tenant) return true;
  return tenant.termsVersion === TERMS_VERSION && tenant.dataPermissionAcceptedAt !== null;
}
