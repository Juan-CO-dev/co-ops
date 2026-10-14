/**
 * D-66 (Juan 2026-10-13) — one bad prep row (PrepShapeError, e.g. a text par in prep_meta)
 * must not blank the AM prep / mid-day page: the page read skips that row, shows the rest and
 * names the item in a note. narrowPrepTemplateItem itself stays strict (admin, audit harness,
 * tests); the save paths skip bad rows they are not writing (tests/prep-bad-row-writers.test.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  PrepInvariantError,
  PrepShapeError,
  narrowPrepCompletion,
  narrowPrepCompletionsForPage,
  narrowPrepTemplateItem,
  narrowPrepTemplateItemsForPage,
  type SkippedPrepRow,
} from "@/lib/prep";
import { skippedRowNames } from "@/lib/prep-display-shared";
import type { ChecklistCompletion, ChecklistTemplateItem } from "@/lib/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function item(id: string, label: string, prepMeta: unknown, opts: { station?: string; es?: string } = {}): ChecklistTemplateItem {
  return {
    id,
    label,
    station: opts.station ?? "sauces",
    translations: opts.es ? { es: { label: opts.es } } : null,
    prepMeta,
  } as unknown as ChecklistTemplateItem;
}

const goodMeta = { section: "sauces", parValue: 4, parUnit: "Bottle", specialInstruction: null, columns: ["par", "total"] };
const textParMeta = { ...goodMeta, parValue: "4" }; // the #66 shape: a text par

function completion(templateItemId: string, prepData: unknown): ChecklistCompletion {
  return { id: `c-${templateItemId}`, templateItemId, prepData } as unknown as ChecklistCompletion;
}
const goodData = {
  inputs: { total: 3 },
  snapshot: { section: "sauces", itemName: "Mayo", parValue: 4, parUnit: "Bottle", specialInstruction: null },
};

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
});

describe("the strict check stays (admin, audit harness, tests)", () => {
  it("narrowPrepTemplateItem still throws PrepShapeError on a text par", () => {
    expect(() => narrowPrepTemplateItem(item("t1", "Aioli", textParMeta))).toThrow(PrepShapeError);
  });
  it("narrowPrepCompletion still throws PrepShapeError on a malformed save", () => {
    expect(() => narrowPrepCompletion(completion("t1", { inputs: { total: "3" } }))).toThrow(PrepShapeError);
  });
});

describe("narrowPrepTemplateItemsForPage — skip and flag", () => {
  it("keeps every good row, leaves out the bad one, and names it", () => {
    const skipped: SkippedPrepRow[] = [];
    const kept = narrowPrepTemplateItemsForPage(
      [item("t1", "Mayo", goodMeta), item("t2", "HC Aioli", textParMeta, { es: "Alioli HC" }), item("t3", "Pesto", goodMeta)],
      skipped,
    );
    expect(kept.map((i) => i.id)).toEqual(["t1", "t3"]);
    expect(skipped).toEqual([{ templateItemId: "t2", label: "HC Aioli", labelEs: "Alioli HC", source: "template_item" }]);
    expect(errSpy).toHaveBeenCalledOnce(); // logged for the server logs
  });

  it("a page with nothing wrong skips nothing", () => {
    const skipped: SkippedPrepRow[] = [];
    expect(narrowPrepTemplateItemsForPage([item("t1", "Mayo", goodMeta)], skipped)).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it("only PrepShapeError is tolerated — section drift (PrepInvariantError) still throws", () => {
    const drift = item("t9", "Mayo", goodMeta, { station: "veg" });
    expect(() => narrowPrepTemplateItemsForPage([drift], [])).toThrow(PrepInvariantError);
  });
});

describe("narrowPrepCompletionsForPage — a bad save does not blank the page either", () => {
  it("leaves out the bad save and names it from the template row", () => {
    const skipped: SkippedPrepRow[] = [];
    const kept = narrowPrepCompletionsForPage(
      [completion("t1", goodData), completion("t2", { inputs: { total: "3" } })],
      (id) => (id === "t2" ? { label: "HC Aioli", labelEs: null } : null),
      skipped,
    );
    expect(kept.map((c) => c.templateItemId)).toEqual(["t1"]);
    expect(skipped).toEqual([{ templateItemId: "t2", label: "HC Aioli", labelEs: null, source: "completion" }]);
  });

  it("falls back to the save's own snapshot name, then the item id", () => {
    const skipped: SkippedPrepRow[] = [];
    narrowPrepCompletionsForPage(
      [
        completion("t4", { inputs: { total: "x" }, snapshot: { itemName: "Pickles" } }),
        completion("t5", { nope: true }),
      ],
      () => null,
      skipped,
    );
    expect(skipped.map((r) => r.label)).toEqual(["Pickles", "t5"]);
  });

  it("an item flagged twice is named once", () => {
    const skipped: SkippedPrepRow[] = [];
    narrowPrepTemplateItemsForPage([item("t2", "HC Aioli", textParMeta)], skipped);
    narrowPrepCompletionsForPage([completion("t2", { bad: 1 })], () => ({ label: "HC Aioli", labelEs: null }), skipped);
    expect(skipped).toHaveLength(1);
  });
});

describe("the note", () => {
  it("names the items in the viewer's language", () => {
    const rows = [
      { label: "HC Aioli", labelEs: "Alioli HC" },
      { label: "Pesto", labelEs: null },
    ];
    expect(skippedRowNames(rows, "en")).toBe("HC Aioli, Pesto");
    expect(skippedRowNames(rows, "es")).toBe("Alioli HC, Pesto");
  });

  it("ships in en and es with the {items} slot", () => {
    for (const dict of [en, es] as Array<Record<string, string>>) {
      expect(dict["prep.skipped_rows.heading"]).toBeTruthy();
      expect(dict["prep.skipped_rows.body"]).toContain("{items}");
      expect(dict["prep.skipped_rows.body"]).not.toMatch(/may not work|es posible que guardar/);
    }
  });
});

describe("wiring — pages and save paths read tolerantly; the strict narrowing stays available", () => {
  const prep = read("lib", "prep.ts");

  it("the AM prep and mid-day pages opt in and render the note", () => {
    const am = read("app", "(authed)", "operations", "am-prep", "page.tsx");
    expect(am).toContain("tolerateBadRows: true,");
    expect(am).toContain("<PrepSkippedRowsNote rows={state.skippedRows}");
    const md = read("app", "(authed)", "operations", "mid-day", "page.tsx");
    expect(md).toContain("loadMidDayPrepState(sb, { instanceId, tolerateBadRows: true })");
    expect(md).toContain("<PrepSkippedRowsNote rows={state.skippedRows}");
  });

  it("both loaders stay strict unless a caller opts in", () => {
    expect(prep.match(/args\.tolerateBadRows\s*\?\s*narrowPrepTemplateItemsForPage\(rawItems, skippedRows\)\s*:\s*rawItems\.map\(narrowPrepTemplateItem\)/g)).toHaveLength(2);
    expect(prep.match(/args\.tolerateBadRows\s*\?\s*narrowPrepCompletionsForPage\(/g)).toHaveLength(2);
  });

  it("the mid-day save paths and the AM prep submit skip bad rows they are not writing (D-66 follow-up)", () => {
    // Phase 1 submit, Phase 2 save, finalize — behaviour in tests/prep-bad-row-writers.test.ts.
    expect(prep.match(/loadMidDayPrepState\(service, \{ instanceId: args\.instanceId, tolerateBadRows: true \}\)/g)).toHaveLength(3);
    expect(prep).not.toMatch(/loadMidDayPrepState\(service, \{ instanceId: args\.instanceId \}\)/);
    expect(prep).toContain("narrowPrepTemplateItemsForPage(((itemsRows ?? []) as TemplateItemRow[]).map(rowToTemplateItem), skipped)");
  });
});
