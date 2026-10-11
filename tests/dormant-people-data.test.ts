import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { listUsers, setDormant } from "@/lib/admin/users";
import { loadLinkReview } from "@/lib/toast/employee-links";

const mocks = vi.hoisted(() => ({ client: vi.fn(), audit: vi.fn(), revoke: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({ revokeAllUserSessions: mocks.revoke }));
vi.mock("@/lib/toast/client", () => ({ toastGet: mocks.toast }));
const LOC = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const actor = { user: { id: "actor", role: "owner" }, locations: [] } as unknown as AuthContext;
let target: Record<string, unknown>, history: Record<string, unknown>[], rpcError: boolean, updateRows: unknown[];
let writes: Record<string, unknown>[];
let memberLocations: string[];
let rpcCalls: Array<{ name: string; args: unknown; filters: Array<[string, unknown]> }>;

/** In-memory query double; no real client/env or database access. */
function query(source: string, call?: (typeof rpcCalls)[number]) {
  let updating = false, single = false;
  const filters: Array<[string, unknown]> = [];
  const q = {
    select: () => q, order: () => q, range: () => q, abortSignal: () => q, in: () => q,
    eq: (key: string, value: unknown) => { filters.push([key, value]); call?.filters.push([key, value]); return q; },
    is: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    update: (value: Record<string, unknown>) => { updating = true; writes.push(value); return q; },
    returns: () => q, maybeSingle: () => { single = true; return q; },
    then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => {
      let data: unknown;
      if (source === "users") data = updating ? updateRows : single ? target : [target];
      else if (source === "user_locations") data = memberLocations.map((location_id) => ({ user_id: "u", location_id }));
      else if (source === "locations") data = { toast_restaurant_guid: "restaurant" };
      else if (source === "toast_employee_links") data = [];
      else data = history.filter((r) => filters.every(([k, v]) => r[k] === v));
      return Promise.resolve({ data, error: source === "rpc" && rpcError ? { message: "private provider text" } : null }).then(resolve, reject);
    },
  };
  return q;
}
const service = { from: (table: string) => query(table), rpc: (name: string, args: unknown) => {
  const call = { name, args, filters: [] as Array<[string, unknown]> }; rpcCalls.push(call); return query("rpc", call);
} } as unknown as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks(); mocks.client.mockReturnValue(service);
  target = { id: "u", name: "Ana", email: null, role: "employee", active: true, last_login_at: null,
    created_at: "2025-01-01", dormant_at: null };
  history = []; rpcError = false; updateRows = [{ id: "u" }]; writes = []; memberLocations = [LOC]; rpcCalls = [];
});
describe("manual dormancy authorization and audit", () => {
  it("rejects below-floor callers before I/O, and peers/seniors", async () => {
    await expect(setDormant({ ...actor, user: { ...actor.user, role: "gm" } }, "u", true)).rejects.toMatchObject({ code: "forbidden" });
    expect(mocks.client).not.toHaveBeenCalled();
    target.role = "owner";
    await expect(setDormant(actor, "u", true)).rejects.toMatchObject({ code: "forbidden" });
    expect(writes).toEqual([]);
  });
  it("requires every target membership in a scoped actor's accessible shops", async () => {
    memberLocations = [LOC, OTHER];
    const scoped = { ...actor, user: { ...actor.user, role: "moo" as const }, locations: [LOC] };
    await expect(setDormant(scoped, "u", true)).rejects.toMatchObject({ code: "forbidden" });
    expect(writes).toEqual([]);
    memberLocations = [LOC];
    await setDormant(scoped, "u", true);
    expect(writes).toHaveLength(1);
  });
  it("marks and audits without revoking sessions; repeated state is a no-op", async () => {
    await setDormant(actor, "u", true);
    expect(writes[0]).toMatchObject({ dormant_by: "actor" });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.dormant", resourceId: "u" }));
    expect(mocks.revoke).not.toHaveBeenCalled();
    target.dormant_at = writes[0]!.dormant_at;
    await setDormant(actor, "u", true);
    expect(writes).toHaveLength(1);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
  it("clears both manual columns, with no audit on an already clear marker", async () => {
    await setDormant(actor, "u", false); expect(writes).toEqual([]);
    target.dormant_at = "2026-10-01";
    await setDormant(actor, "u", false);
    expect(writes).toEqual([{ dormant_at: null, dormant_by: null }]);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.wake" }));
  });
  it("a clock-in permits marking again; a lost update is explicit and unaudited", async () => {
    target.dormant_at = "2025-01-01";
    history = [{ user_id: "u", last_in_at: "2026-10-11", location_id: LOC, employee_guid: "e" }];
    updateRows = [];
    await expect(setDormant(actor, "u", true)).rejects.toMatchObject({ code: "dormancy_changed" });
    expect(writes).toHaveLength(1); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("list uses the latest clock-in across shops and all history for manual wake", async () => {
    target.role = "agm"; target.dormant_at = "2025-01-01";
    history = ["2024-01-01", "2025-02-01"].map((last_in_at, i) => ({ user_id: "u", last_in_at, location_id: i ? OTHER : LOC, employee_guid: "e" }));
    expect((await listUsers({}))[0]!.dormancy).toEqual({ dormant: false });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.args).toEqual({ p_since: "-infinity" });
  });
});
describe("Toast history split and fail-open disclosure", () => {
  const args = { actor: { userId: "actor", role: "owner" as const, level: 9, locations: [] }, locationId: LOC };
  beforeEach(() => {
    mocks.toast.mockResolvedValue([
      { guid: "seen", firstName: "Bea", deleted: false },
      { guid: "missing", firstName: "Cal", deleted: false },
      { guid: "archived", firstName: "Dee", deleted: true },
    ]);
    history = ["seen", "archived"].map((employee_guid) => ({ employee_guid, location_id: LOC, user_id: null, last_in_at: new Date().toISOString() }));
    history.push({ employee_guid: "missing", location_id: OTHER, user_id: null, last_in_at: new Date().toISOString() });
  });
  it("scopes clock-ins to the shop and retains every employee/control payload", async () => {
    const result = await loadLinkReview(service, args);
    expect(result.unlinked.filter((r) => !r.notSeen).map((r) => r.guid)).toEqual(["seen"]);
    expect(result.unlinked).toHaveLength(3);
    expect(result.clockHistoryUnavailable).toBe(false);
    expect(rpcCalls[0]!.filters).toContainEqual(["location_id", LOC]);
  });
  it("history failure treats archived/missing employees as seen and logs only a code", async () => {
    rpcError = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await loadLinkReview(service, args);
      expect(result.clockHistoryUnavailable).toBe(true);
      expect(result.unlinked.every((r) => !r.notSeen)).toBe(true);
      expect(warn).toHaveBeenCalledWith("admin_clock_ins_failed");
    } finally { warn.mockRestore(); }
  });
});
