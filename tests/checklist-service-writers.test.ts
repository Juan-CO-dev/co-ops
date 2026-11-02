import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checklistActor } from "./helpers/checklist-actor";

const mocks = vi.hoisted(() => ({ reader: {} as SupabaseClient, writer: {} as SupabaseClient,
  rpc: vi.fn(), insert: vi.fn(), pin: vi.fn(), after: vi.fn(), access: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createAuthedClient: () => mocks.reader, getServiceRoleClient: () => mocks.writer }));
vi.mock("@/lib/auth", () => ({ verifyPin: mocks.pin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: mocks.access, auditTaskOverride: vi.fn() }));
vi.mock("@/lib/session", () => ({ SESSION_COOKIE_NAME: "co_session", requireSession: async () => ({
  user: { id: "actor" }, session: { id: "session", userId: "actor" }, role: "owner", level: 9, locations: ["spoof-shop"],
}) }));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/catering/toast-sales", () => ({ pullSalesSystemTrigger: vi.fn() }));
vi.mock("@/lib/report-digests", () => ({ runClosingDigests: vi.fn() }));
vi.mock("@/lib/whos-here-tick", () => ({ releaseAfterSettledClose: vi.fn() }));
import { revokeCompletion, revokeWithReason, markNotDoneByAuthority, tagActualCompleter, completeItem, submitBatch, confirmInstance, getOrCreateInstance } from "@/lib/checklists";
import { POST as complete } from "@/app/api/checklist/completions/route";
import { POST as submit } from "@/app/api/checklist/submissions/route";
import { POST as confirm } from "@/app/api/checklist/confirm/route";
import { POST as revoke } from "@/app/api/checklist/completions/[id]/revoke/route";
import { POST as reasonRevoke } from "@/app/api/checklist/completions/[id]/revoke-with-reason/route";
import { POST as markNotDone } from "@/app/api/checklist/completions/[id]/mark-not-done/route";
import { POST as tag } from "@/app/api/checklist/completions/[id]/tag-actual-completer/route";
import { POST as create } from "@/app/api/checklist/instances/route";

let instance: Record<string, unknown>;
let template: Record<string, unknown>;
let items: Record<string, unknown>[];
let completions: Record<string, unknown>[];
let user: Record<string, unknown>;
let session: Record<string, unknown>;
let memberships: { location_id: string; active: boolean }[];
let exists: boolean;
let insertResult: unknown;
let rpcError: string | null;
let tagRace: boolean;
let tagGone: "revoked_at" | "superseded_at" | null;
let tagFilters: Record<string, unknown>;
const actor = checklistActor();
const completionArgs = { instanceId: "instance", templateItemId: "00000000-0000-4000-8000-000000000001", actor };
const confirmArgs = { instanceId: "instance", actor, pin: "1234", incompleteReasons: [] };

// Distinct clients: any authenticated mutation throws immediately. The service
// double only permits instance INSERT and the three named RPCs, never compensation.
function client(service: boolean): SupabaseClient {
  return {
    rpc: service ? mocks.rpc : () => { throw new Error("authenticated RPC mutation"); },
    from(table: string) {
      let inserting = false;
      let updating: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      const result = (single: boolean) => {
        let data: unknown = table === "sessions" ? single ? session : [session] : table === "users" ? single ? user : [user]
          : table === "user_locations" ? memberships.filter(row => filters.active === undefined || row.active === filters.active)
          : table === "checklist_instances" ? exists || inserting ? instance : null
          : table === "checklist_templates" ? template
          : table === "checklist_template_items" ? single ? items.find(row => row.id === (filters.id ?? "00000000-0000-4000-8000-000000000001")) : items
          : table === "checklist_completions" ? filters.superseded_by ? [] : completions : [];
        if (table === "checklist_completions") {
          if (updating && tagGone) completions[0]![tagGone] = new Date().toISOString();
          if (updating && tagRace) {
            // A GM won after this KH read the old tag. Matching the prior pair
            // must exclude the now-updated row, even though it remains live.
            completions[0]!.actual_completer_id = "gm-completer";
            completions[0]!.actual_completer_tagged_by = "gm-tagger";
          }
          const rows = completions.filter(row => Object.entries(filters).every(([key, value]) => (row[key] ?? null) === value));
          data = single ? rows[0] ?? null : rows;
          if (updating) {
            tagFilters = { ...filters };
            data = rows.map(row => ({ ...row, ...updating }));
          }
        }
        if (inserting && insertResult !== undefined) data = insertResult;
        return { data, error: null };
      };
      const q = {
        select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
        is: (key: string, value: unknown) => { filters[key] = value; return q; }, in: () => q, gte: () => q,
        insert: (payload: unknown) => {
          if (!service || table !== "checklist_instances") throw new Error("unexpected table INSERT");
          mocks.insert(payload); inserting = true; return q;
        },
        update: (payload: Record<string, unknown>) => { if (!service || table !== "checklist_completions" || !("actual_completer_id" in payload)) throw new Error("unexpected table UPDATE/compensation"); updating = payload; return q; },
        delete: () => { throw new Error("unexpected DELETE"); },
        maybeSingle: async () => result(true),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result(false)).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks(); tagRace = false; tagGone = null; tagFilters = {}; exists = true; insertResult = undefined; rpcError = null;
  instance = { id: "instance", template_id: "template", location_id: "shop", date: "2026-10-19", status: "open" };
  template = { id: "template", location_id: "shop", active: true, type: "closing", single_submission_only: false, submission_gate_predicate: null };
  items = [{ id: "00000000-0000-4000-8000-000000000001", template_id: "template", active: true, min_role_level: 3, required: true,
    label: "Task", station: null, hard_gate: false, report_reference_type: null, expects_count: false,
    expects_photo: false, input_type: null }];
  completions = [{ id: "completion", instance_id: "instance", template_item_id: "00000000-0000-4000-8000-000000000001", completed_by: "actor", completed_at: new Date(Date.now() - 90000).toISOString(), revoked_at: null, superseded_at: null, actual_completer_id: null, actual_completer_tagged_by: null, prep_data: null }];
  user = { id: "actor", name: "Actor", role: "key_holder", active: true, pin_hash: "test-hash" };
  session = { id: "session", user_id: "actor", revoked_at: null, expires_at: new Date(Date.now() + 60000).toISOString() };
  memberships = [{ location_id: "shop", active: true }];
  mocks.pin.mockResolvedValue(true); mocks.access.mockResolvedValue(true);
  mocks.reader = client(false); mocks.writer = client(true);
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (rpcError) return { data: null, error: { message: rpcError, code: rpcError === "22P02" ? "22P02" : "P0001" } };
    if (["checklist_revoke_completion", "checklist_revoke_with_reason", "checklist_mark_not_done"].includes(name)) {
      return { data: { completion: { ...completions[0], revoked_at: "2026-11-01T12:00:00Z" }, elapsed_ms: 60001, actor_level: 4, completer_level: 3 }, error: null };
    }
    if (instance.status !== "open") return { data: null, error: { message: "instance_not_open" } };
    if (name === "checklist_write_completion") return { data: { completion: { ...completions[0], id: "new", completed_at: new Date().toISOString() }, superseded_ids: [], kept_completed_at: false }, error: null };
    const submission = { id: "submission", instance_id: "instance", submitted_by: args.p_actor,
      completion_ids: args.p_completion_ids ?? [], is_final_confirmation: name === "checklist_confirm_instance" };
    if (name === "checklist_submit_batch") return { data: submission, error: null };
    if (name !== "checklist_confirm_instance") throw new Error("unexpected RPC");
    const reasons = (args.p_reasons as { templateItemId: string; reason: string }[]).map(r => ({
      id: "reason", instance_id: "instance", template_item_id: r.templateItemId, reason: r.reason, reported_by: args.p_actor,
    }));
    instance = { ...instance, status: reasons.length ? "incomplete_confirmed" : "confirmed", confirmed_by: args.p_actor };
    return { data: { instance, submission, reasons }, error: null };
  });
});

const endpoints = [
  ["completions", complete, { instanceId: "instance", templateItemId: "00000000-0000-4000-8000-000000000001" }, "checklist_write_completion"],
  ["submissions", submit, { instanceId: "instance", completionIds: ["completion"] }, "checklist_submit_batch"],
  ["confirm", confirm, { instanceId: "instance", pin: "1234", incompleteReasons: [] }, "checklist_confirm_instance"],
  ["instances", create, { templateId: "template", locationId: "shop", date: "2026-10-19" }, null],
] as const;
function request(name: string, body: unknown) {
  return new NextRequest(`https://example.test/api/checklist/${name}`, { method: "POST",
    headers: { origin: "https://example.test", "content-type": "application/json", cookie: "co_session=verified-test-cookie" }, body: JSON.stringify(body) });
}

describe("verified route authority and separate read/write clients", () => {
  it.each(endpoints)("%s ignores every spoofed actor/body authority field", async (name, post, body, rpc) => {
    if (name === "instances") exists = false;
    const response = await post(request(name, { ...body, actor: { userId: "victim", level: 10 },
      userId: "victim", completed_by: "victim", submitted_by: "victim", reported_by: "victim", locations: ["foreign"] }));
    expect(response.status).toBe(200);
    if (rpc) expect(mocks.rpc).toHaveBeenCalledWith(rpc, expect.objectContaining({ p_actor: "actor" }));
    else expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ triggered_by_user_id: "actor" }));
  });
  for (const state of ["revoked", "expired", "mismatch", "inactive", "inactive-membership", "foreign", "global-reader"] as const) {
    it.each(endpoints)(`%s refuses ${state} before mutation`, async (name, post, body) => {
      if (state === "revoked") session.revoked_at = new Date().toISOString();
      if (state === "expired") session.expires_at = new Date(Date.now() - 1).toISOString();
      if (state === "mismatch") session.user_id = "other";
      if (state === "inactive") user.active = false;
      if (state === "inactive-membership") memberships = [{ location_id: "shop", active: false }];
      if (state === "foreign" || state === "global-reader") memberships = [];
      if (state === "global-reader") user.role = "moo";
      if (name === "instances") exists = false; // Assert creation refusal, not broader READ authority.
      const response = await post(request(name, body));
      expect(response.status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
    });
  }
});

describe("application gates and RPC outcome mapping", () => {
  it.each(["completions", "submissions", "confirm"])("%s refuses a closed instance", async name => {
    instance.status = "confirmed";
    const entry = endpoints.find(e => e[0] === name)!;
    expect((await entry[1](request(name, entry[2]))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "wrong", "1234"])("refuses missing/wrong PIN %s", async pin => {
    mocks.pin.mockResolvedValue(false);
    const response = await confirm(request("confirm", { instanceId: "instance", pin, incompleteReasons: [] }));
    expect(response.status).toBe(pin === undefined || pin === "" ? 400 : 401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses a missing PIN hash", async () => {
    user.pin_hash = null;
    await expect(confirmInstance(mocks.reader, confirmArgs)).rejects.toMatchObject({ code: "pin_mismatch" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["instance", "author", "missing"])("refuses foreign/missing batch completion: %s", async kind => {
    if (kind === "instance") completions[0]!.instance_id = "foreign";
    if (kind === "author") completions[0]!.completed_by = "foreign";
    if (kind === "missing") completions = [];
    await expect(submitBatch(mocks.reader, { instanceId: "instance", actor, completionIds: ["completion"] })).rejects.toMatchObject({
      code: kind === "missing" ? "completion_not_found" : `completion_wrong_${kind}`,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["missing", "extra", "duplicate", "blank"])("validates exact reasons before PIN/RPC: %s", async kind => {
    completions = [];
    const good = { templateItemId: "00000000-0000-4000-8000-000000000001", reason: "supplies missing" };
    const reasons = kind === "missing" ? [] : kind === "extra" ? [good, { ...good, templateItemId: "00000000-0000-4000-8000-000000000002" }]
      : kind === "duplicate" ? [good, good] : [{ ...good, reason: "  " }];
    await expect(confirmInstance(mocks.reader, { ...confirmArgs, incompleteReasons: reasons })).rejects.toMatchObject({
      code: kind === "missing" ? "missing_reasons" : kind === "blank" ? "blank_reason" : "extra_reasons",
    });
    expect(mocks.pin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])("status agrees with SQL, incomplete=%s; exact live snapshot passed", async incomplete => {
    if (incomplete) completions = [];
    const reasons = incomplete ? [{ templateItemId: "00000000-0000-4000-8000-000000000001", reason: "supplies missing" }] : [];
    const result = await confirmInstance(mocks.reader, { ...confirmArgs, incompleteReasons: reasons });
    expect(result.status).toBe(incomplete ? "incomplete_confirmed" : "confirmed");
    expect(mocks.rpc).toHaveBeenCalledWith("checklist_confirm_instance", expect.objectContaining({
      p_expected_completion_ids: incomplete ? [] : ["completion"], p_reasons: reasons,
    }));
  });
  it.each(["completion_set_changed", "instance_not_open", "not_authorized", "item_mismatch", "invalid_reasons", "invalid_payload", "22P02",
    "completion_cardinality", "submission_cardinality", "instance_cardinality", "reason_cardinality"])("maps SQL %s", async error => {
    rpcError = error;
    const response = await confirm(request("confirm", endpoints[2][2]));
    const status = error.endsWith("cardinality") ? 409 : ["not_authorized", "item_mismatch"].includes(error) ? 403
      : ["completion_set_changed", "instance_not_open"].includes(error) ? 409 : 400;
    expect(response.status).toBe(status);
    const body = await response.json();
    if (status === 409) expect(body).toMatchObject({ code: ["instance_not_open", "completion_cardinality"].includes(error) ? "concurrent_modification" : error });
    if (error === "completion_set_changed") expect(body.error).toBe("The list changed \u2014 review it again");
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("rejects non-UUID reason ids before PIN/RPC", async () => {
    const response = await confirm(request("confirm", { ...confirmArgs, incompleteReasons: [{ templateItemId: "not-a-uuid", reason: "missing" }] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_payload" });
    expect(mocks.pin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([[[]], [["old"]], [["old", "older"]]])("audits locked RPC prior heads %j without a history read", async prior => {
    mocks.rpc.mockResolvedValueOnce({ data: { completion: { ...completions[0], id: "new" },
      superseded_ids: prior, kept_completed_at: prior.length === 1 }, error: null });
    const originalFrom = mocks.writer.from.bind(mocks.writer);
    mocks.writer.from = ((table: string) => {
      if (table === "checklist_completions") throw new Error("extra history read");
      return originalFrom(table);
    }) as typeof mocks.writer.from;
    await completeItem(mocks.reader, completionArgs);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({
      superseded_prior_id: prior.length === 1 ? prior[0] : null,
      superseded_prior_ids: prior, kept_completed_at: prior.length === 1,
    }) }));
  });
  it("confirm-vs-confirm mocked ordering: one wins, no loser compensation", async () => {
    const results = await Promise.allSettled([confirmInstance(mocks.reader, confirmArgs), confirmInstance(mocks.reader, confirmArgs)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "instance_closed" } });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(instance.status).toBe("confirmed");
    await expect(completeItem(mocks.reader, completionArgs)).rejects.toMatchObject({ code: "instance_closed" });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it("replacement losing to confirm at the RPC maps to closed 409", async () => {
    mocks.rpc.mockImplementationOnce(async () => { instance.status = "confirmed"; return { data: null, error: { message: "instance_not_open" } }; });
    const response = await complete(request("completions", endpoints[0][2]));
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "instance_closed" });
  });
  it.each(["assignment", "answer", "cash", "hard", "walk-out"])("retains %s precheck", async gate => {
    if (gate === "assignment") { template.type = "opening"; mocks.access.mockResolvedValue(false); }
    if (gate === "answer") { items[0]!.input_type = "yes_no"; }
    if (gate === "cash") { items[0]!.report_reference_type = "cash_report"; completions = []; }
    if (gate === "hard") { items[0]!.hard_gate = true; completions = []; }
    if (gate === "walk-out") { items[0]!.station = "Walk-Out Verification"; completions = []; }
    await expect(gate === "answer" ? completeItem(mocks.reader, completionArgs)
      : confirmInstance(mocks.reader, { ...confirmArgs, actor: gate === "assignment" ? checklistActor({ level: 3, role: "employee" }) : actor }))
      .rejects.toHaveProperty("code");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("refuses creation by an owner without membership despite global read authority", async () => {
    exists = false;
    await expect(getOrCreateInstance(mocks.reader, { templateId: "template", locationId: "shop", date: "2026-10-19",
      actor: checklistActor({ role: "owner", level: 9, locations: [] }) })).rejects.toMatchObject({ code: "role_level_insufficient" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("completed-item role floor still gates confirmation", async () => {
    items[0]!.min_role_level = 7;
    await expect(confirmInstance(mocks.reader, confirmArgs)).rejects.toMatchObject({ code: "role_level_insufficient", required: 7 });
    expect(mocks.pin).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([null, [], [{ id: "a" }, { id: "b" }]])("refuses invalid RPC row shape %j", async data => {
    mocks.rpc.mockResolvedValueOnce({ data, error: null });
    await expect(completeItem(mocks.reader, completionArgs)).rejects.toThrow("invalid cardinality");
  });
  it("accepts the JSONB completion and one composite batch row", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { completion: { ...completions[0], id: "new" }, superseded_ids: [], kept_completed_at: false }, error: null });
    await expect(completeItem(mocks.reader, completionArgs)).resolves.toMatchObject({ completion: { id: "new" } });
    mocks.rpc.mockResolvedValueOnce({ data: [{ id: "batch", completion_ids: ["completion"] }], error: null });
    await expect(submitBatch(mocks.reader, { instanceId: "instance", actor, completionIds: ["completion"] }))
      .resolves.toMatchObject({ submission: { id: "batch" } });
  });
});

describe("instance creation preserves both policy alternatives", () => {
  it.each(["opening", "prep"])("employee cannot create %s", async type => {
    exists = false; template.type = type;
    await expect(getOrCreateInstance(mocks.reader, { templateId: "template", locationId: "shop", date: "2020-01-01",
      actor: checklistActor({ role: "employee", level: 3 }) })).rejects.toMatchObject({ required: 4 });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("original policy allows old dates/inactive closing templates and ignores another starter", async () => {
    exists = false; template.active = false;
    await expect(getOrCreateInstance(mocks.reader, { templateId: "template", locationId: "shop", date: "2020-01-01", actor }))
      .resolves.toMatchObject({ created: true });
    exists = true; instance.triggered_by_user_id = "someone-else";
    await expect(getOrCreateInstance(mocks.reader, { templateId: "template", locationId: "shop", date: "2020-01-01", actor }))
      .resolves.toMatchObject({ created: false });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
  it("zero returned rows fail explicitly", async () => {
    exists = false; insertResult = null;
    await expect(getOrCreateInstance(mocks.reader, { templateId: "template", locationId: "shop", date: "2020-01-01", actor }))
      .rejects.toThrow("insert returned no row");
  });
});

describe("chunk-2 review regressions", () => {
  it.each(["completion_cardinality", "23505"])("completion %s returns reloadable 409", async code => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: code } });
    const response = await complete(request("completions", endpoints[0][2]));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "concurrent_modification" });
  });
  it.each(endpoints.slice(0, 3))("%s logs a distinct missing-migration tag", async (name, post, body) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "function absent" } });
      expect((await post(request(name, body))).status).toBe(500);
      expect(log).toHaveBeenCalledWith("[checklist 0276_missing]", expect.anything());
    } finally { log.mockRestore(); }
  });
  it.each(["foreign", "inactive"])("instance endpoint refuses %s closing template", async kind => {
    exists = false;
    if (kind === "foreign") template.location_id = "other-shop";
    else template.active = false;
    const response = await create(request("instances", endpoints[3][2]));
    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

const correctionEndpoints = [
  ["revoke", revoke, {}, "checklist_revoke_completion"],
  ["revoke-with-reason", reasonRevoke, { reason: "other", note: "Wrong task" }, "checklist_revoke_with_reason"],
  ["mark-not-done", markNotDone, { note: "Still dirty" }, "checklist_mark_not_done"],
  ["tag-actual-completer", tag, { actualCompleterId: "actor" }, null],
] as const;
const correctionContext = { params: Promise.resolve({ id: "completion" }) };
describe("serialized corrections and tag CAS", () => {
  it.each(correctionEndpoints)("%s resolves fresh authority and ignores spoofed body", async (name, post, body, rpc) => {
    const response = await post(request(name, { ...body, actor: { userId: "spoof", level: 10 } }), correctionContext);
    expect(response.status).toBe(200);
    if (rpc) expect(mocks.rpc).toHaveBeenCalledWith(rpc, expect.objectContaining({ p_actor: "actor", p_completion: "completion" }));
    else expect(tagFilters).toMatchObject({ actual_completer_id: null, actual_completer_tagged_by: null });
  });
  for (const state of ["revoked", "expired", "inactive"] as const) {
    it.each(correctionEndpoints)(`%s refuses ${state} authority before mutation`, async (name, post, body) => {
      if (state === "revoked") session.revoked_at = new Date().toISOString();
      if (state === "expired") session.expires_at = new Date(0).toISOString();
      if (state === "inactive") user.active = false;
      expect((await post(request(name, body), correctionContext)).status).toBe(403);
      expect(mocks.rpc).not.toHaveBeenCalled(); expect(tagFilters).toEqual({});
    });
  }
  it.each(["instance_not_open", "reference_row_not_correctable", "prep_data_not_correctable", "not_self", "use_quick_revoke", "outside_quick_window", "revocation_note_required"])("maps locked SQL refusal %s", async code => {
    rpcError = code;
    const response = await revoke(request("revoke", {}), correctionContext);
    expect(response.status).toBe(["instance_not_open", "outside_quick_window"].includes(code) ? 409 : code === "not_self" ? 403 : 400);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([revokeCompletion, revokeWithReason, markNotDoneByAuthority])("uses locked timing in success audit", async write => {
    await write(mocks.reader, { completionId: "completion", actor, reason: "other", note: "Wrong task" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ elapsed_ms: 60001 }) }));
  });
  it.each([null, "actor"])("tag CAS rejects stale prior pair %s with 409 and no success audit", async prior => {
    completions[0]!.actual_completer_id = prior; completions[0]!.actual_completer_tagged_by = prior;
    tagRace = true;
    const response = await tag(request("tag", { actualCompleterId: "actor" }), correctionContext);
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "tag_changed" });
    expect(tagFilters).toMatchObject({ actual_completer_id: prior, actual_completer_tagged_by: prior });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(completions[0]).toMatchObject({ actual_completer_id: "gm-completer", actual_completer_tagged_by: "gm-tagger" });
  });
  it.each(["reference", "prep"])("tag refuses %s row", async kind => {
    if (kind === "reference") items[0]!.report_reference_type = "cash_report";
    else completions[0]!.prep_data = {};
    await expect(tagActualCompleter(mocks.reader, { completionId: "completion", actor, actualCompleterId: "actor" }))
      .rejects.toMatchObject({ code: kind === "reference" ? "reference_row_not_correctable" : "prep_data_not_correctable" });
    expect(tagFilters).toEqual({});
  });
  it("tag remains retrospective", async () => {
    instance.status = "confirmed";
    expect((await tag(request("tag", { actualCompleterId: "actor" }), correctionContext)).status).toBe(200);
  });
  it.each(["required", "walk-out", "hard", "cash"])("revoked %s item fails confirm", async gate => {
    completions[0]!.revoked_at = new Date().toISOString();
    if (gate === "walk-out") items[0]!.station = "Walk-Out Verification";
    if (gate === "hard") items[0]!.hard_gate = true;
    if (gate === "cash") items[0]!.report_reference_type = "cash_report";
    await expect(confirmInstance(mocks.reader, confirmArgs)).rejects.toMatchObject({ code:
      gate === "required" ? "missing_reasons" : gate === "walk-out" ? "finalize_not_authorized" : gate === "hard" ? "hard_gate_incomplete" : "cash_deposit_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("revoked required item accepts its reason instead of reporting extra_reasons, and sends filtered IDs", async () => {
    completions[0]!.revoked_at = new Date().toISOString();
    await confirmInstance(mocks.reader, { ...confirmArgs, incompleteReasons: [{ templateItemId: items[0]!.id as string, reason: "Not done" }] });
    expect(mocks.rpc).toHaveBeenCalledWith("checklist_confirm_instance", expect.objectContaining({ p_expected_completion_ids: [] }));
  });
});


describe("CC correction fix regressions", () => {
  for (const [name, post, body] of correctionEndpoints.slice(0, 3)) {
    it.each(["PGRST202", "42883", "missing-message"])(`${name} maps missing RPC %s to 503`, async code => {
      mocks.rpc.mockResolvedValueOnce({ data: null, error: { code,
        message: code === "missing-message" ? "Could not find the function public.checklist_revoke_completion in the schema cache" : "Unavailable function" } });
      const response = await post(request(name, body), correctionContext);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "checklist_corrections_unavailable" });
      expect(mocks.audit).not.toHaveBeenCalled();
    });
    it(`${name} maps missing parent to 404`, async () => {
      rpcError = "instance_not_found";
      const response = await post(request(name, body), correctionContext);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "instance_not_found" });
    });
  }
  it.each([revokeCompletion, revokeWithReason])("self denial preserves hidden-completion refusal", async write => {
    rpcError = "not_authorized";
    await expect(write(mocks.reader, { completionId: "completion", actor, reason: "other", note: "Wrong task" }))
      .rejects.toMatchObject({ code: "completion_not_found" });
  });
  it.each([revokeWithReason, markNotDoneByAuthority])("blank note precedes lookup and mutable-state checks", async write => {
    completions = [];
    await expect(write(mocks.reader, { completionId: "completion", actor, reason: "other", note: " " }))
      .rejects.toMatchObject({ code: "revocation_note_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["revoked_at", "superseded_at"] as const)("tag losing to %s preserves concurrent_modification", async state => {
    tagGone = state;
    const response = await tag(request("tag", { actualCompleterId: "actor" }), correctionContext);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "concurrent_modification" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
