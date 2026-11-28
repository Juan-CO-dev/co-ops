/**
 * Digest PR 2, packet C — the schedule reader's MIRROR reads against the REAL schema with REAL rows (not `limit 0`).
 * PGlite applies the scheduling stub, the real level helpers (0217 / 0228 / 0233), then the REAL 0243, 0268, 0269 and
 * 0301. The reader runs over a tiny client that turns each query it BUILDS (table, the exported column list, filters,
 * order) into SQL executed there as `service_role`, so a misspelled column, a missing grant or a wrong filter is a
 * failure here, not in prod. Synthetic rows only ("Person A", "Person B"; made-up ids).
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { SevenShiftsFetch } from "@/lib/sevenshifts/client";
import {
  createScheduleReader, SCHEDULE_LINK_COLUMNS, SCHEDULE_LOCATION_COLUMNS, SCHEDULE_ROLE_COLUMNS, SCHEDULE_USER_COLUMNS,
  type ServiceRoleClient,
} from "@/lib/report-digests-schedule";
import { VALID_WHOAMI, shiftRow, validAnswerBody } from "./fixtures/digest/staffing-cases";

const read = (p: string) => readFileSync(p, "utf8");
function extract(sql: string, start: string): string {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start}`);
  const j = sql.indexOf("end $$;", i);
  return sql.slice(i, j + "end $$;".length);
}

const ENV = { SEVENSHIFTS_ACCESS_TOKEN: "PLANTED-TOKEN-mirror-0123456789", SEVENSHIFTS_SYNC: "1" };
const SHOP_A = "00000000-0000-4000-8000-00000000a001";
const SHOP_B = "00000000-0000-4000-8000-00000000b002";
const SHOP_OLD = "00000000-0000-4000-8000-00000000d004"; // unlinked: its only link is inactive
const SHOP_NOLOC = "00000000-0000-4000-8000-00000000e005"; // linked to a 7shifts location with no mirror row
const ACTOR = "00000000-0000-4000-8000-0000000000f1";

interface Built { table: string; select: string; sql: string; params: unknown[] }
const built: Built[] = [];

/** PostgREST answers JSON: an int8 is a number (or a string), never a JS BigInt. */
const jsonish = (v: unknown) => (typeof v === "bigint" ? Number(v) : v);

/** Executes each query the reader builds, as service_role, in PGlite. Supports exactly what the reader calls. */
function pgliteClient(db: PGlite) {
  return {
    from(table: string) {
      let select = "";
      const where: string[] = [];
      const params: unknown[] = [];
      const order: string[] = [];
      const b: Record<string, unknown> = {
        select: (c: string) => { select = c; return b; },
        eq: (c: string, v: unknown) => { params.push(v); where.push(`${c} = $${params.length}`); return b; },
        in: (c: string, v: unknown[]) => { params.push(v.map(String)); where.push(`${c}::text = any($${params.length}::text[])`); return b; },
        order: (c: string) => { order.push(c); return b; },
        abortSignal: () => b,
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const sql = `select ${select} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${order.length ? ` order by ${order.join(", ")}` : ""}`;
          built.push({ table, select, sql, params });
          return (async () => {
            try {
              await db.exec("set role service_role");
              const r = await db.query<Record<string, unknown>>(sql, params);
              return { data: r.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, jsonish(v)]))), error: null };
            } catch (e) {
              return { data: null, error: { message: String((e as Error).message) } };
            } finally {
              await db.exec("reset role");
            }
          })().then(resolve, reject);
        },
      };
      return b;
    },
  } as unknown as ServiceRoleClient;
}

const enc = new TextEncoder();
const respond = (body: string) => new Response(enc.encode(body), { status: 200, headers: { "content-type": "application/json" } });
/** A user 13 with no mirror row, beside the table's A / B / open rows. */
const PAGE = validAnswerBody({ rows: [shiftRow("A"), shiftRow("A", { id: "1002", user_id: "13", role_id: "22" }), shiftRow("B"), shiftRow("OPEN")] });
const makeFetch = (page: string, whoami: string = VALID_WHOAMI.body): SevenShiftsFetch =>
  async (url) => (new URL(url).pathname === "/v2/whoami" ? respond(whoami) : respond(page));
const fetchFake = makeFetch(PAGE);

/** F5: ids above Number.MAX_SAFE_INTEGER; adjacent pairs for two people and for two companies. */
const BIG_CO = "9007199254740993";
const BIG_CO_NEXT = "9007199254740994";
const BIG_P1 = "9007199254740993";
const BIG_P2 = "9007199254740994";
const SHOP_BIG = "00000000-0000-4000-8000-0000000000b1"; // 7shifts location 504 of BIG_CO
const SHOP_BIG_NEXT = "00000000-0000-4000-8000-0000000000b2"; // 7shifts location 505 of the ADJACENT company
const str = (s: string) => JSON.stringify(s);

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(read("tests/fixtures/scheduling-pglite-stub.sql"));
  await db.exec([
    extract(read("supabase/migrations/0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
    extract(read("supabase/migrations/0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
    extract(read("supabase/migrations/0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
  ].join("\n"));
  for (const m of ["0243_cron_route_leases", "0268_sevenshifts_sync", "0269_sevenshifts_links", "0301_sevenshifts_per_shop_links"]) {
    await db.exec(read(`supabase/migrations/${m}.sql`));
  }
  await db.exec(`
    insert into public.users (id, name, role) values ('${ACTOR}', 'Person M', 'moo');
    insert into public.locations (id, name) values ('${SHOP_A}', 'Shop A'), ('${SHOP_B}', 'Shop B'), ('${SHOP_OLD}', 'Shop D'), ('${SHOP_NOLOC}', 'Shop E'),
      ('${SHOP_BIG}', 'Shop F'), ('${SHOP_BIG_NEXT}', 'Shop G');
    insert into public.sevenshifts_locations (id, company_id, name, active) values (501, 9001, 'Shop A', true), (502, 9001, 'Shop B', true), (503, 9002, 'Other', true),
      (504, ${BIG_CO}, 'Shop F', true), (505, ${BIG_CO_NEXT}, 'Shop G', true);
    insert into public.sevenshifts_users (id, company_id, first_name, last_name, preferred_first_name, active) values
      (11, 9001, 'Alpha', 'NEVER-SELECTED', 'Person A', true),
      (12, 9001, 'Person B', 'NEVER-SELECTED', null, true),
      (14, 9001, 'Person C', 'NEVER-SELECTED', null, true),
      (15, 9002, 'Person X', 'NEVER-SELECTED', 'Person X', true),
      (${BIG_P1}, ${BIG_CO}, 'Person F', 'NEVER-SELECTED', null, true),
      (${BIG_P2}, ${BIG_CO}, 'Person G', 'NEVER-SELECTED', null, true);
    insert into public.sevenshifts_roles (id, location_id, name, active) values (21, 501, 'Cook', true), (23, 502, 'Cashier', true);
    insert into public.sevenshifts_location_links (location_id, sevenshifts_location_id, active, linked_by) values
      ('${SHOP_A}', 501, true, '${ACTOR}'), ('${SHOP_B}', 502, true, '${ACTOR}'), ('${SHOP_NOLOC}', 999, true, '${ACTOR}'),
      ('${SHOP_BIG}', 504, true, '${ACTOR}'), ('${SHOP_BIG_NEXT}', 505, true, '${ACTOR}');
    insert into public.sevenshifts_location_links (location_id, sevenshifts_location_id, active, linked_by, unlinked_by, unlinked_at) values
      ('${SHOP_OLD}', 503, false, '${ACTOR}', '${ACTOR}', now());
  `);
}, 120_000);

describe("the reader's mirror reads against the real 0268 / 0269 / 0301 schema, real rows", () => {
  it("the column lists name no last_name, and the queries the reader builds use exactly those lists", async () => {
    for (const cols of [SCHEDULE_LINK_COLUMNS, SCHEDULE_LOCATION_COLUMNS, SCHEDULE_USER_COLUMNS, SCHEDULE_ROLE_COLUMNS]) expect(cols).not.toMatch(/last_name/);
    // F3: the user list carries the company; F5: every bigint id is cast to text.
    expect(SCHEDULE_USER_COLUMNS).toBe("id::text, company_id::text, first_name, preferred_first_name");
    expect(SCHEDULE_USER_COLUMNS).toContain("company_id");
    built.length = 0;
    const r = createScheduleReader(pgliteClient(db), { env: ENV, fetch: fetchFake });
    const a = await r.shopWindow(SHOP_A, "2026-03-01", "2026-03-02");
    expect(a.kind).toBe("ok");
    const byTable = (t: string) => built.filter((q) => q.table === t);
    expect(byTable("sevenshifts_location_links").map((q) => q.select)).toEqual([SCHEDULE_LINK_COLUMNS]);
    expect(byTable("sevenshifts_locations").map((q) => q.select)).toEqual([SCHEDULE_LOCATION_COLUMNS]);
    expect(byTable("sevenshifts_users").map((q) => q.select)).toEqual([SCHEDULE_USER_COLUMNS]);
    expect(byTable("sevenshifts_roles").map((q) => q.select)).toEqual([SCHEDULE_ROLE_COLUMNS]);
    expect(built.every((q) => !q.sql.includes("last_name"))).toBe(true);
    expect(built.map((q) => q.table).sort()).toEqual(["sevenshifts_location_links", "sevenshifts_locations", "sevenshifts_roles", "sevenshifts_users"]);
    expect(byTable("sevenshifts_users")[0]!.sql).toMatch(/ order by id$/);
    expect(byTable("sevenshifts_roles")[0]!.sql).toMatch(/ order by id$/);
  });

  it("the link read, the company read, names and roles: the right rows; an id with no row is absent", async () => {
    const r = createScheduleReader(pgliteClient(db), { env: ENV, fetch: fetchFake });
    const a = await r.shopWindow(SHOP_A, "2026-03-01", "2026-03-02");
    const b = await r.shopWindow(SHOP_B, "2026-03-01", "2026-03-02");
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error(`not ok: ${a.kind} ${b.kind}`);
    expect(a.value.days[0]!.people.map((p) => [p.userId, p.firstName, p.roleName])).toEqual([["11", "Person A", "Cook"], ["13", null, null]]);
    expect(a.value.days[1]!.openShifts).toBe(1);
    expect(b.value.days[1]!.people.map((p) => [p.userId, p.firstName, p.roleName])).toEqual([["12", "Person B", null]]);
    expect(JSON.stringify([a, b])).not.toContain("NEVER-SELECTED");
  });

  it("the exact queries, run directly: links by shop + active, company by location, names and roles by id set", async () => {
    await db.exec("set role service_role");
    try {
      const link = await db.query(`select ${SCHEDULE_LINK_COLUMNS} from public.sevenshifts_location_links where location_id = $1 and active = $2`, [SHOP_A, true]);
      expect(link.rows).toEqual([{ location_id: SHOP_A, sevenshifts_location_id: "501" }]);
      const old = await db.query(`select ${SCHEDULE_LINK_COLUMNS} from public.sevenshifts_location_links where location_id = $1 and active = $2`, [SHOP_OLD, true]);
      expect(old.rows).toEqual([]);
      const loc = await db.query(`select ${SCHEDULE_LOCATION_COLUMNS} from public.sevenshifts_locations where id::text = any($1::text[])`, [["502"]]);
      expect(loc.rows).toEqual([{ id: "502", company_id: "9001" }]);
      const users = await db.query(`select ${SCHEDULE_USER_COLUMNS} from public.sevenshifts_users where id::text = any($1::text[]) order by id`, [["14", "11", "13"]]);
      expect(users.rows).toEqual([
        { id: "11", company_id: "9001", first_name: "Alpha", preferred_first_name: "Person A" },
        { id: "14", company_id: "9001", first_name: "Person C", preferred_first_name: null },
      ]);
      expect(users.fields.map((f) => f.name)).toEqual(["id", "company_id", "first_name", "preferred_first_name"]);
      const roles = await db.query(`select ${SCHEDULE_ROLE_COLUMNS} from public.sevenshifts_roles where id::text = any($1::text[]) order by id`, [["23", "22", "21"]]);
      expect(roles.rows).toEqual([{ id: "21", name: "Cook" }, { id: "23", name: "Cashier" }]);
    } finally {
      await db.exec("reset role");
    }
  });

  it("an inactive link and a link whose location has no mirror row → shop_not_linked, no HTTP request", async () => {
    const counter = { requests: 0 };
    const r = createScheduleReader(pgliteClient(db), { env: ENV, fetch: fetchFake, counter });
    expect(await r.shopWindow(SHOP_OLD, "2026-03-01", "2026-03-02")).toEqual({ kind: "unavailable", reason: "shop_not_linked" });
    expect(await r.shopWindow(SHOP_NOLOC, "2026-03-01", "2026-03-02")).toEqual({ kind: "unavailable", reason: "shop_not_linked" });
    expect(counter.requests).toBe(0);
  });

  it("F3: a published user whose mirror row is of ANOTHER company → not available for both shops; the name never appears", async () => {
    const page = validAnswerBody({ rows: [shiftRow("A", { user_id: "15" }), shiftRow("B")] });
    const r = createScheduleReader(pgliteClient(db), { env: ENV, fetch: makeFetch(page) });
    const a = await r.shopWindow(SHOP_A, "2026-03-01", "2026-03-02");
    const b = await r.shopWindow(SHOP_B, "2026-03-01", "2026-03-02");
    expect(a).toEqual({ kind: "unavailable", reason: "mirror_conflict" });
    expect(b).toEqual({ kind: "unavailable", reason: "mirror_conflict" });
    expect(JSON.stringify([a, b])).not.toContain("Person X");
  });

  it("F3: a published user with NO mirror row → ok with a null first name", async () => {
    const page = validAnswerBody({ rows: [shiftRow("A", { user_id: "13" })] });
    const r = createScheduleReader(pgliteClient(db), { env: ENV, fetch: makeFetch(page) });
    const a = await r.shopWindow(SHOP_A, "2026-03-01", "2026-03-02");
    if (a.kind !== "ok") throw new Error(JSON.stringify(a));
    expect(a.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([["13", null]]);
  });

  it("F5: adjacent 16-digit ids come back from the exact select lists as DISTINCT strings", async () => {
    await db.exec("set role service_role");
    try {
      const users = await db.query(`select ${SCHEDULE_USER_COLUMNS} from public.sevenshifts_users where id::text = any($1::text[]) order by id`, [[BIG_P2, BIG_P1]]);
      expect(users.rows).toEqual([
        { id: BIG_P1, company_id: BIG_CO, first_name: "Person F", preferred_first_name: null },
        { id: BIG_P2, company_id: BIG_CO, first_name: "Person G", preferred_first_name: null },
      ]);
      const locs = await db.query(`select ${SCHEDULE_LOCATION_COLUMNS} from public.sevenshifts_locations where id::text = any($1::text[]) order by id`, [["504", "505"]]);
      expect(locs.rows).toEqual([{ id: "504", company_id: BIG_CO }, { id: "505", company_id: BIG_CO_NEXT }]);
      const links = await db.query(`select ${SCHEDULE_LINK_COLUMNS} from public.sevenshifts_location_links where active = $1`, [true]);
      expect(links.rows.every((x) => typeof (x as Record<string, unknown>).sevenshifts_location_id === "string")).toBe(true);
    } finally {
      await db.exec("reset role");
    }
  });

  it("F5: the reader over the real schema: adjacent big people resolve to the right names; the adjacent company is not verified", async () => {
    const page = validAnswerBody({
      rows: [
        shiftRow("A", { location_id: "504", company_id: str(BIG_CO), user_id: str(BIG_P1), role_id: "null" }),
        shiftRow("A", { id: "1002", location_id: "504", company_id: str(BIG_CO), user_id: str(BIG_P2), role_id: "null", start: `"2026-03-01T15:00:00Z"` }),
      ],
    });
    const whoami = `{"object":"whoami","data":{"users":[{"id":77,"company_id":"${BIG_CO}"}]}}`;
    const r = createScheduleReader(pgliteClient(db), { env: ENV, fetch: makeFetch(page, whoami) });
    const a = await r.shopWindow(SHOP_BIG, "2026-03-01", "2026-03-02");
    if (a.kind !== "ok") throw new Error(JSON.stringify(a));
    expect(a.value.days[0]!.people.map((p) => [p.userId, p.firstName])).toEqual([[BIG_P1, "Person F"], [BIG_P2, "Person G"]]);
    expect(await r.shopWindow(SHOP_BIG_NEXT, "2026-03-01", "2026-03-02")).toEqual({ kind: "unavailable", reason: "company_unverified" });
  });
});
