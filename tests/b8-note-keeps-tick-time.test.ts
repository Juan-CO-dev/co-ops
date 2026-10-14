import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { carriedCompletedAt } from "@/lib/checklist-rows";

// B8 #13 (sim walk 2026-10-14): saving a note on a ticked closing line re-stamped its tick
// time (3:20 → 3:22). A note save is an append-only re-completion (supersede-then-insert under
// 0196's one-live-head law, unchanged); the new head now carries the prior head's completed_at
// when only the note changed and the same person saves it. No migration: completed_at already
// accepts an explicit value and no RLS qual or trigger reads it.

const mocks = vi.hoisted(() => ({ service: {} as unknown, insert: vi.fn(), prior: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => mocks.service }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => false), auditTaskOverride: vi.fn() }));
import { completeItem } from "@/lib/checklists";

const TICK = "2026-10-14T19:20:00.000Z";
const prior = (over: Record<string, unknown> = {}) => ({ id: "old", completed_by: "kh", completed_at: TICK, count_value: null, photo_id: null, ...over });

function client(service = false) {
  const item = { id: "item", template_id: "template", min_role_level: 2, active: true, report_reference_type: null,
    ref_track_item_completion: false, references_template_item_id: null, required: false, expects_count: false, expects_photo: false, input_type: null };
  const from = (table: string) => {
    let updating = false;
    const row = table === "checklist_instances" ? { id: "instance", template_id: "template", location_id: "shop", date: "2026-10-14", status: "open" }
      : table === "checklist_templates" ? { id: "template", type: "closing", single_submission_only: false }
      : table === "checklist_template_items" ? item : { id: "new", instance_id: "instance", template_item_id: "item", completed_by: "kh", completed_at: TICK };
    const query = {
      select: () => query, eq: () => query, is: () => query,
      update: () => { updating = true; return query; },
      insert: (payload: unknown) => { mocks.insert(payload); return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: service && updating && mocks.prior ? [mocks.prior] : [], error: null, count: 0 }).then(resolve),
    };
    return query;
  };
  return { from } as unknown as SupabaseClient;
}
const actor = { userId: "kh", role: "key_holder" as const, level: 4 };
beforeEach(() => { vi.clearAllMocks(); mocks.service = client(true); mocks.prior = null; });

describe("B8 #13 the carry rule", () => {
  const next = { actorId: "kh", countValue: null, photoId: null };
  it("a notes-only re-save by the same person keeps the tick time", () => {
    expect(carriedCompletedAt(prior(), next)).toBe(TICK);
    expect(carriedCompletedAt(prior({ count_value: "3" }), { ...next, countValue: 3 })).toBe(TICK);
  });
  it("another person, a new count/answer or a new photo is a real re-completion", () => {
    expect(carriedCompletedAt(prior({ completed_by: "gm" }), next)).toBeNull();
    expect(carriedCompletedAt(prior({ count_value: 1 }), { ...next, countValue: 0 })).toBeNull();
    expect(carriedCompletedAt(prior(), { ...next, photoId: "p" })).toBeNull();
    expect(carriedCompletedAt(null, next)).toBeNull();
  });
});

describe("B8 #13 completeItem", () => {
  it("inserts the new head with the prior head's completed_at on a note save", async () => {
    mocks.prior = prior();
    await completeItem(client(), { instanceId: "instance", templateItemId: "item", actor, notes: "wiped twice" });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ completed_at: TICK, notes: "wiped twice" }));
  });
  it("a first tick (no prior head) takes the database's now()", async () => {
    await completeItem(client(), { instanceId: "instance", templateItemId: "item", actor });
    expect(mocks.insert.mock.calls[0]![0]).not.toHaveProperty("completed_at");
  });
  it("another person's save keeps its own time", async () => {
    mocks.prior = prior({ completed_by: "someone-else" });
    await completeItem(client(), { instanceId: "instance", templateItemId: "item", actor, notes: "x" });
    expect(mocks.insert.mock.calls[0]![0]).not.toHaveProperty("completed_at");
  });
  it("the supersede claim reads what the rule needs, still guarded on the live head", () => {
    const src = readFileSync("lib/checklists.ts", "utf8");
    expect(src).toContain('.select("id, completed_by, completed_at, count_value, photo_id");');
    expect(src).toContain("...(carryAt ? { completed_at: carryAt } : {}),");
  });
});
