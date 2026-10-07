/**
 * Unit spine — the read surfaces of batch vs bottle (0215, plan S r4 Phase A, group 8).
 *
 * Reports, the production log, the counts panel and the AM prep hint all READ what the
 * two Phase 2 saves store. Each is a service-role module or a server component, so the
 * guarantees are SOURCE assertions plus the pure parser they share, and the en + es strings
 * behind every new key. The NEGATIVE in each case: a single-box row / header / line renders
 * exactly as before (the batch branch is gated on a field that is null there).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { readPhase2Outcome } from "@/lib/reports-hub";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("reports hub — readPhase2Outcome carries the batch object", () => {
  it("a single-box phase2 row reads batch: null and everything else as before", () => {
    const out = readPhase2Outcome({ phase2: { opener_prepped: 6, over_under_status: "at_par", saved_by: "u1", saved_at: "2026-10-07T12:00:00Z" } });
    expect(out?.openerPrepped).toBe(6);
    expect(out?.batch).toBeNull();
  });
  it("a batch row reads the record whole; a half record (missing backup_after) is null, not half", () => {
    const full = { batches: 2, came_out_to: 8, bottled: 6, tossed: 0, backup_before: 2, backup_after: 4, yield_at_time: 4, made_by: "u9", over_batch_reason: { code: "busy_day_expected", note: null } };
    const out = readPhase2Outcome({ phase2: { opener_prepped: 6, batch: full } });
    expect(out?.batch?.batches).toBe(2);
    expect(out?.batch?.madeBy).toBe("u9");
    expect(out?.batch?.overBatchReason).toEqual({ code: "busy_day_expected", note: null });
    const { backup_after: _dropped, ...half } = full;
    void _dropped;
    expect(readPhase2Outcome({ phase2: { opener_prepped: 6, batch: half } })?.batch).toBeNull();
  });
  it("the detail resolves made_by through the same name map as saved_by / directed_by", () => {
    const src = read("lib", "reports-hub.ts");
    expect(src).toContain("p2?.batch?.madeBy ?? null]");
    expect(src).toMatch(/madeByName: p2\.batch\?\.madeBy \? \(nameById\.get\(p2\.batch\.madeBy\) \?\? null\) : null/);
    const view = read("components", "reports-hub", "OpeningReportDetail.tsx");
    expect(view).toMatch(/phase2\.batch !== null && \(/);
    expect(view).toContain('t("reports.opening.batch_line"');
  });
});

describe("production log, counts panel, AM prep hint", () => {
  it("loadRecentProductions selects the three new columns and names the maker; the page branches on batches_made", () => {
    const lib = read("lib", "production.ts");
    expect(lib).toContain('select("id, produced_at, output_item_id, output_qty, batches_made, came_out_to, made_by")');
    expect(lib).toMatch(/batchesMade: num\(r\.batches_made\)/);
    const page = read("app", "(authed)", "operations", "production", "page.tsx");
    expect(page).toMatch(/p\.batchesMade !== null && p\.batchesMade > 0/);
    expect(page).toContain('"production.recent.line_batch"');
    expect(page).toContain('"production.recent.line", { input:');
  });
  it("prep waste rides ONLY on loadOnHand (the counts surface), reads tossed_qty > 0, and the panel is default-collapsed", () => {
    const counts = read("lib", "counts.ts");
    const loadOnHandAt = counts.indexOf("export async function loadOnHand(");
    const loadOnHandBody = counts.slice(loadOnHandAt, counts.indexOf("\n}\n", loadOnHandAt));
    expect(loadOnHandBody).toContain("prepWaste: await loadPrepWasteRows(");
    const derivedAt = counts.indexOf("export async function loadOnHandDerived(");
    expect(counts.slice(derivedAt)).not.toContain("loadPrepWasteRows(");
    expect(counts).toMatch(/\.from\("prep_batch_sessions"\)[\s\S]*?\.gt\("tossed_qty", 0\)/);
    const panel = read("components", "counts", "OnHandPanel.tsx");
    expect(panel).toMatch(/<details className=/);
    expect(panel).not.toMatch(/<details open/);
    expect(panel).toContain('"counts.prep_waste.title"');
  });
  it("the AM prep hint is a label-only addition gated on batchMode AND a back_up column", () => {
    const row = read("components", "prep", "PrepRow.tsx");
    expect(row).toMatch(/batchMode && inputColumns\.includes\("back_up"\)/);
    expect(row).toContain('t("am_prep.back_up.bulk_hint")');
    const lib = read("lib", "prep.ts");
    expect(lib).toMatch(/if \(ctx\?\.batchMode\) batchModeByItem\[tItem\.id\] = true;/);
  });
  it("the tenancy test knows prep_batch_sessions and the three RPCs that write it", () => {
    const t = read("tests", "location-bind-differential.test.ts");
    expect(t).toContain('"prep_batch_sessions"');
    for (const r of ["save_phase2_item_atomic", "save_mid_day_phase2_item_atomic", "revoke_phase2_item_atomic"]) expect(t).toContain(`"${r}"`);
  });
  it.each([
    "reports.opening.batch_line", "reports.opening.batch_tossed", "reports.opening.batch_reason", "reports.opening.batch_made_by",
    "production.recent.line_batch",
    "counts.prep_waste.title", "counts.prep_waste.hint", "counts.prep_waste.line",
    "am_prep.back_up.bulk_hint",
  ])("%s exists in en and es", (key) => {
    expect((en as Record<string, string>)[key]).toBeTruthy();
    expect((es as Record<string, string>)[key]).toBeTruthy();
  });
});

describe("docs", () => {
  it("AGENTS.md names 0215 as authored, NOT applied", () => {
    expect(read("AGENTS.md")).toMatch(/0215 = `batch_vs_bottle`[^·]*NOT applied/);
  });
});
