/**
 * Unit spine — the mid-day Phase 2 save under batch vs bottle (0215, plan S r4 Phase A).
 *
 * `lib/prep.ts` is a service-role module: SOURCE assertions (the house posture). The
 * NEGATIVE first: a single-box save calls save_mid_day_phase2_item_atomic with today's
 * arguments plus `p_batch: null` and keeps today's fold; the RPC body is still forbidden
 * the literal 'phase2' (tests/mid-day-phase2-supersede.test.ts owns that pin). Then: the
 * batch entry rides as p_batch, a contract refusal is a named 422, the batch fold reads
 * produced_at / made_by from the row the RPC wrote, the route parses `batch` by shape, and
 * the page assembles the row context from Phase 1's onHand (LINE) + backUp.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { batchContractCodeFromMessage, parseBatchEntryWire } from "@/lib/batch-prep-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

describe("shared wire helpers", () => {
  it("parseBatchEntryWire: absent → null; shape errors → invalid; a good payload normalises the note", () => {
    expect(parseBatchEntryWire(undefined)).toBeNull();
    expect(parseBatchEntryWire(null)).toBeNull();
    expect(parseBatchEntryWire({ batches: 1.5 })).toBe("invalid");
    expect(parseBatchEntryWire({ batches: 1, cameOutTo: -1 })).toBe("invalid");
    expect(parseBatchEntryWire({ batches: 1, overBatchReason: { code: "nope" } })).toBe("invalid");
    expect(parseBatchEntryWire({ batches: 2, cameOutTo: 8, tossed: 0, overBatchReason: { code: "other", note: "  Pete asked " } }))
      .toEqual({ batches: 2, cameOutTo: 8, tossed: 0, overBatchReason: { code: "other", note: "Pete asked" } });
  });
  it("batchContractCodeFromMessage reads the RPC's `<fn>: <code> …` prefix and nothing else", () => {
    expect(batchContractCodeFromMessage("save_mid_day_phase2_item_atomic: tossed_exceeds_backup for item x — 9 > 8")).toBe("tossed_exceeds_backup");
    expect(batchContractCodeFromMessage("save_phase2_item_atomic: over_batch_reason_missing for item x")).toBe("over_batch_reason_missing");
    expect(batchContractCodeFromMessage("save_mid_day_phase2_item_atomic: prepped_missing")).toBeNull();
    expect(batchContractCodeFromMessage("submit_phase1_atomic: ground_truth_unresolved")).toBeNull();
    expect(batchContractCodeFromMessage(null)).toBeNull();
  });
});

describe("saveMidDayPhase2Item", () => {
  const body = fnBody(read("lib", "prep.ts"), "saveMidDayPhase2Item");
  it("passes p_batch (null on single-box) as the LAST argument after today's six", () => {
    const at = body.indexOf('rpc("save_mid_day_phase2_item_atomic"');
    const call = body.slice(at, body.indexOf("});", at));
    expect(call).toContain("p_instance_id: args.instanceId,");
    expect(call).toContain("p_template_item_id: args.templateItemId,");
    expect(call).toContain("p_actor_id: args.actor.userId,");
    expect(call).toContain("p_prepped: args.prepped,");
    expect(call).toContain("p_snapshot: snapshot,");
    expect(call).toContain("p_over_under: args.overUnder ?? null,");
    expect(call).toMatch(/p_batch: args\.batch \? toBatchPayload\(args\.batch\) : null,\s*$/);
  });
  it("names a contract refusal (reason batch_contract + code) and keeps 23514 → not_in_phase2", () => {
    expect(body).toContain('if (error.code === "23514") return { ok: false, reason: "not_in_phase2" };');
    expect(body).toMatch(/batchContractCodeFromMessage\(error\.message\)/);
    expect(body).toMatch(/reason: "batch_contract", code, templateItemId: args\.templateItemId/);
  });
  it("the batch fold is chosen by the ENTRY; the single-box fold is unchanged and still the only other path", () => {
    expect(body).toMatch(/if \(item\.itemId && args\.batch\) \{/);
    expect(body).toMatch(/\} else if \(item\.itemId\) \{/);
    expect(body).toContain("outputQty: args.prepped,");
    expect(body).toMatch(/recordBatchProductionFromPrep\(args\.actor, \{/);
    // produced_at / made_by come from the row the RPC wrote, read back by id.
    expect(body).toMatch(/\.select\("prep_data, completed_at"\)/);
    expect(body).toMatch(/producedAt: record\?\.producedAt \?\? saved\?\.completed_at \?\? d0\.savedAt/);
    expect(body).toMatch(/madeBy: record\?\.madeBy \?\? args\.actor\.userId/);
    expect(body).toContain('source: "mid_day_p2",');
  });
  it("never spells the literal 'phase2' into the RPC call (the mid-day pin's reason)", () => {
    const at = body.indexOf('rpc("save_mid_day_phase2_item_atomic"');
    const call = body.slice(at, body.indexOf("});", at));
    expect(call).not.toMatch(/'phase2'/);
  });
});

describe("route, form, page, strings", () => {
  it("the route parses `batch` by shape (400 on invalid) and answers 422 <code> on a contract refusal", () => {
    const route = read("app", "api", "prep", "mid-day", "phase2", "item", "route.ts");
    expect(route).toContain('if (batch === "invalid") return { ok: false, field: "batch" };');
    expect(route).toMatch(/result\.reason === "batch_contract"/);
    expect(route).toMatch(/jsonError\(422, result\.code/);
  });
  it("the form posts `batch` only for batch items and validates before POSTing", () => {
    const form = read("components", "MidDayPhase2Form.tsx");
    expect(form).toContain("...(batchEntry ? { batch: batchEntry } : {}),");
    const validateAt = form.indexOf("validateBatchEntry(batchEntry");
    const fetchAt = form.indexOf('fetch("/api/prep/mid-day/phase2/item"');
    expect(validateAt).toBeGreaterThan(-1);
    expect(validateAt).toBeLessThan(fetchAt);
  });
  it("the page builds the row context from Phase 1's onHand (LINE) + backUp and hydrates prep_data.batch", () => {
    const page = read("app", "(authed)", "operations", "mid-day", "page.tsx");
    expect(page).toMatch(/backupBefore: comp\?\.prepData\?\.inputs\.backUp \?\? null/);
    expect(page).toMatch(/need: needForLine\(par, onHand\)/);
    expect(page).toMatch(/readBatchFromPrepData\(comp\?\.prepData\)/);
    expect(page).toMatch(/initialPrepped: batchRecord \? batchRecord\.bottled : prepped/);
  });
  it("mid_day_prep.phase2.batch_incomplete exists in en and es", () => {
    expect((en as Record<string, string>)["mid_day_prep.phase2.batch_incomplete"]).toBeTruthy();
    expect((es as Record<string, string>)["mid_day_prep.phase2.batch_incomplete"]).toBeTruthy();
  });
});
