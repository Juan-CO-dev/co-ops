/**
 * Audit W14 / B081 — a closing "tracks this item" line resolved its referenced item on today's
 * template by LABEL with `.limit(1)` and no order. Opening templates repeat labels per station
 * ("Station appears clean as reported"), so the line could tick from ANOTHER station's
 * completion — even when the frozen reference already sat on today's template.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pickEffectiveRefItem } from "@/lib/ref-track-shared";

const LABEL = "Station appears clean as reported";

describe("pickEffectiveRefItem — the referenced item on today's template (B081)", () => {
  it("same-version reference uses its own id even when another station shares the label", () => {
    expect(
      pickEffectiveRefItem(
        { id: "x3", template_id: "T", label: LABEL, station: "3rd Party" },
        "T",
        [
          { id: "x1", station: "Crunchy Boi" },
          { id: "x3", station: "3rd Party" },
        ],
      ),
    ).toBe("x3");
  });

  it("same-version reference needs no candidates at all", () => {
    expect(pickEffectiveRefItem({ id: "x3", template_id: "T", label: LABEL, station: "3rd Party" }, "T", [])).toBe("x3");
  });

  it("cross-version: exactly one same-label item at the same station is the item", () => {
    expect(
      pickEffectiveRefItem(
        { id: "old3", template_id: "T1", label: LABEL, station: "3rd Party" },
        "T2",
        [
          { id: "n1", station: "Crunchy Boi" },
          { id: "n3", station: "3rd Party" },
        ],
      ),
    ).toBe("n3");
  });

  it("cross-version: a station-less reference matches only a station-less item", () => {
    expect(
      pickEffectiveRefItem({ id: "old", template_id: "T1", label: "Walk-out done", station: null }, "T2", [
        { id: "n1", station: "Front" },
        { id: "n2", station: null },
      ]),
    ).toBe("n2");
  });

  it("cross-version: two matches at the station refuse (never an arbitrary pick)", () => {
    expect(
      pickEffectiveRefItem({ id: "old3", template_id: "T1", label: LABEL, station: "3rd Party" }, "T2", [
        { id: "n3a", station: "3rd Party" },
        { id: "n3b", station: "3rd Party" },
      ]),
    ).toBeNull();
  });

  it("cross-version: no match at the station refuses — never another station's item, never the old id", () => {
    expect(
      pickEffectiveRefItem({ id: "old3", template_id: "T1", label: LABEL, station: "3rd Party" }, "T2", [
        { id: "n1", station: "Crunchy Boi" },
      ]),
    ).toBeNull();
    expect(pickEffectiveRefItem({ id: "old3", template_id: "T1", label: LABEL, station: "3rd Party" }, "T2", [])).toBeNull();
  });

  it("reconcileRefTrackItems resolves through the helper and no longer takes an unordered first row by label", () => {
    const src = readFileSync("lib/prep.ts", "utf8");
    const fn = src.slice(src.indexOf("async function reconcileRefTrackItems("), src.indexOf("export async function", src.indexOf("async function reconcileRefTrackItems(")));
    expect(fn).toContain("pickEffectiveRefItem(");
    expect(fn).toContain('.select("id, template_id, label, station")');
    // The old lookup: label + limit(1) on the effective template, then `?? refItem.id`.
    expect(fn).not.toMatch(/\.eq\("label", refItem\.label\)\s*\.eq\("active", true\)\s*\.limit\(1\)/);
    expect(fn).not.toContain("effRefItem?.id ?? refItem.id");
  });
});
