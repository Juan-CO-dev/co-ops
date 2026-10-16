/**
 * B6 / #58 grep pin -- a stored UTC timestamp must NEVER be shown (or compared as
 * "today") through a UTC slice: `iso.slice(0, 10)` / `new Date().toISOString().slice(0, 10)`
 * is the UTC date, which is TOMORROW for anything written after 8 PM ET. Display
 * dates go through `etDisplayDate` / `etCalendarDate` (lib/operational-day.ts).
 *
 * Pure calendar-grid arithmetic on an existing YYYY-MM-DD (addDays and friends)
 * is fine and is not what this pins.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// The user-visible display / "today" sites fixed in B6.
const FIXED_SITES = [
  "components/maintenance/EquipmentOverview.tsx",
  "components/maintenance/EquipmentDetail.tsx",
  "lib/maintenance.ts",
  "app/admin/customers/consent/page.tsx",
  "app/admin/customers/page.tsx",
  "app/admin/page.tsx",
  "components/admin/skus/SkuLocationOverlay.tsx",
  "components/admin/weights/WeightBoardClient.tsx",
  "components/catering/InsightsClient.tsx",
  "components/counts/OnHandPanel.tsx",
  "components/receiving/VendorClaimPanel.tsx",
  "components/written-reports/WrittenReportsClient.tsx",
  "components/prep/BatchEntryFields.tsx",
  "components/MidDayPhase2Form.tsx",
  "components/opening/OpeningPrepEntry.tsx",
  "lib/batch-prep-shared.ts",
  // Catalog pages (2b SKU page fixed in 3b, CC note 9; the 3b pages were born on the ET helper).
  "components/catalog/SkuItemClient.tsx",
  "components/catalog/MenuItemClient.tsx",
  "components/catalog/RecipeItemClient.tsx",
  "components/catalog/ShopChangesClient.tsx",
  "components/catalog/RecipeNoticesClient.tsx",
];

const UTC_SLICE = /\.(?:slice|substring)\(\s*0\s*,\s*10\s*\)/;

describe("no UTC date slices on timestamps in maintenance code", () => {
  const maintenanceFiles = readdirSync(join(ROOT, "components/maintenance"))
    .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
    .map((f) => `components/maintenance/${f}`);
  for (const rel of [...maintenanceFiles, "lib/maintenance.ts", "app/(authed)/maintenance/page.tsx"]) {
    it(`${rel} has no .slice(0, 10)`, () => {
      expect(read(rel)).not.toMatch(UTC_SLICE);
    });
  }
});

describe("the other B6-fixed display sites stay on the ET helpers", () => {
  for (const rel of FIXED_SITES) {
    it(`${rel} has no .slice(0, 10) and uses an ET helper`, () => {
      const src = read(rel);
      expect(src).not.toMatch(UTC_SLICE);
      expect(src).toMatch(/etDisplayDate|etCalendarDate/);
    });
  }
});
