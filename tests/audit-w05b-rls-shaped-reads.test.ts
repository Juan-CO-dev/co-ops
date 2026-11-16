/**
 * Audit W05B fix round 2 (review W05B-r2 P2): a level-8 non-member (MoO) runs the REAL checklist writer gates
 * against an RLS-SHAPED fake of the user-context client.
 *
 * The fake applies the live SELECT policies by table (0058 / 0217 / 0305):
 *   checklist_instances, _completions, _submissions, _incomplete_reasons   member OR level >= 8   (0217)
 *   checklist_templates, checklist_template_items                          member OR level >= 9   (0058, kept by 0217)
 *   photos                                                                 nothing                (0164)
 *   users                                                                  self only
 *   sessions, user_locations, report_assignments                           nothing (service-role reads only)
 * "member" = an ACTIVE user_locations row (0305). A row the policy hides is simply absent, as PostgREST returns it.
 * The service-role client sees every row. Nothing about the gates is mocked: resolveChecklistWriteActor,
 * worksShopTasks, requireChecklistTaskAccess, rejectIfPrepLocked, the item checks, the lock-up / cash / hard gates and
 * hasTaskAccess all run for real; only the RPCs, the PIN hash check, audit and the per-session PIN counter are doubles.
 *
 * Before the fix, the template and template-item reads went through the user-context client, so a MoO with no
 * membership at the shop got 403 on complete / submit / confirm (and, on confirm, an EMPTY item list would have
 * waved the cash, hard-gate and required-item checks through had the template read not failed first).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  rpc: vi.fn(),
  pin: vi.fn(),
  audit: vi.fn(),
  who: { userId: "actor", sessionId: "session" },
  serviceReads: [] as string[],
}));

// ── The RLS-shaped fake ────────────────────────────────────────────────────────────────────────────────────
function jwtLevel(): number {
  const role = h.db.users!.find(u => u.id === h.who.userId)?.role as string;
  return ({ cgs: 10, owner: 9, moo: 8, gm: 7, agm: 6, shift_lead: 5, key_holder: 4, employee: 3 } as Record<string, number>)[role] ?? 0;
}
function jwtLocations(): string[] {
  return h.db.user_locations!.filter(m => m.user_id === h.who.userId && m.active === true).map(m => m.location_id as string);
}
function rlsVisible(table: string, row: Row): boolean {
  const level = jwtLevel();
  const member = (loc: unknown) => jwtLocations().includes(loc as string);
  const viaInstance = () => {
    const i = h.db.checklist_instances!.find(r => r.id === row.instance_id);
    return !!i && (member(i.location_id) || level >= 8);
  };
  switch (table) {
    case "checklist_instances": return member(row.location_id) || level >= 8;
    case "checklist_completions": case "checklist_submissions": case "checklist_incomplete_reasons": return viaInstance();
    case "checklist_templates": return member(row.location_id) || level >= 9;
    case "checklist_template_items": {
      const t = h.db.checklist_templates!.find(r => r.id === row.template_id);
      return !!t && (member(t.location_id) || level >= 9);
    }
    case "users": return row.id === h.who.userId;
    default: return false;
  }
}

function client(service: boolean): SupabaseClient {
  return {
    rpc: (name: string, args: unknown) => {
      if (!service) throw new Error("user-context RPC");
      return h.rpc(name, args);
    },
    from(table: string) {
      const preds: Array<(r: Row) => boolean> = [];
      let head = false;
      let limit: number | null = null;
      let updating: Row | null = null;
      const rows = () => {
        if (service) h.serviceReads.push(table);
        let out = (h.db[table] ?? []).filter(r => service || rlsVisible(table, r)).filter(r => preds.every(p => p(r)));
        if (limit !== null) out = out.slice(0, limit);
        if (updating) out = out.map(r => Object.assign(r, updating));
        return out;
      };
      const q = {
        select: (_cols?: string, opts?: { head?: boolean }) => { head = !!opts?.head; return q; },
        eq: (k: string, v: unknown) => { preds.push(r => (r[k] ?? null) === v); return q; },
        neq: (k: string, v: unknown) => { preds.push(r => (r[k] ?? null) !== v); return q; },
        is: (k: string, v: unknown) => { preds.push(r => (r[k] ?? null) === v); return q; },
        in: (k: string, vs: unknown[]) => { preds.push(r => vs.includes(r[k])); return q; },
        gte: (k: string, v: unknown) => { preds.push(r => String(r[k]) >= String(v)); return q; },
        order: () => q,
        limit: (n: number) => { limit = n; return q; },
        insert: () => { throw new Error(`unexpected INSERT ${table}`); },
        // Only tagActualCompleter's service-role compare-and-set UPDATE is expected.
        update: (p: Row) => {
          if (!service || table !== "checklist_completions" || !("actual_completer_id" in p)) throw new Error(`unexpected UPDATE ${table}`);
          updating = p; return q;
        },
        delete: () => { throw new Error(`unexpected DELETE ${table}`); },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          const r = rows();
          return Promise.resolve(head ? { data: null, count: r.length, error: null } : { data: r, count: r.length, error: null }).then(resolve);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

vi.mock("@/lib/supabase-server", () => ({ createAuthedClient: () => client(false), getServiceRoleClient: () => client(true) }));
vi.mock("@/lib/auth", () => ({ verifyPin: h.pin }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/auth-reauth", async () => (await import("./helpers/reauth-mock")).reauthAllowAll());
vi.mock("@/lib/session", () => ({
  SESSION_COOKIE_NAME: "co_session",
  // The JWT's own claims are NOT what the writers trust; resolveChecklistWriteActor re-reads fresh rows.
  requireSession: async () => {
    const u = h.db.users!.find(r => r.id === h.who.userId)!;
    return { user: { id: h.who.userId }, session: { id: h.who.sessionId, userId: h.who.userId }, role: u.role, level: jwtLevel(), locations: jwtLocations() };
  },
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: vi.fn() }));
vi.mock("@/lib/catering/toast-sales", () => ({ pullSalesSystemTrigger: vi.fn() }));
vi.mock("@/lib/report-digests", () => ({ runClosingDigests: vi.fn() }));
vi.mock("@/lib/whos-here-tick", () => ({ releaseAfterSettledClose: vi.fn() }));

import { POST as complete } from "@/app/api/checklist/completions/route";
import { POST as submit } from "@/app/api/checklist/submissions/route";
import { POST as confirm } from "@/app/api/checklist/confirm/route";
import { POST as revoke } from "@/app/api/checklist/completions/[id]/revoke/route";
import { POST as markNotDone } from "@/app/api/checklist/completions/[id]/mark-not-done/route";
import { GET as pickerCandidates } from "@/app/api/checklist/completions/[id]/picker-candidates/route";
import { POST as tagRoute } from "@/app/api/checklist/completions/[id]/tag-actual-completer/route";
import { completeItem, confirmInstance, loadPickerCandidatesForCompletion, tagActualCompleter } from "@/lib/checklists";
import type { ChecklistWriteActor } from "@/lib/checklist-write-actor";

const ITEM = "00000000-0000-4000-8000-000000000001";
const ITEM2 = "00000000-0000-4000-8000-000000000002";
const FOREIGN_ITEM = "00000000-0000-4000-8000-0000000000f1";

function seed(role: string, memberships: Array<{ location_id: string; active: boolean }>) {
  h.db = {
    users: [
      { id: "actor", name: "Actor", role, active: true, pin_hash: "hash" },
      { id: "closer", name: "Closer", role: "employee", active: true, pin_hash: "hash" },
    ],
    sessions: [{ id: "session", user_id: "actor", revoked_at: null, expires_at: new Date(Date.now() + 3_600_000).toISOString() }],
    user_locations: memberships.map(m => ({ user_id: "actor", ...m })),
    checklist_instances: [{ id: "instance", template_id: "template", location_id: "shop-b", date: "2026-11-15", status: "open" }],
    checklist_templates: [
      { id: "template", location_id: "shop-b", type: "closing", prep_subtype: null, active: true, single_submission_only: false },
      { id: "foreign-template", location_id: "shop-c", type: "closing", prep_subtype: null, active: true, single_submission_only: false },
    ],
    checklist_template_items: [
      { id: ITEM, template_id: "template", label: "Wipe the line", station: null, min_role_level: 3, required: true, active: true,
        expects_count: false, expects_photo: false, input_type: null, report_reference_type: null, hard_gate: false,
        ref_track_item_completion: false, references_template_item_id: null },
      { id: FOREIGN_ITEM, template_id: "foreign-template", label: "Other shop", station: null, min_role_level: 3, required: true,
        active: true, expects_count: false, expects_photo: false, input_type: null, report_reference_type: null, hard_gate: false,
        ref_track_item_completion: false, references_template_item_id: null },
    ],
    checklist_completions: [{ id: "completion", instance_id: "instance", template_item_id: ITEM, completed_by: "actor",
      completed_at: new Date(Date.now() - 120_000).toISOString(), superseded_at: null, revoked_at: null, prep_data: null,
      actual_completer_id: null, actual_completer_tagged_by: null }],
    checklist_submissions: [],
    checklist_incomplete_reasons: [],
    photos: [],
    report_assignments: [],
  };
}

function request(path: string, body: unknown) {
  return new NextRequest(`https://example.test/api/checklist/${path}`, { method: "POST",
    headers: { origin: "https://example.test", "content-type": "application/json", cookie: "co_session=jwt" }, body: JSON.stringify(body) });
}
function getRequest(path: string) {
  return new NextRequest(`https://example.test/api/checklist/${path}`, { method: "GET", headers: { cookie: "co_session=jwt" } });
}
const completionParams = { params: Promise.resolve({ id: "completion" }) };
const writeActor = (role: string, level: number, locations: string[]) =>
  Object.freeze({ userId: "actor", sessionId: "session", role, level, active: true, locations: Object.freeze(locations) }) as unknown as ChecklistWriteActor;

beforeEach(() => {
  vi.clearAllMocks();
  h.serviceReads = [];
  h.pin.mockResolvedValue(true);
  h.rpc.mockImplementation(async (name: string, args: Row) => {
    const completion = h.db.checklist_completions![0]!;
    if (name === "checklist_write_completion") {
      return { data: { completion: { ...completion, id: "new" }, superseded_ids: [], kept_completed_at: false }, error: null };
    }
    const submission = { id: "submission", instance_id: "instance", submitted_by: args.p_actor, submitted_at: "2026-11-15T23:00:00Z",
      completion_ids: args.p_completion_ids ?? [], is_final_confirmation: name === "checklist_confirm_instance" };
    if (name === "checklist_submit_batch") return { data: submission, error: null };
    if (name === "checklist_confirm_instance") {
      const reasons = (args.p_reasons as Array<{ templateItemId: string; reason: string }>).map(r => ({ id: "reason",
        instance_id: "instance", template_item_id: r.templateItemId, reason: r.reason, reported_by: args.p_actor }));
      return { data: { instance: { ...h.db.checklist_instances![0], status: reasons.length ? "incomplete_confirmed" : "confirmed" },
        submission, reasons }, error: null };
    }
    if (["checklist_revoke_completion", "checklist_mark_not_done"].includes(name)) {
      return { data: { completion: { ...completion, revoked_at: "2026-11-15T23:00:00Z" }, elapsed_ms: 120_000, actor_level: 8, completer_level: 8 }, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  });
});

describe("the RLS-shaped fake itself (so a pass below means something)", () => {
  it("a level-8 non-member sees the instance (0217: 8+) but NOT its template or items (0058: 9+)", async () => {
    seed("moo", [{ location_id: "shop-a", active: true }]);
    const authed = client(false);
    expect((await authed.from("checklist_instances").select("*").eq("id", "instance").maybeSingle()).data).not.toBeNull();
    expect((await authed.from("checklist_templates").select("*").eq("id", "template").maybeSingle()).data).toBeNull();
    expect((await authed.from("checklist_template_items").select("*").eq("template_id", "template")).data).toEqual([]);
  });
  it("a member sees all three; an owner (9) sees all three without a membership", async () => {
    seed("employee", [{ location_id: "shop-b", active: true }]);
    expect((await client(false).from("checklist_templates").select("*").eq("id", "template").maybeSingle()).data).not.toBeNull();
    seed("owner", []);
    expect((await client(false).from("checklist_template_items").select("*").eq("template_id", "template")).data).toHaveLength(1);
  });
});

describe("W05B r2: a MoO (level 8) with no membership at shop B works shop B's closing through the real routes", () => {
  beforeEach(() => seed("moo", [{ location_id: "shop-a", active: true }]));

  it("completes an item", async () => {
    const res = await complete(request("completions", { instanceId: "instance", templateItemId: ITEM }));
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("checklist_write_completion", expect.objectContaining({ p_actor: "actor", p_instance: "instance", p_template_item: ITEM }));
  });

  it("submits a batch", async () => {
    const res = await submit(request("submissions", { instanceId: "instance", completionIds: ["completion"] }));
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("checklist_submit_batch", expect.objectContaining({ p_actor: "actor" }));
  });

  it("confirms (lock-up) with the PIN", async () => {
    const res = await confirm(request("confirm", { instanceId: "instance", pin: "1234", incompleteReasons: [] }));
    expect(res.status).toBe(200);
    expect(h.rpc).toHaveBeenCalledWith("checklist_confirm_instance", expect.objectContaining({ p_actor: "actor" }));
  });

  it("undoes their own tap and marks a line not done (the closing page's correction buttons)", async () => {
    h.db.checklist_completions![0]!.completed_at = new Date(Date.now() - 10_000).toISOString();
    expect((await revoke(request("completions/completion/revoke", {}), { params: Promise.resolve({ id: "completion" }) })).status).toBe(200);
    expect((await markNotDone(request("completions/completion/mark-not-done", { note: "not wiped" }),
      { params: Promise.resolve({ id: "completion" }) })).status).toBe(200);
  });

  it("tags the actual completer (picker scope is a service-role read; the item read is now bound too)", async () => {
    h.db.user_locations!.push({ user_id: "closer", location_id: "shop-b", active: true });
    h.db.sessions!.push({ id: "closer-session", user_id: "closer", created_at: new Date().toISOString() });
    await expect(tagActualCompleter(client(false), { completionId: "completion", actor: writeActor("moo", 8, ["shop-a"]),
      actualCompleterId: "closer" })).resolves.toMatchObject({ completion: { actualCompleterId: "closer" } });
  });
});

describe("W05B r2: every gate still runs on the service-role template/items read", () => {
  beforeEach(() => seed("moo", [{ location_id: "shop-a", active: true }]));

  it("confirm still sees the REQUIRED items: an incomplete required line needs a reason (not a silent empty list)", async () => {
    h.db.checklist_template_items!.push({ ...h.db.checklist_template_items![0]!, id: ITEM2, label: "Mop" });
    await expect(confirmInstance(client(false), { instanceId: "instance", actor: writeActor("moo", 8, ["shop-a"]), pin: "1234",
      incompleteReasons: [] })).rejects.toMatchObject({ code: "missing_reasons" });
  });

  it("confirm still enforces a hard-gated line", async () => {
    h.db.checklist_template_items!.push({ ...h.db.checklist_template_items![0]!, id: ITEM2, label: "Safe locked", hard_gate: true, required: false });
    await expect(confirmInstance(client(false), { instanceId: "instance", actor: writeActor("moo", 8, ["shop-a"]), pin: "1234",
      incompleteReasons: [] })).rejects.toMatchObject({ code: "hard_gate_incomplete" });
  });

  it("confirm still enforces the cash-deposit line", async () => {
    h.db.checklist_template_items!.push({ ...h.db.checklist_template_items![0]!, id: ITEM2, label: "Cash", report_reference_type: "cash_report", required: false });
    await expect(confirmInstance(client(false), { instanceId: "instance", actor: writeActor("moo", 8, ["shop-a"]), pin: "1234",
      incompleteReasons: [] })).rejects.toMatchObject({ code: "cash_deposit_required" });
  });

  it("an item above the actor's level is still refused (item min level unchanged)", async () => {
    h.db.checklist_template_items![0]!.min_role_level = 9;
    await expect(completeItem(client(false), { instanceId: "instance", templateItemId: ITEM, actor: writeActor("moo", 8, ["shop-a"]) }))
      .rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("an item from ANOTHER template is refused and never read from the service role (only the instance's template)", async () => {
    await expect(completeItem(client(false), { instanceId: "instance", templateItemId: FOREIGN_ITEM, actor: writeActor("moo", 8, ["shop-a"]) }))
      .rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a single-submission template that already has a submission is still locked", async () => {
    h.db.checklist_templates![0]!.single_submission_only = true;
    h.db.checklist_submissions!.push({ id: "s0", instance_id: "instance" });
    await expect(completeItem(client(false), { instanceId: "instance", templateItemId: ITEM, actor: writeActor("moo", 8, ["shop-a"]) }))
      .rejects.toMatchObject({ code: "single_submission_locked" });
  });

  it("an opening instance still runs the assignment gate (hasTaskAccess, real) — a level-8 passes it, then W13/B072 refuses the generic route (409)", async () => {
    h.db.checklist_templates![0]!.type = "opening";
    const res = await complete(request("completions", { instanceId: "instance", templateItemId: ITEM }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "wrong_checklist_type" });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("the assignment gate runs BEFORE the closing-only guard: an unassigned member below KH on an opening gets 403, not 409", async () => {
    seed("employee", [{ location_id: "shop-b", active: true }]);
    h.db.checklist_templates![0]!.type = "opening";
    const res = await complete(request("completions", { instanceId: "instance", templateItemId: ITEM }));
    expect(res.status).toBe(403);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("W05B merge with W13/B072: the closing-only guard reads the BOUND instance's template (service role)", () => {
  beforeEach(() => seed("moo", [{ location_id: "shop-a", active: true }]));

  for (const [type, prepSubtype] of [["prep", "am_prep"], ["prep", "mid_day_prep"], ["opening", null]] as const) {
    it(`a level-8 non-member's generic complete on a ${prepSubtype ?? type} instance is 409 wrong_checklist_type (not 403)`, async () => {
      Object.assign(h.db.checklist_templates![0]!, { type, prep_subtype: prepSubtype });
      for (const [post, path, body] of [
        [complete, "completions", { instanceId: "instance", templateItemId: ITEM }],
        [submit, "submissions", { instanceId: "instance", completionIds: ["completion"] }],
        [confirm, "confirm", { instanceId: "instance", pin: "1234", incompleteReasons: [] }],
      ] as const) {
        const res = await post(request(path, body));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: "wrong_checklist_type" });
      }
      expect(h.rpc).not.toHaveBeenCalled();
    });
  }

  it("a level-8 non-member's generic complete on a CLOSING instance at a non-member shop is allowed (the guard's template read is service-role)", async () => {
    // The caller's own RLS hides shop B's template from a level-8 non-member (the fake's first test),
    // so a guard reading through the user client would see no row and refuse 409. It must not.
    expect((await client(false).from("checklist_templates").select("type").eq("id", "template").maybeSingle()).data).toBeNull();
    const res = await complete(request("completions", { instanceId: "instance", templateItemId: ITEM }));
    expect(res.status).toBe(200);
    expect(h.serviceReads).toContain("checklist_templates");
    expect(h.rpc).toHaveBeenCalledWith("checklist_write_completion", expect.objectContaining({ p_instance: "instance", p_template_item: ITEM }));
  });
});

describe("W05B r2: the service-role read is reached only AFTER the shop bind", () => {
  it("a GM (7) with no membership at shop B is refused before any template/items read", async () => {
    seed("gm", [{ location_id: "shop-a", active: true }]);
    for (const [post, path, body] of [
      [complete, "completions", { instanceId: "instance", templateItemId: ITEM }],
      [submit, "submissions", { instanceId: "instance", completionIds: ["completion"] }],
      [confirm, "confirm", { instanceId: "instance", pin: "1234", incompleteReasons: [] }],
    ] as const) {
      h.serviceReads = [];
      const res = await post(request(path, body));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(h.serviceReads).not.toContain("checklist_templates");
      expect(h.serviceReads).not.toContain("checklist_template_items");
    }
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("an instance the caller's RLS cannot see is never bound (no service-role template read)", async () => {
    seed("employee", [{ location_id: "shop-a", active: true }]);
    await expect(completeItem(client(false), { instanceId: "instance", templateItemId: ITEM, actor: writeActor("moo", 8, ["shop-a"]) }))
      .rejects.toThrow(/not visible/);
    expect(h.serviceReads).not.toContain("checklist_templates");
  });

  it("a member (level 3) is unchanged: completes through the same path", async () => {
    seed("employee", [{ location_id: "shop-b", active: true }]);
    expect((await complete(request("completions", { instanceId: "instance", templateItemId: ITEM }))).status).toBe(200);
  });
});

describe("W05B r3: the tagging picker follows the same shop rule as tagging (review W05B-r3 P2)", () => {
  function rosterCloser() {
    h.db.user_locations!.push({ user_id: "closer", location_id: "shop-b", active: true });
    h.db.sessions!.push({ id: "closer-session", user_id: "closer", created_at: new Date().toISOString() });
  }

  it("a MoO (8) with no membership at shop B loads the picker, then tags through the real routes", async () => {
    seed("moo", [{ location_id: "shop-a", active: true }]);
    rosterCloser();
    const res = await pickerCandidates(getRequest("completions/completion/picker-candidates"), completionParams);
    expect(res.status).toBe(200);
    const body = await res.json() as { candidates: Array<{ id: string }> };
    expect(body.candidates.map(c => c.id).sort()).toEqual(["actor", "closer"]);
    const tag = await tagRoute(request("completions/completion/tag-actual-completer", { actualCompleterId: "closer" }), completionParams);
    expect(tag.status).toBe(200);
  });

  it("candidate rules are unchanged: an off-roster shop-B member and a person below the item's floor are not offered", async () => {
    seed("moo", [{ location_id: "shop-a", active: true }]);
    rosterCloser();
    h.db.users!.push({ id: "absent", name: "Absent", role: "employee", active: true }, { id: "low", name: "Low", role: "employee", active: true });
    h.db.user_locations!.push({ user_id: "absent", location_id: "shop-b", active: true }, { user_id: "low", location_id: "shop-b", active: true });
    h.db.sessions!.push({ id: "low-session", user_id: "low", created_at: new Date().toISOString() });
    h.db.checklist_template_items![0]!.min_role_level = 3;
    h.db.users!.find(u => u.id === "low")!.role = "trainee";
    const ids = (await loadPickerCandidatesForCompletion(client(false), { completionId: "completion",
      actor: writeActor("moo", 8, ["shop-a"]) })).map(c => c.id).sort();
    expect(ids).toEqual(["actor", "closer"]);
  });

  it("a GM (7) with no membership at shop B is refused, before any template/items/candidate read", async () => {
    seed("gm", [{ location_id: "shop-a", active: true }]);
    rosterCloser();
    h.serviceReads = [];
    const res = await pickerCandidates(getRequest("completions/completion/picker-candidates"), completionParams);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(h.serviceReads).not.toContain("checklist_templates");
    expect(h.serviceReads).not.toContain("checklist_template_items");
    expect(h.serviceReads).not.toContain("checklist_completions");
  });

  it("a GM the RLS still shows the row to, but who is NOT an active member of shop B, is refused by the shop rule", async () => {
    seed("gm", [{ location_id: "shop-b", active: true }]); // RLS sees it (stale membership in the JWT's view)
    rosterCloser();
    h.serviceReads = [];
    await expect(loadPickerCandidatesForCompletion(client(false), { completionId: "completion",
      actor: writeActor("gm", 7, ["shop-a"]) })).rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(h.serviceReads).not.toContain("checklist_templates");
    expect(h.serviceReads).not.toContain("checklist_template_items");
    expect(h.serviceReads).not.toContain("checklist_completions");
  });

  it("a member below KH who is not the completer is still refused (KH+ or self unchanged)", async () => {
    seed("employee", [{ location_id: "shop-b", active: true }]);
    h.db.checklist_completions![0]!.completed_by = "closer";
    const res = await pickerCandidates(getRequest("completions/completion/picker-candidates"), completionParams);
    expect(res.status).toBe(403);
  });

  it("a member below KH who IS the completer still loads the picker (self wrong_user_credited)", async () => {
    seed("employee", [{ location_id: "shop-b", active: true }]);
    rosterCloser();
    const res = await pickerCandidates(getRequest("completions/completion/picker-candidates"), completionParams);
    expect(res.status).toBe(200);
  });
});

describe("W05B r2 sweep: the other paths W05B opened to level 8+ read through the service role only", () => {
  // Every one of these binds the shop with canWorkShopTasks / hasTaskAccess / canAccessOpeningInstance on
  // a service-role instance read and then reads templates, items and prep rows service-role. A
  // user-context client here would come back empty for a level-8 non-member (templates / items /
  // prep_list_resolutions stay member-or-9+), so none may be created.
  const files = [
    "app/(authed)/operations/closing/page.tsx", "app/(authed)/operations/opening/page.tsx",
    "app/(authed)/operations/am-prep/page.tsx", "app/(authed)/operations/mid-day/page.tsx",
    "app/api/opening/phase1/draft/route.ts", "app/api/opening/prep/item/route.ts", "app/api/opening/prep/item/revoke/route.ts",
    "app/api/opening/submit/phase1/route.ts", "app/api/opening/submit/phase2/route.ts",
    "app/api/prep/mid-day/route.ts", "app/api/prep/mid-day/phase1/route.ts", "app/api/prep/mid-day/phase2/item/route.ts",
    "app/api/prep/mid-day/phase2/finalize/route.ts", "app/api/prep/submit/route.ts",
    "app/api/photos/route.ts", "lib/photos.ts", "lib/am-prep-draft.ts",
  ];
  it.each(files)("%s creates no user-context (JWT) client", async (file) => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(file, "utf8")).not.toMatch(/createAuthedClient/);
  });
});
