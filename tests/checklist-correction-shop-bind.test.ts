/**
 * Audit W05 / B150 + B151 — checklist corrections bind the actor to the instance's shop.
 *
 * resolveChecklistWriteActor already resolves ACTIVE memberships only, but the four correction writers
 * never compared them with the instance's shop:
 *   B150  revokeCompletion / revokeWithReason / markNotDoneByAuthority relied on the 0287 RPCs, which
 *         (before 0305) accepted an INACTIVE membership row. The lib now applies the RPC's own rule to the
 *         verified actor before the RPC: an active member of the instance's shop, or level 8+.
 *   B151  tagActualCompleter writes with the service client and never checked the shop at all. It now uses
 *         the completion writers' rule (completeItem / submitBatch / confirmInstance): an active member,
 *         with no level override.
 *
 * Behaviour tests over a small in-memory fake: a user-context READER (RLS already passed: the bug is that
 * the reader's scope was the only gate) and a service WRITER that records every RPC and UPDATE.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checklistActor } from "./helpers/checklist-actor";

type Row = Record<string, unknown>;
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn(), access: vi.fn(), db: {} as Record<string, Record<string, unknown>[]>,
  updates: [] as Array<{ table: string; patch: Record<string, unknown> }>, writer: {} as unknown }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => mocks.writer }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: mocks.access, auditTaskOverride: vi.fn() }));

import { markNotDoneByAuthority, revokeCompletion, revokeWithReason, tagActualCompleter } from "@/lib/checklists";

function client(service: boolean): SupabaseClient {
  return {
    rpc: service ? mocks.rpc : () => { throw new Error("user-context RPC"); },
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      const run = () => {
        const rows = (mocks.db[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (patch) { for (const r of rows) Object.assign(r, patch); mocks.updates.push({ table, patch }); }
        return rows.map((r) => ({ ...r }));
      };
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return q; },
        is: (c: string, v: unknown) => { preds.push((r) => (r[c] ?? null) === v); return q; },
        in: (c: string, vs: unknown[]) => { preds.push((r) => vs.includes(r[c])); return q; },
        gte: () => q,
        update: (p: Row) => { if (!service) throw new Error("user-context UPDATE"); patch = p; return q; },
        insert: () => { throw new Error("unexpected INSERT"); },
        delete: () => { throw new Error("unexpected DELETE"); },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const reader = client(false);
const ITEM = "00000000-0000-4000-8000-000000000001";
const longAgo = () => new Date(Date.now() - 90_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  mocks.writer = client(true);
  mocks.access.mockResolvedValue(true);
  mocks.db.checklist_instances = [{ id: "instance", template_id: "template", location_id: "shop-a", date: "2026-11-14", status: "open" }];
  mocks.db.checklist_templates = [{ id: "template", type: "closing", prep_subtype: null }];
  mocks.db.checklist_template_items = [{ id: ITEM, template_id: "template", min_role_level: 3, active: true, report_reference_type: null }];
  mocks.db.checklist_completions = [{ id: "completion", instance_id: "instance", template_item_id: ITEM, completed_by: "employee",
    completed_at: longAgo(), revoked_at: null, superseded_at: null, actual_completer_id: null, actual_completer_tagged_by: null, prep_data: null }];
  mocks.db.users = [{ id: "employee", name: "Employee", role: "employee", active: true }, { id: "other", name: "Other", role: "employee", active: true }];
  mocks.db.user_locations = [{ user_id: "other", location_id: "shop-a", active: true }];
  mocks.db.sessions = [{ user_id: "other", created_at: new Date().toISOString() }];
  mocks.rpc.mockImplementation(async () => ({ data: { completion: { ...mocks.db.checklist_completions![0], revoked_at: new Date().toISOString() },
    elapsed_ms: 90_000, actor_level: 4, completer_level: 3 }, error: null }));
});

/** What resolveChecklistWriteActor returns for each person: ACTIVE memberships only. */
const member = checklistActor({ userId: "kh", role: "key_holder", level: 4, locations: ["shop-a"] });
/** Removed from shop A (its user_locations row is active = false): shop B is all that is left. */
const removed = checklistActor({ userId: "kh", role: "key_holder", level: 4, locations: ["shop-b"] });
const gmElsewhere = checklistActor({ userId: "gm", role: "gm", level: 7, locations: ["shop-b"] });
const mooElsewhere = checklistActor({ userId: "moo", role: "moo", level: 8, locations: ["shop-b"] });
const ownerNoShops = checklistActor({ userId: "owner", role: "owner", level: 9, locations: [] });

const selfRow = (userId: string) => { mocks.db.checklist_completions![0]!.completed_by = userId; };

describe("B150 — the three correction writers bind the actor to the instance's shop before the RPC", () => {
  const authority = (actor: ReturnType<typeof checklistActor>) => markNotDoneByAuthority(reader, { completionId: "completion", actor, note: "Not done" });
  const selfQuick = (actor: ReturnType<typeof checklistActor>) => revokeCompletion(reader, { completionId: "completion", actor });
  const selfReason = (actor: ReturnType<typeof checklistActor>) => revokeWithReason(reader, { completionId: "completion", actor, reason: "not_actually_done" });

  it("mark-not-done: a key holder removed from the shop is refused 'You do not manage that location', no RPC, no audit", async () => {
    await expect(authority(removed)).rejects.toMatchObject({ code: "role_level_insufficient", message: "You do not manage that location" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("mark-not-done: a GM of another shop is refused too (below level 8 the shop is required)", async () => {
    await expect(authority(gmElsewhere)).rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([["quick revoke", selfQuick], ["revoke with reason", selfReason]] as const)(
    "%s: a removed member is told the completion is not found (the hidden-row answer), no RPC", async (_name, write) => {
      selfRow("kh");
      await expect(write(removed)).rejects.toMatchObject({ code: "completion_not_found" });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });

  it("an inactive actor is refused whatever their level", async () => {
    await expect(authority(checklistActor({ userId: "moo", role: "moo", level: 8, locations: ["shop-a"], active: false })))
      .rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("an active member still corrects: the RPC is called with the verified actor", async () => {
    await expect(authority(member)).resolves.toMatchObject({ completion: { id: "completion" } });
    expect(mocks.rpc).toHaveBeenCalledWith("checklist_mark_not_done", { p_completion: "completion", p_actor: "kh", p_note: "Not done" });
    selfRow("kh");
    await expect(selfQuick(member)).resolves.toMatchObject({ completion: { id: "completion" } });
    await expect(selfReason(member)).resolves.toMatchObject({ completion: { id: "completion" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });

  it("level 8+ keeps the RPC's own rule (0287: no membership needed at level 8 and up)", async () => {
    await expect(authority(mooElsewhere)).resolves.toMatchObject({ completion: { id: "completion" } });
    await expect(authority(ownerNoShops)).resolves.toMatchObject({ completion: { id: "completion" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("the shop check comes before the task-assignment read", async () => {
    await expect(authority(removed)).rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(mocks.access).not.toHaveBeenCalled();
  });
});

describe("B151 — tagActualCompleter requires an active membership at the instance's shop", () => {
  const tag = (actor: ReturnType<typeof checklistActor>) => tagActualCompleter(reader, { completionId: "completion", actor, actualCompleterId: "other" });

  it("a MoO who belongs only to another shop cannot re-credit a completion here: no UPDATE, no audit", async () => {
    await expect(tag(mooElsewhere)).rejects.toMatchObject({ code: "role_level_insufficient", required: 4, message: "You do not manage that location" });
    expect(mocks.updates).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([["an owner with no membership", ownerNoShops], ["a GM of another shop", gmElsewhere], ["a key holder removed from the shop", removed]] as const)(
    "%s is refused the same way", async (_name, actor) => {
      await expect(tag(actor)).rejects.toMatchObject({ code: "role_level_insufficient" });
      expect(mocks.updates).toEqual([]);
    });

  it("the completer themself, once removed from the shop, cannot re-credit their own row either", async () => {
    selfRow("kh");
    await expect(tag(removed)).rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(mocks.updates).toEqual([]);
  });

  it("an active member still tags (KH+), and a MoO who IS a member still tags", async () => {
    await expect(tag(member)).resolves.toMatchObject({ replacedPriorTag: false, completion: { actualCompleterId: "other" } });
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({ table: "checklist_completions", patch: { actual_completer_id: "other", actual_completer_tagged_by: "kh" } });
    mocks.db.checklist_completions![0]!.actual_completer_id = null;
    mocks.db.checklist_completions![0]!.actual_completer_tagged_by = null;
    const mooHere = checklistActor({ userId: "moo", role: "moo", level: 8, locations: ["shop-a", "shop-b"] });
    await expect(tag(mooHere)).resolves.toMatchObject({ completion: { actualCompleterId: "other" } });
  });
});
