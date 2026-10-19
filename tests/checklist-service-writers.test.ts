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
import { completeItem, submitBatch, confirmInstance, getOrCreateInstance } from "@/lib/checklists";
import { POST as complete } from "@/app/api/checklist/completions/route";
import { POST as submit } from "@/app/api/checklist/submissions/route";
import { POST as confirm } from "@/app/api/checklist/confirm/route";
import { POST as create } from "@/app/api/checklist/instances/route";

let instance: Record<string, unknown>;
let template: Record<string, unknown>;
let items: Record<string, unknown>[];
let completions: Record<string, unknown>[];
let user: Record<string, unknown>;
let session: Record<string, unknown>;
let memberships: { location_id: string }[];
let exists: boolean;
let insertResult: unknown;
let rpcError: string | null;
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
      const filters: Record<string, unknown> = {};
      const result = (single: boolean) => {
        let data: unknown = table === "sessions" ? session : table === "users" ? user
          : table === "user_locations" ? memberships
          : table === "checklist_instances" ? exists || inserting ? instance : null
          : table === "checklist_templates" ? template
          : table === "checklist_template_items" ? single ? items.find(row => row.id === (filters.id ?? "00000000-0000-4000-8000-000000000001")) : items
          : table === "checklist_completions" ? filters.superseded_by ? [] : completions : [];
        if (inserting && insertResult !== undefined) data = insertResult;
        return { data, error: null };
      };
      const q = {
        select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
        is: () => q, in: () => q,
        insert: (payload: unknown) => {
          if (!service || table !== "checklist_instances") throw new Error("unexpected table INSERT");
          mocks.insert(payload); inserting = true; return q;
        },
        update: () => { throw new Error("unexpected table UPDATE/compensation"); },
        delete: () => { throw new Error("unexpected DELETE"); },
        maybeSingle: async () => result(true),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result(false)).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks(); exists = true; insertResult = undefined; rpcError = null;
  instance = { id: "instance", template_id: "template", location_id: "shop", date: "2026-10-19", status: "open" };
  template = { id: "template", type: "closing", single_submission_only: false, submission_gate_predicate: null };
  items = [{ id: "00000000-0000-4000-8000-000000000001", template_id: "template", active: true, min_role_level: 3, required: true,
    label: "Task", station: null, hard_gate: false, report_reference_type: null, expects_count: false,
    expects_photo: false, input_type: null }];
  completions = [{ id: "completion", instance_id: "instance", template_item_id: "00000000-0000-4000-8000-000000000001", completed_by: "actor" }];
  user = { id: "actor", role: "key_holder", active: true, pin_hash: "test-hash" };
  session = { id: "session", user_id: "actor", revoked_at: null, expires_at: new Date(Date.now() + 60000).toISOString() };
  memberships = [{ location_id: "shop" }];
  mocks.pin.mockResolvedValue(true); mocks.access.mockResolvedValue(true);
  mocks.reader = client(false); mocks.writer = client(true);
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (rpcError) return { data: null, error: { message: rpcError, code: rpcError === "22P02" ? "22P02" : "P0001" } };
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
    headers: { "content-type": "application/json", cookie: "co_session=verified-test-cookie" }, body: JSON.stringify(body) });
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
  for (const state of ["revoked", "expired", "mismatch", "inactive", "foreign", "global-reader"] as const) {
    it.each(endpoints)(`%s refuses ${state} before mutation`, async (name, post, body) => {
      if (state === "revoked") session.revoked_at = new Date().toISOString();
      if (state === "expired") session.expires_at = new Date(Date.now() - 1).toISOString();
      if (state === "mismatch") session.user_id = "other";
      if (state === "inactive") user.active = false;
      if (state === "foreign" || state === "global-reader") memberships = [];
      if (state === "global-reader") user.role = "moo";
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
    if (status === 409) expect(body).toMatchObject({ code: error === "instance_not_open" ? "concurrent_modification" : error });
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
  it("refuses an owner without membership despite global read authority", async () => {
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
