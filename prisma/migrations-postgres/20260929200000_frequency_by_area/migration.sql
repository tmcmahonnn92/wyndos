-- Frequency belongs to the area: each frequency has its own area.
-- Customers whose own frequency differed from their (weekly) area move into
-- "<area> (N weekly)", created here if needed, so nobody's cleaning cycle changes.
INSERT INTO "Area" ("tenantId", "name", "color", "sortOrder", "scheduleType", "frequencyWeeks", "isSystemArea")
SELECT DISTINCT c."tenantId", a."name" || ' (' || c."frequencyWeeks" || ' weekly)', a."color", a."sortOrder", 'WEEKLY', c."frequencyWeeks", false
FROM "Customer" c
JOIN "Area" a ON a."id" = c."areaId"
WHERE a."isSystemArea" = false AND a."scheduleType" = 'WEEKLY'
  AND c."frequencyWeeks" <> a."frequencyWeeks" AND c."frequencyWeeks" BETWEEN 1 AND 104
ON CONFLICT ("tenantId", "name") DO NOTHING;

UPDATE "Customer" SET "areaId" = (
  SELECT n."id" FROM "Area" a
  JOIN "Area" n ON n."tenantId" = a."tenantId" AND n."name" = a."name" || ' (' || "Customer"."frequencyWeeks" || ' weekly)'
  WHERE a."id" = "Customer"."areaId"
)
WHERE EXISTS (
  SELECT 1 FROM "Area" a
  WHERE a."id" = "Customer"."areaId" AND a."isSystemArea" = false AND a."scheduleType" = 'WEEKLY'
    AND "Customer"."frequencyWeeks" <> a."frequencyWeeks" AND "Customer"."frequencyWeeks" BETWEEN 1 AND 104
);

-- Everyone else simply follows their area.
UPDATE "Customer" SET "frequencyWeeks" = (SELECT a."frequencyWeeks" FROM "Area" a WHERE a."id" = "Customer"."areaId")
WHERE EXISTS (SELECT 1 FROM "Area" a WHERE a."id" = "Customer"."areaId" AND a."isSystemArea" = false);
