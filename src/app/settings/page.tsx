import { getBusinessSettingsForClient, getTags, getCustomers } from "@/lib/actions";
import { listTeamMembers, listPendingInvites } from "@/lib/auth-actions";
import { requirePermission } from "@/lib/tenant-context";
import { SettingsClient } from "./settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePermission("settings");
  const [settings, tags, allCustomers] = await Promise.all([
    getBusinessSettingsForClient(),
    getTags(),
    getCustomers(),
  ]);

  // Team data is only visible to OWNER/SUPER_ADMIN — gracefully fall back for workers
  const [initialTeam, initialInvites] = await Promise.all([
    listTeamMembers().catch(() => []),
    listPendingInvites().catch(() => []),
  ]);

  const customers = allCustomers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone ?? null,
    address: c.address,
    area: c.area ? { name: c.area.name } : null,
  }));
  return (
    <SettingsClient
      settings={settings}
      canManageProviderSettings={settings.canManageProviderSettings}
      tags={tags}
      customers={customers}
      initialTeam={initialTeam}
      initialInvites={initialInvites}
    />
  );
}
