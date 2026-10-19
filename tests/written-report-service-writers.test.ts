import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { checklistActor } from "./helpers/checklist-actor";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), rpc: vi.fn(), audit: vi.fn(), authed: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/session", () => ({ requireSession: async () => ({
  user: { id: "actor" }, session: { id: "session", userId: "actor" },
  role: "owner", level: 9, locations: ["stale-shop"],
}) }));
vi.mock("@/lib/supabase-server", () => ({
  createAuthedClient: mocks.authed,
  getServiceRoleClient: () => ({ rpc: mocks.rpc, from(table: string) {
    const filters: Record<string, unknown> = {};
    const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      insert: (row: unknown) => { mocks.insert(row); return q; },
      single: async () => ({ data: { id: reportId }, error: null }),
      maybeSingle: async () => ({ data: table === "sessions" ? session : user, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: memberships.filter(row => filters.active === undefined || row.active === filters.active), error: null }).then(resolve),
    }; return q;
  } }),
}));
import { createWrittenReport, updateWrittenReport } from "@/lib/written-reports";
import { POST } from "@/app/api/written-reports/route";
import { PATCH } from "@/app/api/written-reports/[id]/route";

const reportId = "00000000-0000-4000-8000-000000000001";
const draft = { title: "Report", body: "A useful report", category: "other" as const, visibilityMinLevel: 3 };
let user: { id: string; role: string; active: boolean };
let memberships: { location_id: string; active: boolean }[];
let session: { id: string; user_id: string; revoked_at: string | null; expires_at: string };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  user = { id: "actor", role: "employee", active: true };
  memberships = [{ location_id: "shop", active: true }];
  session = { id: "session", user_id: "actor", revoked_at: null, expires_at: new Date(Date.now() + 60_000).toISOString() };
});
function request(method: string, extra: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/written-reports/${reportId}`, {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, ...extra }),
  });
}

describe("written report service writes", () => {
  it("ignores spoofed attribution and stale JWT roles on POST", async () => {
    const res = await POST(request("POST", { locationId: "shop", authorId: "victim", authorRole: "owner", submitted_by: "victim" }));
    expect(res.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ submitted_by: "actor", submitted_by_role: "employee", location_id: "shop" }));
    expect(mocks.authed).not.toHaveBeenCalled();
  });
  it.each(["level2", "foreign", "inactive", "inactive-membership", "revoked", "expired", "mismatch"])("POST refuses %s before insertion", async state => {
    if (state === "level2") user.role = "trainee";
    if (state === "inactive") user.active = false;
    if (state === "inactive-membership") memberships = [{ location_id: "shop", active: false }];
    if (state === "revoked") session.revoked_at = new Date().toISOString();
    if (state === "expired") session.expires_at = new Date(Date.now() - 1).toISOString();
    if (state === "mismatch") session.user_id = "victim";
    expect((await POST(request("POST", { locationId: state === "foreign" ? "stale-shop" : "shop" }))).status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("allows a null-location post and enforces membership inside the library too", async () => {
    expect((await POST(request("POST"))).status).toBe(200);
    await expect(createWrittenReport({ actor: checklistActor({ level: 9, role: "owner" }), locationId: "foreign", draft })).rejects.toThrow("not_authorized");
    await expect(createWrittenReport({ actor: checklistActor({ level: 2, role: "trainee" }), locationId: null, draft })).rejects.toThrow("not_authorized");
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });
  it("PATCH binds only the verified author and leaves clock/counter to SQL", async () => {
    expect((await PATCH(request("PATCH", { actor: "victim", submitted_by: "victim", edit_count: 90 }), { params: Promise.resolve({ id: reportId }) })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("written_report_update_self", {
      p_actor: "actor", p_id: reportId, p_title: draft.title, p_body: draft.body,
      p_category: draft.category, p_visibility_min_level: draft.visibilityMinLevel,
    });
    expect(mocks.authed).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("zero-row edit keeps the existing can't-edit outcome", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    const res = await PATCH(request("PATCH"), { params: Promise.resolve({ id: reportId }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "window_closed" });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([null, 2, [], "1"])("requires exact rowcount 1, rejects %j", async count => {
    mocks.rpc.mockResolvedValue({ data: count, error: null });
    await expect(updateWrittenReport({ actor: checklistActor(), id: reportId, draft })).rejects.toThrow("invalid rowcount");
  });
  it("delegates current self-edit visibility and location checks to SQL", async () => {
    await expect(updateWrittenReport({ actor: checklistActor({ level: 2, role: "trainee", locations: [] }), id: reportId, draft })).resolves.toEqual({ ok: true });
  });
});
