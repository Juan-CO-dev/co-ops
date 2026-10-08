import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endShift, type AssignmentActor } from "@/lib/assignments";
import { audit } from "@/lib/audit";
import { canAdminLinks, linkToastEmployee, runAutoLinks, unlinkToastEmployee } from "@/lib/toast/employee-links";
import { enqueueNotification } from "@/lib/notifications";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined) }));

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const TARGET = "44444444-4444-4444-8444-444444444444";
const LINK = "55555555-5555-4555-8555-555555555555";
const GM = "66666666-6666-4666-8666-666666666666";
const kh: AssignmentActor = { userId: ACTOR, role: "key_holder", level: 4, locations: [SHOP] };
const crew: AssignmentActor = { userId: TARGET, role: "employee", level: 3, locations: [SHOP] };

function fake(opts: { role?: string; rpcData?: unknown; rpcError?: string; tables?: Record<string, unknown[]> } = {}) {
  const signals: AbortSignal[] = [];
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    void name; void args; // typed for mock.calls
    const pending = Promise.resolve({ data: opts.rpcData ?? { id: LINK, changed: true }, error: opts.rpcError ? { message: opts.rpcError } : null });
    return Object.assign(pending, { abortSignal: (s: AbortSignal) => { signals.push(s); return pending; } });
  });
  const from = vi.fn((table: string) => {
    const rows = opts.tables?.[table] ?? [];
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, not: () => q, gte: () => q,
      abortSignal: (s: AbortSignal) => { signals.push(s); return q; },
      range: () => q,
      maybeSingle: async () => ({ data: table === "users" ? { role: opts.role ?? "employee" } : table === "user_locations" ? { user_id: TARGET } : rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return q;
  });
  return { service: { from, rpc } as unknown as SupabaseClient, from, rpc, signals };
}

beforeEach(() => vi.stubEnv("WHOS_HERE", "1"));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("End my shift / end someone's shift", () => {
  it("is off until WHOS_HERE=1 (before 0233 is applied nothing is called)", async () => {
    vi.stubEnv("WHOS_HERE", "");
    const f = fake();
    await expect(endShift(f.service, { actor: crew, locationId: SHOP, userId: TARGET })).rejects.toMatchObject({ code: "not_enabled", status: 404 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("self: any level may end their own shift; the RPC gets the actor, the target and no reason", async () => {
    const f = fake({ rpcData: { id: LINK, changed: true, released_station: true, released_tasks: 2 } });
    await expect(endShift(f.service, { actor: crew, locationId: SHOP, userId: TARGET })).resolves.toEqual({ id: LINK, changed: true });
    expect(f.rpc).toHaveBeenCalledWith("end_shift", { p_actor_id: TARGET, p_user_id: TARGET, p_location_id: SHOP, p_reason_code: null, p_reason_note: null });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "shift.end", resourceTable: "shift_ends",
      metadata: expect.objectContaining({ self: true, released_station: true, released_tasks: 2 }) });
  });
  it("binds the shop before any read or write", async () => {
    const f = fake();
    await expect(endShift(f.service, { actor: kh, locationId: OTHER, userId: TARGET })).rejects.toMatchObject({ code: "location_access_denied" });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("someone else: below KH is refused; KH cannot end a higher level's shift", async () => {
    const f = fake({ role: "gm" });
    await expect(endShift(f.service, { actor: { ...crew, userId: GM }, locationId: SHOP, userId: TARGET })).rejects.toMatchObject({ code: "role_insufficient" });
    await expect(endShift(f.service, { actor: kh, locationId: SHOP, userId: TARGET })).rejects.toMatchObject({ code: "role_insufficient" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("0228 rule: the RPC's override_reason_required is a 422; a reason passes through and the overridden assigner is told", async () => {
    await expect(endShift(fake({ rpcError: "override_reason_required" }).service, { actor: kh, locationId: SHOP, userId: TARGET }))
      .rejects.toMatchObject({ code: "override_reason_required", status: 422 });
    const f = fake({ rpcData: { id: LINK, changed: true, overridden_assigner_id: GM, reason_code: "coverage_change", reason_note: null } });
    await endShift(f.service, { actor: kh, locationId: SHOP, userId: TARGET, reasonCode: "coverage_change" });
    expect(f.rpc.mock.calls[0]![1]).toMatchObject({ p_reason_code: "coverage_change" });
    expect(vi.mocked(enqueueNotification).mock.calls[0]![1]).toMatchObject({ relatedTable: "shift_ends", recipients: [{ userId: GM, deliveryMethod: "in_app" }] });
  });
  it("an Other reason without a note is refused before the RPC", async () => {
    const f = fake();
    await expect(endShift(f.service, { actor: kh, locationId: SHOP, userId: TARGET, reasonCode: "other" })).rejects.toMatchObject({ code: "invalid_payload" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("a repeat tap that changes nothing writes no audit row", async () => {
    const f = fake({ rpcData: { id: LINK, changed: false } });
    await endShift(f.service, { actor: crew, locationId: SHOP, userId: TARGET });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("Toast employee links: who may link, where", () => {
  const gm = { userId: GM, role: "gm" as const, level: 7, locations: [SHOP] };
  it("GM for their own shop, level 8+ for every shop, nobody below 7", () => {
    expect(canAdminLinks(gm, SHOP)).toBe(true);
    expect(canAdminLinks(gm, OTHER)).toBe(false);
    expect(canAdminLinks({ ...gm, role: "moo", level: 8, locations: [] }, OTHER)).toBe(true);
    expect(canAdminLinks({ ...gm, role: "agm", level: 6 }, SHOP)).toBe(false);
  });
  it("manual link: bound before I/O, then the RPC with source manual, audited as a destructive create", async () => {
    const f = fake({ rpcData: { id: LINK, changed: true, backfilled: 14 } });
    await expect(linkToastEmployee(f.service, { actor: gm, locationId: OTHER, employeeGuid: "emp-1", userId: TARGET })).rejects.toMatchObject({ code: "location_access_denied" });
    expect(f.rpc).not.toHaveBeenCalled();
    await expect(linkToastEmployee(f.service, { actor: gm, locationId: SHOP, employeeGuid: "emp-1", userId: TARGET })).resolves.toMatchObject({ backfilled: 14 });
    expect(f.rpc).toHaveBeenCalledWith("link_toast_employee", { p_actor_id: GM, p_location_id: SHOP, p_employee_guid: "emp-1", p_user_id: TARGET, p_source: "manual" });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "toast_employee_link.create", metadata: expect.objectContaining({ backfilled: 14, source: "manual" }) });
  });
  it("maps the RPC refusals to stable codes", async () => {
    await expect(linkToastEmployee(fake({ rpcError: "employee_already_linked" }).service, { actor: gm, locationId: SHOP, employeeGuid: "emp-1", userId: TARGET }))
      .rejects.toMatchObject({ code: "employee_already_linked", status: 409 });
    await expect(unlinkToastEmployee(fake({ rpcError: "link_not_found" }).service, { actor: gm, locationId: SHOP, linkId: LINK }))
      .rejects.toMatchObject({ code: "link_not_found", status: 404 });
    await expect(linkToastEmployee(fake().service, { actor: gm, locationId: SHOP, employeeGuid: "bad guid!", userId: TARGET }))
      .rejects.toMatchObject({ code: "invalid_payload" });
  });
  it("unlink: audited as a destructive deactivate with what was cleared", async () => {
    const f = fake({ rpcData: { id: LINK, changed: true, cleared: 3, employee_guid: "emp-1", user_id: TARGET } });
    await unlinkToastEmployee(f.service, { actor: gm, locationId: SHOP, linkId: LINK });
    expect(f.rpc).toHaveBeenCalledWith("unlink_toast_employee", { p_actor_id: GM, p_location_id: SHOP, p_link_id: LINK });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "toast_employee_link.deactivate", metadata: expect.objectContaining({ cleared: 3 }) });
  });
});

describe("auto links (the who's-here tick's own step)", () => {
  const employees = [
    { guid: "emp-ana", firstName: "Ana", lastName: "López", deleted: false },
    { guid: "emp-maya", firstName: "Maya", lastName: "Stone", deleted: false },
  ];
  it("links only exact full names, system actor + source auto, audited non-destructively", async () => {
    const f = fake({ rpcData: { id: LINK, changed: true, backfilled: 5 }, tables: {
      user_locations: [{ user_id: "u-ana" }, { user_id: "u-maya" }],
      users: [{ id: "u-ana", name: "Ana López", role: "employee" }, { id: "u-maya", name: "Maya", role: "employee" }],
      toast_employee_links: [],
    } });
    await expect(runAutoLinks(f.service, { locationId: SHOP, rawEmployees: employees })).resolves.toEqual({ linked: 1, skipped: 0 });
    expect(f.rpc).toHaveBeenCalledTimes(1);
    expect(f.rpc).toHaveBeenCalledWith("link_toast_employee", { p_actor_id: null, p_location_id: SHOP, p_employee_guid: "emp-ana", p_user_id: "u-ana", p_source: "auto" });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ actorId: null, action: "toast_employee_link.auto_create", metadata: expect.objectContaining({ rule: "exact_full_name" }) });
  });
  it("a lost race (already linked) is skipped, an unknown failure throws a fixed code", async () => {
    const tables = { user_locations: [{ user_id: "u-ana" }], users: [{ id: "u-ana", name: "Ana López", role: "employee" }], toast_employee_links: [] };
    await expect(runAutoLinks(fake({ rpcError: "user_already_linked", tables }).service, { locationId: SHOP, rawEmployees: employees })).resolves.toEqual({ linked: 0, skipped: 1 });
    await expect(runAutoLinks(fake({ rpcError: "boom", tables }).service, { locationId: SHOP, rawEmployees: employees })).rejects.toThrow("toast_autolink_failed");
    // r1 P1-2: a rejection the RPC enforces is a skip, not a failure.
    await expect(runAutoLinks(fake({ rpcError: "link_rejected", tables }).service, { locationId: SHOP, rawEmployees: employees })).resolves.toEqual({ linked: 0, skipped: 1 });
  });
  it("r1 P1-2: an unlinked (inactive) pair is never proposed again", async () => {
    const f = fake({ tables: { user_locations: [{ user_id: "u-ana" }], users: [{ id: "u-ana", name: "Ana López", role: "employee" }],
      toast_employee_links: [{ id: LINK, employee_guid: "emp-ana", user_id: "u-ana", active: false, source: "auto" }] } });
    await expect(runAutoLinks(f.service, { locationId: SHOP, rawEmployees: employees })).resolves.toEqual({ linked: 0, skipped: 0 });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("r1 P2-6: every read and RPC carries the step's signal; an aborted step stops with a fixed code", async () => {
    const tables = { user_locations: [{ user_id: "u-ana" }], users: [{ id: "u-ana", name: "Ana López", role: "employee" }], toast_employee_links: [] };
    const f = fake({ tables, rpcData: { id: LINK, changed: true, backfilled: 0 } });
    const controller = new AbortController();
    await runAutoLinks(f.service, { locationId: SHOP, rawEmployees: employees, signal: controller.signal });
    expect(f.signals.length).toBeGreaterThanOrEqual(5); // members, users x2, links, the RPC
    expect(f.signals.every((s) => s === controller.signal)).toBe(true);
    controller.abort();
    await expect(runAutoLinks(f.service, { locationId: SHOP, rawEmployees: employees, signal: controller.signal })).rejects.toThrow("toast_autolink_deadline");
  });
});
