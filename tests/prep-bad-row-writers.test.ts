/**
 * D-66 (Juan 2026-10-13, CC follow-up) — "skip the row and flag it" means the shift keeps going:
 * the SAVE paths also tolerate a bad prep row they are not writing.
 *
 *   - AM prep submit, mid-day Phase 1 submit, Phase 2 save and finalize skip a row whose stored
 *     shape is bad (PrepShapeError), do not require it, and report it as `skipped`.
 *   - A write that TARGETS the bad row is refused (bad_row / PrepShapeError) — nothing is ever
 *     written from a malformed row.
 *
 * Behaviour tests against an in-memory Supabase stand-in (no database): the access check is
 * stubbed, every other line of the writers runs for real, and the RPC calls are recorded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assignments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assignments")>()),
  hasTaskAccess: vi.fn(async () => true),
  auditTaskOverride: vi.fn(async () => {}),
}));
// Registry-linked rows reach the recipe graph; stand in for it (no database here).
vi.mock("@/lib/batch-prep", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/batch-prep")>()),
  loadBatchContextForItems: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/prep-consumption", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/prep-consumption")>()),
  loadDerivedForItems: vi.fn(async () => new Map()),
  loadBatchDerivedForItems: vi.fn(async () => new Map()),
}));

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadBatchContextForItems } from "@/lib/batch-prep";
import type { BatchItemContext } from "@/lib/batch-prep-shared";
import {
  PrepInvariantError,
  PrepShapeError,
  excludeSkippedTargets,
  finalizeMidDayPhase2,
  loadAmPrepState,
  saveMidDayPhase2Item,
  submitAmPrep,
  submitMidDayPhase1,
} from "@/lib/prep";

// ── an in-memory stand-in for the service-role client ───────────────────────

type Row = Record<string, unknown>;
interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

function fakeService(tables: Record<string, Row[]>, rpcResult: (name: string, params: Record<string, unknown>) => unknown) {
  const rpcCalls: RpcCall[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let patch: Row | null = null;
    const pick = () => (rows[0] ? (patch ? { ...rows[0], ...patch } : rows[0]) : null);
    const b: Record<string, unknown> = {};
    const self = () => b;
    Object.assign(b, {
      select: self,
      is: self,
      in: self,
      order: self,
      limit: self,
      returns: self,
      gt: self,
      gte: self,
      lt: self,
      insert: self,
      upsert: self,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => !(col in r) || r[col] === val);
        return b;
      },
      update: (p: Row) => {
        patch = p;
        return b;
      },
      maybeSingle: async () => ({ data: pick(), error: null }),
      single: async () => ({ data: pick(), error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null, count: rows.length }).then(res, rej),
    });
    return b;
  };
  const rpc = async (name: string, params: Record<string, unknown>) => {
    rpcCalls.push({ name, params });
    return { data: rpcResult(name, params), error: null };
  };
  return { service: { from, rpc } as unknown as SupabaseClient, rpcCalls };
}

// ── fixtures: one good row, one bad row (a text par — the #66 shape) ─────────

const ACTOR = { userId: "u-1", role: "employee", level: 3 } as const;
const LOC = "loc-1";
const DATE = "2026-10-13";
const TEMPLATE = "tmpl-1";
const INSTANCE = "inst-1";
const GOOD = "item-good";
const BAD = "item-bad";

const goodMeta = { section: "sauces", parValue: 4, parUnit: "Bottle", specialInstruction: null, columns: ["par", "total"] };
const items: Row[] = [
  { id: GOOD, template_id: TEMPLATE, station: "sauces", label: "Mayo", display_order: 1, active: true, item_id: null, translations: null, prep_meta: goodMeta },
  { id: BAD, template_id: TEMPLATE, station: "sauces", label: "HC Aioli", display_order: 2, active: true, item_id: null, translations: null, prep_meta: { ...goodMeta, parValue: "4" } },
];

function instance(status: string): Row {
  return {
    id: INSTANCE, template_id: TEMPLATE, location_id: LOC, date: DATE, status,
    shift_start_at: null, confirmed_at: null, confirmed_by: null, created_at: "2026-10-13T12:00:00Z",
    triggered_by_user_id: null, triggered_at: null,
  };
}

function midDayTables(status: string, completions: Row[] = []): Record<string, Row[]> {
  return {
    checklist_instances: [instance(status)],
    checklist_templates: [{ id: TEMPLATE, name: "Mid-day prep", type: "prep", prep_subtype: "mid_day_prep" }],
    checklist_template_items: items,
    checklist_completions: completions,
    users: [],
    prep_sections: [],
  };
}

const SKIPPED_BAD = { templateItemId: BAD, label: "HC Aioli", labelEs: null, source: "template_item" };

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("mid-day Phase 1 submit", () => {
  it("succeeds with one bad row it is not writing, and reports that row as skipped", async () => {
    const { service, rpcCalls } = fakeService(midDayTables("open"), () => ({ instance: instance("phase1_complete") }));
    const res = await submitMidDayPhase1(service, {
      instanceId: INSTANCE,
      actor: ACTOR,
      entries: [{ templateItemId: GOOD, inputs: { onHand: 2 } }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.skipped).toEqual([SKIPPED_BAD]);
    expect(rpcCalls.map((c) => c.name)).toEqual(["submit_mid_day_phase1_atomic"]);
    const entries = rpcCalls[0]!.params.p_entries as Array<{ templateItemId: string }>;
    expect(entries.map((e) => e.templateItemId)).toEqual([GOOD]);
    expect(errSpy).toHaveBeenCalled(); // the skip is logged
  });

  it("refuses an entry that targets the bad row, before any write", async () => {
    const { service, rpcCalls } = fakeService(midDayTables("open"), () => ({ instance: instance("phase1_complete") }));
    const res = await submitMidDayPhase1(service, {
      instanceId: INSTANCE,
      actor: ACTOR,
      entries: [{ templateItemId: GOOD, inputs: { onHand: 2 } }, { templateItemId: BAD, inputs: { onHand: 1 } }],
    });
    expect(res).toEqual({ ok: false, reason: "bad_row", templateItemId: BAD });
    expect(rpcCalls).toEqual([]);
  });
});

describe("mid-day Phase 2 save", () => {
  it("saves a good row while another row is bad", async () => {
    const { service, rpcCalls } = fakeService(midDayTables("phase1_complete"), () => ({ completionId: "c-9", savedAt: "2026-10-13T15:00:00Z" }));
    const res = await saveMidDayPhase2Item(service, { instanceId: INSTANCE, templateItemId: GOOD, prepped: 4, actor: ACTOR });
    expect(res).toEqual({ ok: true, completionId: "c-9", savedAt: "2026-10-13T15:00:00Z" });
    expect(rpcCalls.map((c) => c.name)).toEqual(["save_mid_day_phase2_item_atomic"]);
  });

  it("refuses a save that targets the bad row", async () => {
    const { service, rpcCalls } = fakeService(midDayTables("phase1_complete"), () => ({ completionId: "c-9", savedAt: "x" }));
    const res = await saveMidDayPhase2Item(service, { instanceId: INSTANCE, templateItemId: BAD, prepped: 4, actor: ACTOR });
    expect(res).toEqual({ ok: false, reason: "bad_row", templateItemId: BAD });
    expect(rpcCalls).toEqual([]);
  });
});

describe("mid-day finalize", () => {
  it("finalizes with one bad row (not required) and reports it as skipped", async () => {
    const { service } = fakeService(midDayTables("phase1_complete"), () => null);
    const res = await finalizeMidDayPhase2(service, { instanceId: INSTANCE, actor: ACTOR });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.instance.status).toBe("phase2_complete");
      expect(res.skipped).toEqual([SKIPPED_BAD]);
    }
  });

  it("a malformed SAVED count on another row does not block finalize either", async () => {
    const badSave: Row = { id: "c-bad", instance_id: INSTANCE, template_item_id: GOOD, completed_by: "u-1", completed_at: "2026-10-13T14:00:00Z", prep_data: { inputs: { total: "3" } }, edit_count: 0 };
    const { service } = fakeService(midDayTables("phase1_complete", [badSave]), () => null);
    const res = await finalizeMidDayPhase2(service, { instanceId: INSTANCE, actor: ACTOR });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.skipped.map((r) => r.source).sort()).toEqual(["completion", "template_item"]);
  });
});

describe("AM prep submit", () => {
  function amTables(): Record<string, Row[]> {
    return {
      checklist_instances: [instance("open")],
      checklist_template_items: items,
    };
  }
  const rpcOk = () => ({ instance: instance("confirmed"), completionIds: ["c-1"], autoCompleteId: null, submissionId: "s-1" });

  it("submits with one bad row it is not writing, and reports that row as skipped", async () => {
    const { service, rpcCalls } = fakeService(amTables(), rpcOk);
    const res = await submitAmPrep(service, {
      instanceId: INSTANCE,
      actor: ACTOR,
      entries: [{ templateItemId: GOOD, inputs: { total: 3 } }],
      closingReportRefItemId: null,
      activeAssignmentId: null,
    });
    expect(res.submittedCompletionIds).toEqual(["c-1"]);
    expect(res.skipped).toEqual([SKIPPED_BAD]);
    expect(rpcCalls.map((c) => c.name)).toEqual(["submit_am_prep_atomic"]);
    const entries = rpcCalls[0]!.params.p_entries as Array<{ templateItemId: string }>;
    expect(entries.map((e) => e.templateItemId)).toEqual([GOOD]);
  });

  it("refuses an entry that targets the bad row (PrepShapeError → 400 prep_shape), before any write", async () => {
    const { service, rpcCalls } = fakeService(amTables(), rpcOk);
    await expect(
      submitAmPrep(service, {
        instanceId: INSTANCE,
        actor: ACTOR,
        entries: [{ templateItemId: BAD, inputs: { total: 3 } }],
        closingReportRefItemId: null,
        activeAssignmentId: null,
      }),
    ).rejects.toBeInstanceOf(PrepShapeError);
    expect(rpcCalls).toEqual([]);
  });

  it("section drift (PrepInvariantError) on any row still stops the submit", async () => {
    const drift: Row[] = [items[0]!, { ...items[0]!, id: "item-drift", station: "veg" }];
    const { service, rpcCalls } = fakeService({ checklist_instances: [instance("open")], checklist_template_items: drift }, rpcOk);
    await expect(
      submitAmPrep(service, {
        instanceId: INSTANCE,
        actor: ACTOR,
        entries: [{ templateItemId: GOOD, inputs: { total: 3 } }],
        closingReportRefItemId: null,
        activeAssignmentId: null,
      }),
    ).rejects.toBeInstanceOf(PrepInvariantError);
    expect(rpcCalls).toEqual([]);
  });
});

// ── D-66 review (Astra P1): a VALID item whose live save is malformed ─────────
//
// Its completion is skipped, so it must leave the editable / completeness set too: otherwise
// finalize's blockers call it unsaved while every save to it is refused as bad_row.

const BATCH = "item-batch";
const batchRow: Row = { id: BATCH, template_id: TEMPLATE, station: "sauces", label: "Chipotle Mayo", display_order: 3, active: true, item_id: "reg-batch", translations: null, prep_meta: goodMeta };
const malformedSave: Row = { id: "c-mal", instance_id: INSTANCE, template_item_id: BATCH, completed_by: "u-1", completed_at: "2026-10-13T14:00:00Z", prep_data: { inputs: { total: "3" } }, edit_count: 0 };
const batchCtx: BatchItemContext = {
  itemId: "reg-batch", recipeId: "r-1", recipeName: "Chipotle Mayo", batchMode: true, shelfLifeDays: 5,
  outputCount: 1, yieldPerBatch: 4, isBatch: true, eligibility: "batched", blockedReason: null,
};
const SKIPPED_SAVE = { templateItemId: BATCH, label: "Chipotle Mayo", labelEs: null, source: "completion" };

describe("D-66 review — a skipped TARGET never blocks finishing", () => {
  beforeEach(() => {
    vi.mocked(loadBatchContextForItems).mockImplementation(async (ids: string[]) =>
      new Map(ids.includes("reg-batch") ? [["reg-batch", batchCtx]] : []),
    );
  });

  function tables(status: string, rows: Row[]): Record<string, Row[]> {
    return { ...midDayTables(status, [malformedSave]), checklist_template_items: rows, items: [], item_par_levels: [], productions: [], prep_batch_sessions: [] };
  }

  it("finalize succeeds when a batch item's live save is malformed, and reports it as skipped", async () => {
    const { service } = fakeService(tables("phase1_complete", [items[0]!, batchRow]), () => null);
    const res = await finalizeMidDayPhase2(service, { instanceId: INSTANCE, actor: ACTOR });
    expect(res).toMatchObject({ ok: true, skipped: [SKIPPED_SAVE] });
  });

  it("a save that targets that item is still refused", async () => {
    const { service, rpcCalls } = fakeService(tables("phase1_complete", [items[0]!, batchRow]), () => ({ completionId: "c", savedAt: "x" }));
    const res = await saveMidDayPhase2Item(service, { instanceId: INSTANCE, templateItemId: BATCH, prepped: 4, actor: ACTOR });
    expect(res).toEqual({ ok: false, reason: "bad_row", templateItemId: BATCH });
    expect(rpcCalls).toEqual([]);
  });

  it("the AM prep page read drops that item from the form (edit validation never requires it)", async () => {
    const { service } = fakeService(
      {
        checklist_templates: [{ id: TEMPLATE, name: "AM prep", type: "prep", prep_subtype: "am_prep", location_id: LOC, active: true }],
        checklist_instances: [instance("confirmed")],
        checklist_template_items: [items[0]!, batchRow],
        checklist_completions: [malformedSave],
        users: [],
        prep_sections: [],
        items: [],
        item_par_levels: [],
      },
      () => null,
    );
    const state = await loadAmPrepState(service, { locationId: LOC, date: DATE, actor: ACTOR, tolerateBadRows: true });
    expect(state?.templateItems.map((t) => t.id)).toEqual([GOOD]);
    expect(state?.skippedRows).toEqual([SKIPPED_SAVE]);
  });

  it("excludeSkippedTargets removes every skipped id and is a no-op with nothing skipped", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(excludeSkippedTargets(rows, [])).toBe(rows);
    expect(
      excludeSkippedTargets(rows, [
        { templateItemId: "b", label: "B", labelEs: null, source: "completion" },
        { templateItemId: "z", label: "Z", labelEs: null, source: "template_item" },
      ]).map((r) => r.id),
    ).toEqual(["a", "c"]);
  });
});
