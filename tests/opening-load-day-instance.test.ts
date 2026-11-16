/**
 * W15 fix round 1 (review r1 P2 1, B084) — loadOpeningState never asks to CREATE an opening the day
 * already has, and a create that loses to another version serves the winner.
 *   · a reload of a day that already has its opening — even a legacy pair (two versions both hold the
 *     day, a B084 strand made before 0320) — must not call create_opening_instance_atomic: under 0320
 *     the lineage guard can refuse that insert, and the reload failed;
 *   · a concurrent first open on ANOTHER version (checklist_instance_lineage_taken from the RPC) re-reads
 *     the day's instance and serves it with its own template, instead of an unhandled error.
 * The loader runs for real over the in-memory fake DB; only the heavy derived-SKU readers are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/prep-consumption", async (original) => ({
  ...await original<typeof import("@/lib/prep-consumption")>(),
  loadDerivedForItems: vi.fn(async () => new Map()),
  loadBatchDerivedForItems: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/batch-prep", () => ({ loadBatchContextForItems: vi.fn(async () => new Map()) }));

import { loadOpeningState } from "@/lib/opening";

const shop = "10000000-0000-4000-8000-000000000001";
const V1 = "20000000-0000-4000-8000-000000000001";
const V2 = "20000000-0000-4000-8000-000000000002";
const DAY = "2026-11-15";
const actor = { userId: "u-opener", role: "key_holder" as const, level: 4 };

const tpl = (id: string, active: boolean, effectiveFrom: string) =>
  ({ id, location_id: shop, type: "opening", name: "Opening", active, effective_from: effectiveFrom, created_at: `${effectiveFrom}T00:00:00Z` });
const inst = (id: string, template: string, createdAt: string) => ({
  id, template_id: template, location_id: shop, date: DAY, shift_start_at: null, status: "open", confirmed_at: null,
  confirmed_by: null, created_at: createdAt, triggered_by_user_id: null, triggered_at: null, finalized_at_actor_type: null,
  assigned_to: null, assignment_locked: false, dropped_at: null, dropped_by: null, dropped_reason: null, allows_multiple_per_day: false,
});
const item = (id: string, template: string, label: string) =>
  ({ id, template_id: template, label, active: true, display_order: 1, prep_meta: null, station: null, min_role_level: 3, required: true });

let tables: Tables;
let rpc: ReturnType<typeof vi.fn>;
function client() {
  const db = createFakeDb(tables);
  return { ...(db.client as unknown as Record<string, unknown>), from: (db.client as unknown as { from: unknown }).from, rpc } as never;
}

beforeEach(() => {
  tables = {
    checklist_templates: [tpl(V1, false, "2026-01-01"), tpl(V2, true, DAY)],
    checklist_template_items: [item("i-v1", V1, "V1 line"), item("i-v2", V2, "V2 line")],
    checklist_instances: [],
    checklist_completions: [],
    users: [],
  };
  rpc = vi.fn();
});

describe("loadOpeningState — the day's opening is reused, never re-created", () => {
  it("a legacy pair (two versions hold the day): the reload calls no create RPC and serves the picked instance", async () => {
    tables.checklist_instances!.push(inst("op-old", V1, `${DAY}T10:00:00Z`), inst("op-new", V2, `${DAY}T10:05:00Z`));
    // What 0320's guard did to this reload before round 1: the RPC's INSERT is refused.
    rpc.mockResolvedValue({ data: null, error: { message: "checklist_instance_lineage_taken" } });
    const state = await loadOpeningState(client(), { locationId: shop, date: DAY, actor });
    expect(rpc).not.toHaveBeenCalled();
    expect(state?.instance.id).toBe("op-old");
    expect(state?.template.id).toBe(V1);
    expect(state?.templateItems.map((t) => t.id)).toEqual(["i-v1"]);
  });

  it("a single existing opening: no create RPC, same instance", async () => {
    tables.checklist_instances!.push(inst("op-1", V2, `${DAY}T10:00:00Z`));
    const state = await loadOpeningState(client(), { locationId: shop, date: DAY, actor });
    expect(rpc).not.toHaveBeenCalled();
    expect(state?.instance.id).toBe("op-1");
  });

  it("a first open that loses to another version (lineage_taken) re-reads and serves the winner with its own template", async () => {
    rpc.mockImplementation(async () => {
      // Another opener committed today's opening on V1 between our look and our insert.
      tables.checklist_instances!.push(inst("op-winner", V1, `${DAY}T10:00:00Z`));
      return { data: null, error: { message: "checklist_instance_lineage_taken" } };
    });
    const state = await loadOpeningState(client(), { locationId: shop, date: DAY, actor });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_template_id: V2 });
    expect(state?.instance.id).toBe("op-winner");
    expect(state?.template.id).toBe(V1);
    expect(state?.templateItems.map((t) => t.id)).toEqual(["i-v1"]);
  });

  it("a lineage refusal with no winner visible is still an error (never a loop)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "checklist_instance_lineage_taken" } });
    await expect(loadOpeningState(client(), { locationId: shop, date: DAY, actor })).rejects.toThrow(/lineage_taken|atomic instance create failed/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a day with no opening still creates one through the RPC", async () => {
    rpc.mockImplementation(async () => {
      tables.checklist_instances!.push(inst("op-created", V2, `${DAY}T10:00:00Z`));
      return { data: { instance_id: "op-created", was_created: true, snapshot_count: 0 }, error: null };
    });
    const state = await loadOpeningState(client(), { locationId: shop, date: DAY, actor });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(state?.instance.id).toBe("op-created");
    expect(state?.template.id).toBe(V2);
  });
});
