import { getAreas } from "@/lib/actions";
import { requirePermission } from "@/lib/tenant-context";
import { ImportClient } from "./import-client";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  await requirePermission("customers");
  const areas = await getAreas();
  const areaOptions = areas
    .filter((a) => !a.isSystemArea)
    .map((a) => ({ id: a.id, name: a.name, color: a.color, frequencyWeeks: a.frequencyWeeks }));

  return <ImportClient areas={areaOptions} />;
}
