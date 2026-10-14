/**
 * B1 #2 (guide-testing triage 2026-10-13) — a finalized mid-day prep (status phase2_complete)
 * rendered the old "forms ship in the next build" placeholder. The read-only finalized view's
 * rows come from one pure function (lib/mid-day-shared.ts midDayFinalizedRows).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { midDayFinalizedRows } from "@/lib/mid-day-shared";

const item = (id: string, par: number | null, section = "sauces", parUnit: string | null = "1/3 Pan") => ({
  id,
  label: `Item ${id}`,
  station: section,
  prepMeta: { section, parValue: par, parUnit },
});

describe("midDayFinalizedRows", () => {
  it("one row per template item, in template order, with need from the count and made from the save", () => {
    const rows = midDayFinalizedRows(
      [item("a", 6), item("b", 4, "veg", "Qt")],
      [
        { templateItemId: "a", completedAt: "2026-10-13T15:00:00Z", prepData: { inputs: { onHand: 2, total: 4 } } },
        { templateItemId: "b", completedAt: "2026-10-13T15:01:00Z", prepData: { inputs: { onHand: 1, total: 3 } } },
      ],
    );
    expect(rows).toEqual([
      { id: "a", label: "Item a", section: "sauces", parUnit: "1/3 Pan", need: 4, made: 4 },
      { id: "b", label: "Item b", section: "veg", parUnit: "Qt", need: 3, made: 3 },
    ]);
  });

  it("reads the LATEST live completion per item", () => {
    const [row] = midDayFinalizedRows(
      [item("a", 6)],
      [
        { templateItemId: "a", completedAt: "2026-10-13T16:00:00Z", prepData: { inputs: { onHand: 2, total: 5 } } },
        { templateItemId: "a", completedAt: "2026-10-13T15:00:00Z", prepData: { inputs: { onHand: 2, total: 4 } } },
      ],
    );
    expect(row?.made).toBe(5);
  });

  it("an item never saved in Phase 2 has made = null (a Phase 1 count is not a save)", () => {
    const [row] = midDayFinalizedRows(
      [item("a", 6)],
      [{ templateItemId: "a", completedAt: "2026-10-13T15:00:00Z", prepData: { inputs: { onHand: 5 } } }],
    );
    expect(row).toMatchObject({ need: 1, made: null });
  });

  it("an item with no completion at all has need and made null", () => {
    expect(midDayFinalizedRows([item("a", 6)], [])).toEqual([
      { id: "a", label: "Item a", section: "sauces", parUnit: "1/3 Pan", need: null, made: null },
    ]);
  });

  it("no par → need null; the need never goes below zero", () => {
    const rows = midDayFinalizedRows(
      [item("a", null), item("b", 2)],
      [
        { templateItemId: "a", completedAt: "t", prepData: { inputs: { onHand: 1, total: 2 } } },
        { templateItemId: "b", completedAt: "t", prepData: { inputs: { onHand: 5, total: 0 } } },
      ],
    );
    expect(rows.map((r) => [r.need, r.made])).toEqual([[null, 2], [0, 0]]);
  });

  it("a batch item's made is the BOTTLED number from its batch save, never the derived count total", () => {
    const counted = { inputs: { onHand: 2, backUp: 8, total: 10 } };
    const saved = {
      inputs: { onHand: 2, backUp: 8, total: 2 },
      batch: { batches: 0, came_out_to: 0, bottled: 2, tossed: 0, backup_before: 8, backup_after: 6, yield_at_time: 4, need_for_line: 2, min_batches: 0 },
    };
    expect(midDayFinalizedRows([item("a", 4)], [{ templateItemId: "a", completedAt: "t", prepData: counted }], { a: true })[0]?.made).toBeNull();
    expect(midDayFinalizedRows([item("a", 4)], [{ templateItemId: "a", completedAt: "t", prepData: saved }], { a: true })[0]?.made).toBe(2);
  });

  it("falls back to station, then Misc, for the section", () => {
    const rows = midDayFinalizedRows(
      [
        { id: "x", label: "X", station: "Cooks", prepMeta: null },
        { id: "y", label: "Y", station: null, prepMeta: null },
      ],
      [],
    );
    expect(rows.map((r) => r.section)).toEqual(["Cooks", "Misc"]);
  });
});

describe("the finalized mid-day page", () => {
  const page = readFileSync("app/(authed)/operations/mid-day/page.tsx", "utf8");

  it("no longer carries the 'next build' placeholder", () => {
    expect(page).not.toContain("forms_pending");
    expect(readFileSync("lib/i18n/en.json", "utf8")).not.toContain("mid_day_prep.page.forms_pending");
    expect(readFileSync("lib/i18n/es.json", "utf8")).not.toContain("mid_day_prep.page.forms_pending");
  });

  it("renders the finalized banner, heading and rows from midDayFinalizedRows", () => {
    expect(page).toContain("midDayFinalizedRows(");
    expect(page).toContain('"dashboard.mid_day_prep.finalized_by"');
    expect(page).toContain('"mid_day_prep.page.finalized_heading"');
    expect(page).toContain("formatPrepQty(");
  });
});
