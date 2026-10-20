/**
 * Staff separations (Juan 2026-10-20; 0279) + GM user management (ADDENDUM) — the SERVER paths, through the real routes
 * and libs over an in-memory PostgREST fake. The SQL writer itself is proved by scripts/sql-harness-0279.mjs; the fake
 * RPC here only stores what the lib sends, so these tests prove what the LIB decides and what the API SENDS.
 *
 *  - Who sees the reason (server-side redaction, every viewer of the Users list and the rehire check).
 *  - GM user management: own shop only, strictly below GM, never a person who also works at a shop the GM is not in.
 *  - The employment route: Tier B, the head, the transitions, the rehire authority, an audit row with NO reason text.
 *  - Activate refuses on leave / separated (they come back through Back from leave / Rehire).
 *  - The rehire warning on Add user: by phone / Toast GUID only (never by name), 409 → confirm → the rehire authority.
 *  - Before 0279 is applied: the list works, the employment writes answer 503.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

const mocks = vi.hoisted(() => ({ session: vi.fn(), audit: vi.fn(), revoke: vi.fn(), client: null as unknown, rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }> }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.session, revokeAllUserSessions: mocks.revoke }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/portal/csrf", () => ({ assertSameOrigin: () => null }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: () => ({ ok: true }) }));

import { GET as listGet, POST as createPost } from "@/app/api/admin/users/route";
import { GET as detailGet } from "@/app/api/admin/users/[id]/route";
import { POST as employmentPost } from "@/app/api/admin/users/[id]/employment/route";
import { POST as activatePost } from "@/app/api/admin/users/[id]/activate/route";
import { POST as deactivatePost } from "@/app/api/admin/users/[id]/deactivate/route";
import { POST as resetPinPost } from "@/app/api/admin/users/[id]/reset-pin/route";
import { POST as rehireCheckPost } from "@/app/api/admin/users/rehire-check/route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = id(1), MOO = id(2), CGS = id(3), GM_A = id(4), GM_B = id(5), AGM_A = id(6), GM_A2 = id(7);
const EMP_A = id(10), EMP_AB = id(11), EMP_B = id(12), SEP_A = id(13), LEAVE_A = id(14), SEP_YES = id(15);
const SEP_EVENT = id(90), LEAVE_EVENT = id(91), SEP_YES_EVENT = id(92);
const REASON = "Took cash from the drawer twice";
const REHIRE_NOTE = "Never — owner decision";
const LEAVE_NOTE = "Fall semester at UMD";
const ROLE_OF: Record<string, string> = {
  [OWNER]: "owner", [MOO]: "moo", [CGS]: "cgs", [GM_A]: "gm", [GM_B]: "gm", [AGM_A]: "agm", [GM_A2]: "gm",
  [EMP_A]: "employee", [EMP_AB]: "employee", [EMP_B]: "employee", [SEP_A]: "employee", [LEAVE_A]: "employee", [SEP_YES]: "key_holder",
};
const SHOPS_OF: Record<string, string[]> = {
  [OWNER]: [], [MOO]: [A, B], [CGS]: [], [GM_A]: [A], [GM_B]: [B], [AGM_A]: [A], [GM_A2]: [A],
  [EMP_A]: [A], [EMP_AB]: [A, B], [EMP_B]: [B], [SEP_A]: [A], [LEAVE_A]: [A], [SEP_YES]: [A],
};

let tables: Tables;
let missing0279 = false;
function seed() {
  const user = (uid: string, name: string, extra: Record<string, unknown> = {}) => ({ id: uid, name, email: null, role: ROLE_OF[uid], active: true,
    last_login_at: null, phone: null, email_verified: false, created_at: "2025-01-01T00:00:00Z", created_by: null, locked_until: null, dormant_at: null, ...extra });
  tables = {
    users: [user(OWNER, "Pete"), user(MOO, "Cristian"), user(CGS, "Juan"), user(GM_A, "Alex"), user(GM_B, "John"), user(AGM_A, "Ava"), user(GM_A2, "Gia"),
      user(EMP_A, "Eli"), user(EMP_AB, "Bo"), user(EMP_B, "Cy"), user(SEP_A, "Miguel", { active: false, phone: "(202) 555-0101" }),
      user(LEAVE_A, "Danilo", { active: false }), user(SEP_YES, "Claudia", { active: false, phone: "202-555-0199" })],
    user_locations: Object.entries(SHOPS_OF).flatMap(([u, ls]) => ls.map((l) => ({ user_id: u, location_id: l, active: true }))),
    locations: [{ id: A, name: "Capitol Hill", code: "MEP", active: true }, { id: B, name: "P Street", code: "EM", active: true }],
    user_employment_events: [
      { id: SEP_EVENT, user_id: SEP_A, kind: "separated", corrects_id: null, leave_reason: null, expected_back: null, separation_type: "fired", last_day_worked: "2026-10-15",
        reason: REASON, rehire: "no", rehire_note: REHIRE_NOTE, note: null, actor_id: GM_A, created_at: "2026-10-16T12:00:00Z" },
      { id: LEAVE_EVENT, user_id: LEAVE_A, kind: "leave_start", corrects_id: null, leave_reason: "school", expected_back: "2027-01-05", separation_type: null, last_day_worked: null,
        reason: null, rehire: null, rehire_note: null, note: LEAVE_NOTE, actor_id: GM_A, created_at: "2026-10-16T12:00:00Z" },
      { id: SEP_YES_EVENT, user_id: SEP_YES, kind: "separated", corrects_id: null, leave_reason: null, expected_back: null, separation_type: "quit", last_day_worked: "2026-10-01",
        reason: "Moved away", rehire: "yes", rehire_note: null, note: null, actor_id: MOO, created_at: "2026-10-02T12:00:00Z" },
    ],
    toast_employee_links: [{ id: id(80), location_id: A, employee_guid: "toast-miguel", user_id: SEP_A, active: true }],
    sessions: [],
  };
}
let clock = 0;
function client() {
  const fake = createFakeDb(tables);
  const from = (t: string) => {
    if (missing0279 && t === "user_employment_events") {
      const err = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.user_employment_events' in the schema cache" } };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "order", "range", "limit"]) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(err).then(res);
      return q;
    }
    return fake.client.from(t);
  };
  const chain = (result: { data: unknown; error: unknown }) => {
    const q: Record<string, unknown> = {};
    for (const m of ["eq", "order", "range", "abortSignal"]) q[m] = () => q;
    q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return q;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    mocks.rpcCalls.push({ fn, args });
    if (fn === "record_user_employment_event") {
      if (missing0279) return chain({ data: null, error: { code: "PGRST202", message: "Could not find the function public.record_user_employment_event" } });
      const f = args.p_fields as Record<string, unknown>;
      const before = (tables.users!.find((u) => u.id === args.p_user)!.active as boolean) ? "active" : "x";
      const row = { id: id(200 + mocks.rpcCalls.length), user_id: args.p_user, kind: args.p_kind, corrects_id: f.correctsId ?? null, leave_reason: f.leaveReason ?? null,
        expected_back: f.expectedBack ?? null, separation_type: f.separationType ?? null, last_day_worked: f.lastDayWorked ?? null, reason: f.reason ?? null,
        rehire: f.rehire ?? null, rehire_note: f.rehireNote ?? null, note: f.note ?? null, actor_id: args.p_actor, created_at: `2026-10-20T13:00:${String(++clock).padStart(2, "0")}Z` };
      tables.user_employment_events!.push(row);
      const after = args.p_kind === "leave_start" ? "on_leave" : args.p_kind === "separated" ? "separated" : "active";
      tables.users!.find((u) => u.id === args.p_user)!.active = after === "active";
      return chain({ data: { id: row.id, kind: args.p_kind, status_before: before, status_after: after, sessions_revoked: 0 }, error: null });
    }
    if (fn === "link_toast_employee") return chain({ data: { id: id(300), changed: true, backfilled: 0 }, error: null });
    if (fn.startsWith("admin_user_")) {
      if (missing0279) return chain({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn}` } });
      // The locked writer's refusal is proved in PGlite; here it stores what the lib sends.
      const u = tables.users!.find((x) => x.id === args.p_user)!;
      if (fn === "admin_user_set_active") u.active = args.p_active;
      if (fn === "admin_user_set_credential") u[args.p_kind === "pin" ? "pin_hash" : "password_hash"] = args.p_hash;
      if (fn === "admin_user_set_role") u.role = args.p_role;
      return chain({ data: { changed: true, sessions_revoked: 0 }, error: null });
    }
    return chain({ data: [], error: null }); // admin_last_clock_ins and other reads
  };
  return { from, rpc };
}
const ctxOf = (uid: string) => ({ user: { id: uid, role: ROLE_OF[uid], language: "en" }, role: ROLE_OF[uid], level: 0, locations: SHOPS_OF[uid] });
const as = (uid: string) => mocks.session.mockResolvedValue(ctxOf(uid));
const req = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, body === undefined ? { method: "GET" }
  : { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
const params = (uid: string) => ({ params: Promise.resolve({ id: uid }) });
async function json(r: Response) { const body = await r.json() as Record<string, unknown>; return { status: r.status, body, text: JSON.stringify(body) }; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpcCalls = [];
  missing0279 = false;
  seed();
  mocks.client = client();
  mocks.revoke.mockResolvedValue({ count: 0 });
});

describe("who sees the reason — server-side, every viewer of the Users list", () => {
  it.each([[OWNER, true], [MOO, true], [CGS, true], [GM_A, true]] as const)("viewer %s: reason sent = %s", async (viewer, sees) => {
    as(viewer);
    const r = await listGet(req("/api/admin/users"));
    const text = JSON.stringify(await r.json());
    expect(r.status).toBe(200);
    expect(text.includes(REASON)).toBe(sees);
    expect(text.includes(REHIRE_NOTE)).toBe(sees);
    expect(text.includes(LEAVE_NOTE)).toBe(sees);
  });
  it("another shop's GM gets neither the people nor the reasons (scoped list)", async () => {
    as(GM_B);
    const body = await (await listGet(req("/api/admin/users"))).json() as { users: Array<{ id: string }> };
    const ids = body.users.map((u) => u.id);
    expect(ids).toContain(EMP_B);
    expect(ids).toContain(EMP_AB);
    expect(ids).not.toContain(SEP_A);
    expect(JSON.stringify(body)).not.toContain(REASON);
  });
  it("the chip rides for everyone who sees the person: status and rehire setting, never the text", async () => {
    as(GM_A);
    const body = await (await listGet(req("/api/admin/users"))).json() as { users: Array<{ id: string; employment?: { chip: unknown; status: string } }> };
    expect(body.users.find((u) => u.id === SEP_A)?.employment).toMatchObject({ status: "separated", chip: { status: "separated", rehire: "no" } });
    expect(body.users.find((u) => u.id === LEAVE_A)?.employment).toMatchObject({ status: "on_leave", chip: { status: "on_leave", until: "2027-01-05" } });
    expect(body.users.find((u) => u.id === EMP_A)?.employment).toMatchObject({ status: "active", chip: null, detail: null });
  });
  it("below GM the Users API is closed", async () => {
    as(AGM_A);
    expect((await listGet(req("/api/admin/users"))).status).toBe(403);
  });
});

describe("GM user management: own shop, strictly below GM", () => {
  it("the GM's list is their shop's people; a detail outside the shop is a 404", async () => {
    as(GM_A);
    const ids = ((await (await listGet(req("/api/admin/users"))).json()) as { users: Array<{ id: string }> }).users.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([EMP_A, EMP_AB, SEP_A, LEAVE_A, GM_A, AGM_A]));
    expect(ids).not.toContain(EMP_B);
    expect(ids).not.toContain(OWNER);
    expect((await detailGet(req(`/api/admin/users/${EMP_B}`), params(EMP_B))).status).toBe(404);
    expect((await detailGet(req(`/api/admin/users/${EMP_A}`), params(EMP_A))).status).toBe(200);
  });
  it("acts on their own shop's staff; refused on a two-shop person, on another GM and on themselves", async () => {
    as(GM_A);
    expect((await resetPinPost(req(`/api/admin/users/${EMP_A}/reset-pin`, { pin: "1234" }), params(EMP_A))).status).toBe(200);
    const two = await json(await deactivatePost(req(`/api/admin/users/${EMP_AB}/deactivate`, {}), params(EMP_AB)));
    expect(two).toMatchObject({ status: 403, body: { code: "target_outside_shop" } });
    expect((await json(await deactivatePost(req(`/api/admin/users/${GM_A2}/deactivate`, {}), params(GM_A2)))).body.code).toBe("forbidden");
    expect((await json(await deactivatePost(req(`/api/admin/users/${GM_A}/deactivate`, {}), params(GM_A)))).body.code).toBe("forbidden");
    expect((await json(await deactivatePost(req(`/api/admin/users/${EMP_B}/deactivate`, {}), params(EMP_B)))).body.code).toBe("target_outside_shop");
  });
  it("creates only below GM and only at their own shops", async () => {
    as(GM_A);
    const base = { name: "New Person", tempPin: "1234", email: null, tempPassword: null };
    expect((await json(await createPost(req("/api/admin/users", { ...base, role: "gm", locationIds: [A] })))).body.code).toBe("forbidden");
    expect((await json(await createPost(req("/api/admin/users", { ...base, role: "employee", locationIds: [B] })))).body.code).toBe("forbidden");
    const ok = await json(await createPost(req("/api/admin/users", { ...base, role: "employee", locationIds: [A] })));
    expect(ok.status).toBe(201);
  });
  it("MoO+ is unchanged: any shop, a two-shop person included", async () => {
    as(MOO);
    expect((await deactivatePost(req(`/api/admin/users/${EMP_AB}/deactivate`, {}), params(EMP_AB))).status).toBe(200);
  });
});

describe("the employment route (Tier B, the head, the transitions, the rehire authority)", () => {
  const post = (uid: string, body: unknown) => employmentPost(req(`/api/admin/users/${uid}/employment`, body), params(uid));
  it("a GM puts their shop's employee on leave: the writer gets the lib's exact arguments; the audit row carries no text", async () => {
    as(GM_A);
    const r = await json(await post(EMP_A, { act: "leave_start", fields: { leaveReason: "school", expectedBack: "2027-01-05", note: "Back after finals" }, expectedId: null }));
    expect(r.status).toBe(200);
    expect(mocks.rpcCalls.find((c) => c.fn === "record_user_employment_event")?.args).toEqual({ p_actor: GM_A, p_user: EMP_A, p_expected: null, p_kind: "leave_start",
      p_fields: { leaveReason: "school", expectedBack: "2027-01-05", note: "Back after finals" } });
    const auditRow = mocks.audit.mock.calls[0]![0] as { action: string; metadata: Record<string, unknown> };
    expect(auditRow.action).toBe("user.leave_start");
    expect(JSON.stringify(auditRow)).not.toContain("Back after finals");
  });
  it("a separation's reason never reaches the audit row", async () => {
    as(GM_A);
    const r = await json(await post(EMP_A, { act: "separated", fields: { separationType: "no_call_no_show", lastDayWorked: "2026-10-18", reason: "Three no-shows in a week", rehire: "only_with_owner_ok", rehireNote: "Ask Pete" }, expectedId: null }));
    expect(r.status).toBe(200);
    const auditRow = JSON.stringify(mocks.audit.mock.calls[0]![0]);
    expect(auditRow).not.toContain("Three no-shows");
    expect(auditRow).not.toContain("Ask Pete");
    expect(auditRow).toContain("user.separate");
  });
  it("a stale head is employment_moved; a wrong transition is refused; nothing reaches the writer", async () => {
    as(GM_A);
    expect((await json(await post(LEAVE_A, { act: "leave_end", fields: {}, expectedId: null }))).body.code).toBe("employment_moved");
    expect((await json(await post(EMP_A, { act: "leave_end", fields: {}, expectedId: null }))).body.code).toBe("employment_invalid_transition");
    expect(mocks.rpcCalls.filter((c) => c.fn === "record_user_employment_event")).toEqual([]);
    expect((await post(LEAVE_A, { act: "leave_end", fields: {}, expectedId: LEAVE_EVENT })).status).toBe(200);
  });
  it("the rehire authority: `no` → owner only; `yes` → the GM; a reason when not `yes`", async () => {
    as(GM_A);
    expect((await json(await post(SEP_A, { act: "rehired", fields: { note: "x" }, expectedId: SEP_EVENT }))).body.code).toBe("rehire_owner_required");
    as(MOO);
    expect((await json(await post(SEP_A, { act: "rehired", fields: { note: "x" }, expectedId: SEP_EVENT }))).body.code).toBe("rehire_owner_required");
    as(CGS);
    expect((await json(await post(SEP_A, { act: "rehired", fields: { note: "x" }, expectedId: SEP_EVENT }))).body.code).toBe("rehire_owner_required");
    as(OWNER);
    expect((await json(await post(SEP_A, { act: "rehired", fields: {}, expectedId: SEP_EVENT }))).body.code).toBe("rehire_reason_required");
    expect(mocks.rpcCalls.filter((c) => c.fn === "record_user_employment_event")).toEqual([]);
    expect((await post(SEP_A, { act: "rehired", fields: { note: "Pete approved" }, expectedId: SEP_EVENT })).status).toBe(200);
    as(GM_A);
    expect((await post(SEP_YES, { act: "rehired", fields: {}, expectedId: SEP_YES_EVENT })).status).toBe(200);
  });
  it("a GM may not loosen `no` by a correction; may tighten / fix the text of their shop's record", async () => {
    as(GM_A);
    const sep = { separationType: "fired", lastDayWorked: "2026-10-15", reason: REASON };
    expect((await json(await post(SEP_A, { act: "correction", fields: { correctsId: SEP_EVENT, ...sep, rehire: "yes" }, expectedId: SEP_EVENT }))).body.code).toBe("rehire_owner_required");
    expect((await post(SEP_A, { act: "correction", fields: { correctsId: SEP_EVENT, ...sep, reason: "Fixed typo", rehire: "no", rehireNote: REHIRE_NOTE }, expectedId: SEP_EVENT })).status).toBe(200);
  });
  it("a payload with an unknown key or a missing reason is invalid before any write", async () => {
    as(GM_A);
    expect((await json(await post(EMP_A, { act: "separated", fields: { separationType: "quit", lastDayWorked: "2026-10-18", rehire: "yes" }, expectedId: null }))).body.code).toBe("invalid_payload");
    expect((await json(await post(EMP_A, { act: "leave_start", fields: { leaveReason: "school", why: "x" }, expectedId: null }))).body.code).toBe("invalid_payload");
    expect((await json(await post(EMP_A, { act: "fire", fields: {}, expectedId: null }))).body.code).toBe("invalid_payload");
  });
  it("Activate is refused for on leave / separated (Back from leave / Rehire), allowed for a plain deactivation", async () => {
    as(GM_A);
    expect((await json(await activatePost(req(`/api/admin/users/${LEAVE_A}/activate`, {}), params(LEAVE_A)))).body.code).toBe("use_back_from_leave");
    expect((await json(await activatePost(req(`/api/admin/users/${SEP_A}/activate`, {}), params(SEP_A)))).body.code).toBe("use_rehire");
    tables.users!.find((u) => u.id === EMP_A)!.active = false;
    expect((await activatePost(req(`/api/admin/users/${EMP_A}/activate`, {}), params(EMP_A))).status).toBe(200);
  });
  it("before 0279 is applied: the list works; every write refuses by name (no fallback — 0279 reaches prod first)", async () => {
    missing0279 = true;
    as(GM_A);
    const list = await listGet(req("/api/admin/users"));
    expect(list.status).toBe(200);
    expect((await json(await post(EMP_A, { act: "leave_start", fields: { leaveReason: "school" }, expectedId: null }))).body.code).toBe("employment_unavailable");
    const act = await json(await activatePost(req(`/api/admin/users/${LEAVE_A}/activate`, {}), params(LEAVE_A)));
    expect(act).toMatchObject({ status: 503, body: { code: "user_admin_unavailable" } });
    expect((await json(await resetPinPost(req(`/api/admin/users/${EMP_A}/reset-pin`, { pin: "1234" }), params(EMP_A)))).body.code).toBe("user_admin_unavailable");
  });
  it("every user-admin write goes through the locked 0279 writer with the lib's exact arguments (the hash, never the PIN)", async () => {
    as(GM_A);
    await resetPinPost(req(`/api/admin/users/${EMP_A}/reset-pin`, { pin: "4321" }), params(EMP_A));
    await deactivatePost(req(`/api/admin/users/${EMP_A}/deactivate`, {}), params(EMP_A));
    const fns = mocks.rpcCalls.filter((c) => c.fn.startsWith("admin_user_"));
    expect(fns.map((c) => c.fn)).toEqual(["admin_user_set_credential", "admin_user_set_active"]);
    expect(fns[0]!.args).toMatchObject({ p_actor: GM_A, p_user: EMP_A, p_kind: "pin" });
    expect(String(fns[0]!.args.p_hash)).not.toContain("4321");
    expect(String(fns[0]!.args.p_hash).length).toBeGreaterThan(20);
    expect(fns[1]!.args).toEqual({ p_actor: GM_A, p_user: EMP_A, p_active: false });
  });
});

describe("the rehire warning on Add user — phone or Toast GUID, never a name", () => {
  const check = (body: unknown) => rehireCheckPost(req("/api/admin/users/rehire-check", body));
  it("matches by the normalized phone; the reason only for who may read it", async () => {
    as(OWNER);
    const own = await (await check({ phone: "+1 202 555 0101" })).json() as { matches: Array<{ userId: string; by: string[]; view: { detail: unknown }; mayProceed: boolean }> };
    expect(own.matches.map((m) => m.userId)).toEqual([SEP_A]);
    expect(own.matches[0]).toMatchObject({ by: ["phone"], mayProceed: true });
    expect(JSON.stringify(own)).toContain(REASON);
    as(GM_B);
    const other = await (await check({ phone: "202.555.0101" })).json() as { matches: Array<{ view: { detail: unknown; chip: unknown }; mayProceed: boolean }> };
    expect(other.matches[0]!.view).toMatchObject({ detail: null, chip: { status: "separated", rehire: "no" } });
    expect(other.matches[0]!.mayProceed).toBe(false);
    expect(JSON.stringify(other)).not.toContain(REASON);
    expect(JSON.stringify(other)).not.toContain(REHIRE_NOTE);
  });
  it("matches by the Toast employee GUID of any of their links", async () => {
    as(GM_A);
    const r = await (await check({ toastGuid: "toast-miguel" })).json() as { matches: Array<{ userId: string; by: string[] }> };
    expect(r.matches).toEqual([expect.objectContaining({ userId: SEP_A, by: ["toast"] })]);
  });
  it("never by name; rehire OK people never warn", async () => {
    as(OWNER);
    expect(((await (await check({ phone: "202-555-0199" })).json()) as { matches: unknown[] }).matches).toEqual([]);
    as(GM_A);
    const created = await json(await createPost(req("/api/admin/users", { name: "Miguel", role: "employee", tempPin: "1234", email: null, tempPassword: null, locationIds: [A] })));
    expect(created.status).toBe(201);
  });
  it("create: 409 with the redacted matches → confirm without the authority 403 → the owner confirms", async () => {
    const body = { name: "M. Lopez", role: "employee", tempPin: "1234", email: null, tempPassword: null, locationIds: [A], phone: "2025550101" };
    as(GM_B);
    const first = await json(await createPost(req("/api/admin/users", { ...body, locationIds: [B] })));
    expect(first.status).toBe(409);
    expect(first.body.code).toBe("rehire_match");
    expect(JSON.stringify(first.body)).not.toContain(REASON);
    const second = await json(await createPost(req("/api/admin/users", { ...body, locationIds: [B], confirmRehire: true })));
    expect(second).toMatchObject({ status: 403, body: { code: "rehire_permission_required" } });
    as(OWNER);
    const third = await json(await createPost(req("/api/admin/users", { ...body, confirmRehire: true })));
    expect(third.status).toBe(201);
    const auditRow = mocks.audit.mock.calls.find((c) => (c[0] as { action: string }).action === "user.create")![0] as { metadata: Record<string, unknown> };
    expect(auditRow.metadata.rehire_match_override).toEqual([SEP_A]);
    expect(tables.users!.find((u) => u.name === "M. Lopez")?.phone).toBe("2025550101");
  });
});
