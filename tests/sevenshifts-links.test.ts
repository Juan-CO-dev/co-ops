/**
 * Scheduling Phase 1, Task 10 — the 7shifts links: the pure candidate lists (R4: employee id + name +
 * roles, NO suggestion, NO pre-selection, NO match score), the run summaries, and the lib over the 0269
 * RPCs (access-shared before any I/O, P0001 codes mapped, audited with ids only, dormant without the
 * token or the switch). The database is the in-memory PostgREST fake plus a scripted rpc.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeDb } from "./fixtures/counts-fake-db";
import type { PeopleActor } from "@/lib/people/access-shared";
import {
  displayName, linkCandidates, linkedPeople, screenStateFor, summarizeRuns, SYNC_PARTS,
  type RemoteUser, type UserLink,
} from "@/lib/sevenshifts/links-shared";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("tests inject the db"); } }));

const { audit } = await import("@/lib/audit");
const { linkShop, linkUser, loadLinkScreen, SevenShiftsLinkError, unlinkShop, unlinkUser } = await import("@/lib/sevenshifts/links");

const SHOP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const READY = { SEVENSHIFTS_ACCESS_TOKEN: "PLANTED-TOKEN-links", SEVENSHIFTS_SYNC: "1" };

const remote = (id: string, first: string | null, last: string | null, extra: Partial<RemoteUser> = {}): RemoteUser =>
  ({ id, firstName: first, lastName: last, preferredFirstName: null, employeeId: null, active: true, ...extra });

describe("displayName — preferred first name ‖ first name, plus the last INITIAL only", () => {
  it("never carries the full last name", () => {
    expect(displayName(remote("1", "Ana", "Rivera"))).toBe("Ana R.");
    expect(displayName(remote("1", "Ana", "rivera", { preferredFirstName: "Anita" }))).toBe("Anita R.");
    expect(displayName(remote("1", "Ana", null))).toBe("Ana");
    expect(displayName(remote("1", "  Ana ", "  ríos"))).toBe("Ana R.");
    expect(displayName(remote("1", null, null))).toBe("");
  });
});

describe("linkCandidates (R4) — two lists, sorted, and NOTHING pairs them", () => {
  const users = [
    remote("501", "Ana", "Rivera", { employeeId: "10482" }),
    remote("502", "Bo", "Diaz", { employeeId: "10490" }),
    remote("503", "Cy", "Lee", { employeeId: "10491" }),
    remote("504", "Al", "Moss", { active: false }),
    remote("505", "Di", "Fox"),
  ];
  const edges = [
    { userId: "501", locationId: "4569", roleId: "11" }, { userId: "501", locationId: "4569", roleId: "12" },
    { userId: "502", locationId: "4569", roleId: null }, { userId: "503", locationId: "4570", roleId: "13" },
    { userId: "504", locationId: "4569", roleId: "11" }, { userId: "505", locationId: "4569", roleId: "11" },
  ];
  const roles = [{ id: "11", name: "Prep" }, { id: "12", name: "Line" }, { id: "13", name: "Host" }];
  const members = [{ id: U(3), name: "Zed Young" }, { id: U(1), name: "Ana Rivera" }, { id: U(2), name: "Bo Diaz" }];
  const links: UserLink[] = [{ id: "L1", sevenShiftsUserId: "505", userId: U(2), linkedAtLocationId: SHOP_A }];

  it("waiting = active, unlinked 7shifts people at the linked 7shifts location, with employee id and live role names", () => {
    const out = linkCandidates({ remoteLocationId: "4569", users, edges, roles, members, links });
    expect(out.waiting).toEqual([
      { remoteUserId: "501", displayName: "Ana R.", employeeId: "10482", roles: ["Line", "Prep"] },
      { remoteUserId: "502", displayName: "Bo D.", employeeId: "10490", roles: [] },
    ]);
  });

  it("members = the CO-OPS members of the shop with no live link, sorted by name", () => {
    const out = linkCandidates({ remoteLocationId: "4569", users, edges, roles, members, links });
    expect(out.members).toEqual([{ id: U(1), name: "Ana Rivera" }, { id: U(3), name: "Zed Young" }]);
  });

  it("identical names AND an employee id equal to a CO-OPS field produce NO pairing: no suggestion, no score, no pre-selection", () => {
    const twinUsers = [remote("601", "Ana", "Rivera", { employeeId: U(1) })];
    const out = linkCandidates({
      remoteLocationId: "4569", users: twinUsers, edges: [{ userId: "601", locationId: "4569", roleId: null }],
      roles: [], members: [{ id: U(1), name: "Ana R." }], links: [],
    });
    expect(Object.keys(out).sort()).toEqual(["members", "waiting"]);
    expect(Object.keys(out.waiting[0]!).sort()).toEqual(["displayName", "employeeId", "remoteUserId", "roles"]);
    expect(Object.keys(out.members[0]!).sort()).toEqual(["id", "name"]);
    expect(JSON.stringify(out)).not.toMatch(/suggest|score|match|selected|pair/i);
  });

  it("no linked 7shifts location → nobody is waiting (members still listed)", () => {
    const out = linkCandidates({ remoteLocationId: null, users, edges, roles, members, links });
    expect(out.waiting).toEqual([]);
    expect(out.members).toHaveLength(2);
  });

  it("the module never compares names (source scan)", () => {
    const src = readFileSync("lib/sevenshifts/links-shared.ts", "utf8");
    expect(src).not.toMatch(/name\s*===|===\s*\w*\.?name\b|localeCompare\([^)]*\)\s*===\s*0|levenshtein|similar/i);
  });
});

describe("linkedPeople — the shop's live links, never a full last name", () => {
  it("links made here plus links of people working at the linked 7shifts location; linkedHere marks which", () => {
    const users = [remote("501", "Ana", "Rivera", { employeeId: "10482" }), remote("503", "Cy", "Lee")];
    const links: UserLink[] = [
      { id: "L1", sevenShiftsUserId: "501", userId: U(1), linkedAtLocationId: SHOP_A },
      { id: "L2", sevenShiftsUserId: "503", userId: U(3), linkedAtLocationId: SHOP_B },
      { id: "L3", sevenShiftsUserId: "999", userId: U(9), linkedAtLocationId: SHOP_B },
    ];
    const out = linkedPeople({
      locationId: SHOP_A, remoteLocationId: "4569", users, edges: [{ userId: "503", locationId: "4569", roleId: null }],
      links, names: new Map([[U(1), "Ana Rivera"], [U(3), "Cy Lee"]]),
    });
    expect(out).toEqual([
      { linkId: "L1", remoteUserId: "501", displayName: "Ana R.", employeeId: "10482", userId: U(1), userName: "Ana Rivera", linkedHere: true },
      { linkId: "L2", remoteUserId: "503", displayName: "Cy L.", employeeId: null, userId: U(3), userName: "Cy Lee", linkedHere: false },
    ]);
  });
});

describe("summarizeRuns + screenStateFor — the status line from the ledger (counts and codes only)", () => {
  const ok = Object.fromEntries(SYNC_PARTS.map((p) => [p, { rows: 1, skipped: 0, pages: 1, error_code: null }]));
  const NOW = Date.parse("2026-10-15T18:00:00Z");
  it("has the 11 synced parts, exactly the sync run's order", async () => {
    expect([...SYNC_PARTS]).toEqual([...(await import("@/lib/sevenshifts/sync")).SYNC_ORDER]);
    expect([...SYNC_PARTS].sort()).toEqual(["assignments", "availabilities", "departments", "labor_settings", "locations",
      "roles", "shifts", "time_off", "time_punches", "users", "wages"]);
  });
  it("newest first, at most 5; ok parts counted; plan-forbidden parts named; a run id with no ledger row is interrupted (or running when fresh)", () => {
    const ids = [
      { id: "r1", started_at: "2026-10-15T14:20:00Z", trigger: "cron" },
      { id: "r2", started_at: "2026-10-15T15:20:00Z", trigger: "cron" },
      { id: "r3", started_at: "2026-10-15T16:20:00Z", trigger: "manual" },
      { id: "r4", started_at: "2026-10-15T17:58:00Z", trigger: "cron" },
    ];
    const ledger = [
      { id: "r1", trigger: "cron", started_at: "2026-10-15T14:20:00Z", finished_at: "2026-10-15T14:21:00Z", status: "ok", requests: 15, results: ok },
      { id: "r2", trigger: "cron", started_at: "2026-10-15T15:20:00Z", finished_at: "2026-10-15T15:21:00Z", status: "partial", requests: 15,
        results: { ...ok, time_off: { rows: 0, skipped: 0, pages: 0, error_code: "plan_forbidden" } } },
    ];
    const out = summarizeRuns(ids, ledger, NOW);
    expect(out.map((r) => [r.id, r.state])).toEqual([["r4", "running"], ["r3", "interrupted"], ["r2", "partial"], ["r1", "ok"]]);
    expect(out[2]).toMatchObject({ okParts: 10, totalParts: 11, planForbidden: ["time_off"], trigger: "cron", finishedAt: "2026-10-15T15:21:00Z" });
    expect(out[0]).toMatchObject({ okParts: 0, finishedAt: null });
    expect(summarizeRuns(Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, started_at: `2026-10-15T0${i}:00:00Z`, trigger: "cron" })), [], NOW)).toHaveLength(5);
  });
  it("state: not_connected / sync_off from the env; not_supported when the latest finished run hit multi_company; else ready", () => {
    const multi = summarizeRuns([{ id: "m", started_at: "2026-10-15T17:00:00Z", trigger: "cron" }],
      [{ id: "m", trigger: "cron", started_at: "2026-10-15T17:00:00Z", finished_at: "2026-10-15T17:00:01Z", status: "failed", requests: 1,
        results: { whoami: { rows: 0, skipped: 0, pages: 1, error_code: "multi_company" } } }], NOW);
    expect(screenStateFor({ state: "not_connected", reason: "token_missing" }, null)).toBe("not_connected");
    expect(screenStateFor({ state: "sync_off", reason: "sync_off" }, null)).toBe("sync_off");
    expect(screenStateFor({ state: "ready", reason: null }, multi)).toBe("not_supported");
    expect(screenStateFor({ state: "ready", reason: null }, [])).toBe("ready");
    expect(multi[0]).toMatchObject({ multiCompany: true, state: "failed" });
  });
});

// ─── the lib ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const moo: PeopleActor = { userId: U(80), role: "moo", level: 8, locations: [] };
const gmA: PeopleActor = { userId: U(70), role: "gm", level: 7, locations: [SHOP_A] };
const agmA: PeopleActor = { userId: U(60), role: "agm", level: 6, locations: [SHOP_A] };
const smm: PeopleActor = { userId: U(61), role: "social_media_mgr", level: 9, locations: [SHOP_A] };

function world(opts: { rpc?: (fn: string, args: Row) => { data?: unknown; error?: { message: string; code?: string } | null } } = {}) {
  const tables: Record<string, Row[]> = {
    locations: [{ id: SHOP_A, name: "Shop A", active: true }, { id: SHOP_B, name: "Shop B", active: true }],
    users: [
      { id: U(1), name: "Ana Rivera", role: "employee", active: true }, { id: U(2), name: "Bo Diaz", role: "employee", active: true },
      { id: U(70), name: "Gee Em", role: "gm", active: true }, { id: U(80), name: "Mo O", role: "moo", active: true },
      { id: U(5), name: "Bee Shop", role: "employee", active: true }, { id: U(9), name: "Own Er", role: "owner", active: true },
    ],
    user_locations: [
      { user_id: U(1), location_id: SHOP_A, active: true }, { user_id: U(2), location_id: SHOP_A, active: true },
      { user_id: U(70), location_id: SHOP_A, active: true }, { user_id: U(80), location_id: SHOP_A, active: true },
      { user_id: U(5), location_id: SHOP_B, active: true },
    ],
    sevenshifts_sync_run_ids: [{ id: "r1", started_at: "2026-10-15T17:20:00Z", trigger: "cron" }],
    sevenshifts_sync_runs: [{ id: "r1", trigger: "cron", started_at: "2026-10-15T17:20:00Z", finished_at: "2026-10-15T17:21:00Z", status: "ok", requests: 15,
      results: Object.fromEntries(SYNC_PARTS.map((p) => [p, { rows: 1, skipped: 0, pages: 1, error_code: null }])) }],
    // 7shifts ids as PostgREST filters see them (the lib String()s whatever comes back). The 7shifts LAST
    // names are deliberately unlike the CO-OPS names, so a leak of the full last name is detectable.
    sevenshifts_location_links: [{ id: "SL1", location_id: SHOP_A, sevenshifts_location_id: "4569", active: true }],
    sevenshifts_locations: [{ id: "4569", name: "P", active: true }, { id: "4570", name: "C", active: true }],
    sevenshifts_users: [
      { id: "501", first_name: "Ana", last_name: "Rivq", preferred_first_name: null, employee_id: "10482", active: true },
      { id: "502", first_name: "Bo", last_name: "Dizq", preferred_first_name: null, employee_id: null, active: true },
    ],
    sevenshifts_user_assignments: [
      { user_id: "501", location_id: "4569", role_id: "11", active: true }, { user_id: "502", location_id: "4569", role_id: null, active: true },
    ],
    sevenshifts_roles: [{ id: "11", location_id: "4569", name: "Prep" }],
    sevenshifts_user_links: [],
    sevenshifts_wages: [
      { user_id: "501", wage_cents: 1999, wage_type: "hourly", active: true }, { user_id: "501", wage_cents: 2100, wage_type: "hourly", active: true },
      { user_id: "777", wage_cents: 5000, wage_type: "hourly", active: true },
    ],
  };
  const fake = createFakeDb(tables);
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const rpc = vi.fn(async (fn: string, args: Row) => {
    rpcCalls.push({ fn, args });
    const r = opts.rpc?.(fn, args) ?? { data: { id: "NEW", changed: true }, error: null };
    return { data: r.data ?? null, error: r.error ?? null };
  });
  const from = vi.fn(fake.client.from);
  const db = { from, rpc } as unknown as SupabaseClient;
  return { tables, db, rpc, from, rpcCalls };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("the link writers — access before any I/O, dormancy, P0001 codes, audit with ids only", () => {
  it("linkShop: MoO+ only, refused BEFORE any I/O (GM, AGM, a level-forged SMM)", async () => {
    for (const actor of [gmA, agmA, smm]) {
      const w = world();
      await expect(linkShop(w.db, { actor, locationId: SHOP_A, remoteLocationId: "4569" }, READY)).rejects.toMatchObject({ status: 403, code: "forbidden" });
      expect(w.rpc).not.toHaveBeenCalled();
      expect(w.from).not.toHaveBeenCalled();
    }
  });

  it("every writer is dormant without the token or the switch (409, no I/O) — the 0269 tables may not exist yet", async () => {
    for (const env of [{ SEVENSHIFTS_SYNC: "1" }, { SEVENSHIFTS_ACCESS_TOKEN: "t" }]) {
      const w = world();
      const code = "SEVENSHIFTS_ACCESS_TOKEN" in env ? "sync_off" : "not_connected";
      await expect(linkShop(w.db, { actor: moo, locationId: SHOP_A, remoteLocationId: "4569" }, env)).rejects.toMatchObject({ status: 409, code });
      await expect(unlinkShop(w.db, { actor: moo, linkId: U(99) }, env)).rejects.toMatchObject({ status: 409, code });
      await expect(linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "501", userId: U(1) }, env)).rejects.toMatchObject({ status: 409, code });
      await expect(unlinkUser(w.db, { actor: gmA, locationId: SHOP_A, linkId: U(99) }, env)).rejects.toMatchObject({ status: 409, code });
      expect(w.rpc).not.toHaveBeenCalled();
      expect(w.from).not.toHaveBeenCalled();
    }
  });

  it("linkShop validates ids, calls the RPC with the actor, audits sevenshifts_location_link.create (ids only)", async () => {
    const w = world({ rpc: () => ({ data: { id: "SL9", changed: true, location_id: SHOP_B, sevenshifts_location_id: 4570 } }) });
    await expect(linkShop(w.db, { actor: moo, locationId: "nope", remoteLocationId: "4570" }, READY)).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    await expect(linkShop(w.db, { actor: moo, locationId: SHOP_B, remoteLocationId: "0" }, READY)).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(await linkShop(w.db, { actor: moo, locationId: SHOP_B, remoteLocationId: "4570" }, READY)).toEqual({ id: "SL9", changed: true });
    expect(w.rpcCalls).toEqual([{ fn: "link_sevenshifts_location", args: { p_actor: moo.userId, p_location: SHOP_B, p_remote: "4570" } }]);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      actorId: moo.userId, actorRole: "moo", action: "sevenshifts_location_link.create", resourceTable: "sevenshifts_location_links", resourceId: "SL9",
      metadata: { location_id: SHOP_B, sevenshifts_location_id: "4570" },
    }));
  });

  it("an unchanged link (same pair) writes no audit row", async () => {
    const w = world({ rpc: () => ({ data: { id: "SL1", changed: false } }) });
    await linkShop(w.db, { actor: moo, locationId: SHOP_A, remoteLocationId: "4569" }, READY);
    expect(audit).not.toHaveBeenCalled();
  });

  it.each([
    ["shop_already_linked", 409], ["remote_already_linked", 409], ["user_already_linked", 409], ["link_not_found", 404],
    ["remote_unknown", 404], ["remote_not_at_shop", 403], ["role_insufficient", 403], ["location_access_denied", 403],
    ["assignee_unavailable", 409], ["invalid_payload", 400],
  ] as const)("the RPC refusal %s maps to %i with the same code", async (code, status) => {
    const w = world({ rpc: () => ({ error: { message: code, code: "P0001" } }) });
    const err = await linkUser(w.db, { actor: moo, locationId: SHOP_A, remoteUserId: "501", userId: U(1) }, READY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SevenShiftsLinkError);
    expect(err).toMatchObject({ status, code });
    expect(audit).not.toHaveBeenCalled();
  });

  it("an unknown database error is a 500 with a fixed code, never the provider text", async () => {
    const w = world({ rpc: () => ({ error: { message: "connection reset by peer at 10.0.0.1", code: "08006" } }) });
    const err = await unlinkShop(w.db, { actor: moo, linkId: U(99) }, READY).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 500, code: "link_failed" });
    expect(String((err as Error).message)).not.toContain("10.0.0.1");
  });

  it("linkUser: GM own shop; refused before any I/O at another shop, for an AGM and for the SMM", async () => {
    for (const [actor, loc] of [[gmA, SHOP_B], [agmA, SHOP_A], [smm, SHOP_A]] as const) {
      const w = world();
      await expect(linkUser(w.db, { actor, locationId: loc, remoteUserId: "501", userId: U(1) }, READY)).rejects.toMatchObject({ status: 403, code: "forbidden" });
      expect(w.rpc).not.toHaveBeenCalled();
      expect(w.from).not.toHaveBeenCalled();
    }
  });

  it("linkUser judges the SUBJECT with canLinkSevenShiftsUser (a GM cannot link a MoO, nor a non-member)", async () => {
    const w = world();
    await expect(linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "501", userId: U(80) }, READY)).rejects.toMatchObject({ status: 403, code: "role_insufficient" });
    await expect(linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "501", userId: U(5) }, READY)).rejects.toMatchObject({ status: 403, code: "location_access_denied" });
    expect(w.rpc).not.toHaveBeenCalled();
  });

  it("linkUser: the RPC, then sevenshifts_user_link.create with ids only (no name)", async () => {
    const w = world({ rpc: () => ({ data: { id: "UL1", changed: true, sevenshifts_user_id: 501, user_id: U(1) } }) });
    expect(await linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "501", userId: U(1) }, READY)).toEqual({ id: "UL1", changed: true });
    expect(w.rpcCalls).toEqual([{ fn: "link_sevenshifts_user", args: { p_actor: gmA.userId, p_location: SHOP_A, p_remote_user: "501", p_user: U(1) } }]);
    const row = vi.mocked(audit).mock.calls[0]![0];
    expect(row).toMatchObject({ action: "sevenshifts_user_link.create", resourceTable: "sevenshifts_user_links", resourceId: "UL1",
      metadata: { location_id: SHOP_A, sevenshifts_user_id: "501", user_id: U(1) } });
    expect(JSON.stringify(row)).not.toMatch(/Ana|Rivera/);
  });

  it("ruling (a) remote_not_at_shop in the LIB: below MoO the 7shifts person must hold a LIVE assignment at the shop's LIVE 7shifts location — refused before the RPC", async () => {
    // 503 works only at 4570 (shop B's 7shifts location): a GM of shop A cannot claim them.
    let w = world();
    w.tables.sevenshifts_users!.push({ id: "503", first_name: "Cy", last_name: "Q", preferred_first_name: null, employee_id: null, active: true });
    w.tables.sevenshifts_user_assignments!.push({ user_id: "503", location_id: "4570", role_id: null, active: true });
    await expect(linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "503", userId: U(2) }, READY)).rejects.toMatchObject({ status: 403, code: "remote_not_at_shop" });
    expect(w.rpc).not.toHaveBeenCalled();
    // A RETIRED assignment at the right location does not count.
    w = world();
    w.tables.sevenshifts_user_assignments = [{ user_id: "501", location_id: "4569", role_id: null, active: false }];
    await expect(linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "501", userId: U(1) }, READY)).rejects.toMatchObject({ status: 403, code: "remote_not_at_shop" });
    expect(w.rpc).not.toHaveBeenCalled();
    // A shop whose 7shifts link was UNLINKED has no 7shifts location at all.
    w = world();
    w.tables.sevenshifts_location_links = [{ id: "SL1", location_id: SHOP_A, sevenshifts_location_id: "4569", active: false }];
    await expect(linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "501", userId: U(1) }, READY)).rejects.toMatchObject({ status: 403, code: "remote_not_at_shop" });
    expect(w.rpc).not.toHaveBeenCalled();
  });

  it("ruling (a): MoO+ is exempt — the lib reads no assignment and the RPC decides", async () => {
    const w = world({ rpc: () => ({ data: { id: "UL3", changed: true } }) });
    w.tables.sevenshifts_users!.push({ id: "503", first_name: "Cy", last_name: "Q", preferred_first_name: null, employee_id: null, active: true });
    w.tables.sevenshifts_user_assignments!.push({ user_id: "503", location_id: "4570", role_id: null, active: true });
    expect(await linkUser(w.db, { actor: moo, locationId: SHOP_A, remoteUserId: "503", userId: U(2) }, READY)).toEqual({ id: "UL3", changed: true });
    expect(w.from.mock.calls.map(([t]) => t)).not.toContain("sevenshifts_user_assignments");
  });

  it("ruling (a): a failed read of the shop link or the assignments is a 500 link_failed, never a pass", async () => {
    for (const table of ["sevenshifts_location_links", "sevenshifts_user_assignments"]) {
      const w = world();
      const real = w.from.getMockImplementation()!;
      w.from.mockImplementation(((t: string) => t === table
        ? { select: () => { const q = { eq: () => q, limit: () => q, then: (r: (v: unknown) => unknown) => r({ data: null, error: { message: "boom" } }) }; return q; } }
        : real(t)) as never);
      await expect(linkUser(w.db, { actor: gmA, locationId: SHOP_A, remoteUserId: "501", userId: U(1) }, READY)).rejects.toMatchObject({ status: 500, code: "link_failed" });
      expect(w.rpc).not.toHaveBeenCalled();
    }
  });

  it("unlinkUser and unlinkShop audit .deactivate only when something changed", async () => {
    const w = world({ rpc: (fn) => ({ data: fn === "unlink_sevenshifts_user"
      ? { id: "UL1", changed: true, sevenshifts_user_id: 501, user_id: U(1), linked_at_location_id: SHOP_A }
      : { id: "SL1", changed: true, location_id: SHOP_A, sevenshifts_location_id: 4569 } }) });
    await unlinkUser(w.db, { actor: gmA, locationId: SHOP_A, linkId: U(99) }, READY);
    await unlinkShop(w.db, { actor: moo, linkId: U(98) }, READY);
    expect(vi.mocked(audit).mock.calls.map(([r]) => r.action)).toEqual(["sevenshifts_user_link.deactivate", "sevenshifts_location_link.deactivate"]);
    expect(w.rpcCalls.map((c) => c.args)).toEqual([{ p_actor: gmA.userId, p_location: SHOP_A, p_link: U(99) }, { p_actor: moo.userId, p_link: U(98) }]);
  });
});

describe("loadLinkScreen", () => {
  it("refuses a viewer who may not see the shop's 7shifts status (SMM by role, AGM elsewhere) before any I/O", async () => {
    for (const [actor, loc] of [[smm, SHOP_A], [agmA, SHOP_B]] as const) {
      const w = world();
      await expect(loadLinkScreen(w.db, { actor, locationId: loc }, READY)).rejects.toMatchObject({ status: 403, code: "forbidden" });
      expect(w.from).not.toHaveBeenCalled();
    }
  });

  it("not connected / sync off: the state only, and NOT ONE query (the tables may not exist yet)", async () => {
    for (const [env, state] of [[{}, "not_connected"], [{ SEVENSHIFTS_ACCESS_TOKEN: "t" }, "sync_off"]] as const) {
      const w = world();
      const s = await loadLinkScreen(w.db, { actor: moo, locationId: SHOP_A }, env);
      expect(s).toMatchObject({ state, shops: [], waiting: [], members: [], linked: [], recentRuns: [], wagesCount: 0 });
      expect(w.from).not.toHaveBeenCalled();
    }
  });

  it("MoO: shops with their links, the unlinked 7shifts locations, waiting people with employee id + roles, members, last runs, a wages COUNT", async () => {
    const w = world();
    const s = await loadLinkScreen(w.db, { actor: moo, locationId: SHOP_A }, READY);
    expect(s.state).toBe("ready");
    expect(s.can).toEqual({ manageShops: true, linkPeople: true, syncNow: true });
    expect(s.shops).toEqual([
      { locationId: SHOP_A, name: "Shop A", link: { id: "SL1", remoteId: "4569", remoteName: "P" } },
      { locationId: SHOP_B, name: "Shop B", link: null },
    ]);
    expect(s.remoteLocations).toEqual([{ id: "4570", name: "C" }]);
    expect(s.shopLink).toEqual({ id: "SL1", remoteId: "4569", remoteName: "P" });
    expect(s.waiting).toEqual([
      { remoteUserId: "501", displayName: "Ana R.", employeeId: "10482", roles: ["Prep"] },
      { remoteUserId: "502", displayName: "Bo D.", employeeId: null, roles: [] },
    ]);
    // Members of the shop plus all-shops (9+) accounts, narrowed to the viewer's level: the owner is above a MoO.
    expect(s.members.map((m) => m.name)).toEqual(["Ana Rivera", "Bo Diaz", "Gee Em", "Mo O"]);
    expect(s.recentRuns).toHaveLength(1);
    expect(s.wagesCount).toBe(1);
  });

  it("GM: no shop management, no Sync now, only members at or below their level; still no rate anywhere", async () => {
    const w = world();
    const s = await loadLinkScreen(w.db, { actor: gmA, locationId: SHOP_A }, READY);
    expect(s.can).toEqual({ manageShops: false, linkPeople: true, syncNow: false });
    expect(s.shops).toEqual([]);
    expect(s.remoteLocations).toEqual([]);
    expect(s.members.map((m) => m.name)).toEqual(["Ana Rivera", "Bo Diaz", "Gee Em"]);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/1999|2100|5000|wage_cents|hourly/i);
    expect(text).not.toMatch(/Rivq|Dizq/); // the full 7shifts last name never leaves the server
    expect(text).not.toContain("PLANTED-TOKEN");
  });

  it("the wages read selects user_id ONLY (no rate column is ever read)", async () => {
    const w = world();
    await loadLinkScreen(w.db, { actor: moo, locationId: SHOP_A }, READY);
    const src = readFileSync("lib/sevenshifts/links.ts", "utf8");
    const wageReads = [...src.matchAll(/from\("sevenshifts_wages"\)\.select\("([^"]*)"\)/g)].map((m) => m[1]);
    expect(wageReads).toEqual(["user_id"]);
  });

  it("not_supported (multi-company): the state and the runs only, no people loaded", async () => {
    const w = world();
    w.tables.sevenshifts_sync_runs![0]!.status = "failed";
    w.tables.sevenshifts_sync_runs![0]!.results = { whoami: { rows: 0, skipped: 0, pages: 1, error_code: "multi_company" } };
    const s = await loadLinkScreen(w.db, { actor: moo, locationId: SHOP_A }, READY);
    expect(s).toMatchObject({ state: "not_supported", waiting: [], members: [], shops: [] });
    expect(w.from.mock.calls.map(([t]) => t).sort()).toEqual(["sevenshifts_sync_run_ids", "sevenshifts_sync_runs"]);
  });
});
