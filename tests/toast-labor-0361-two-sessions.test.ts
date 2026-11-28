/**
 * The 0361 two-session proof (scripts/sim/toast-labor-0361-two-sessions.mjs) is FILE ONLY: the lead runs it on the
 * SIM project. It is never executed against a database here and nothing here touches the network: every request
 * goes to an injected fetcher or a scripted query function that answers from memory. These tests pin its safety
 * (sim only, refusals before any request, no retry, no token or server text in the output), the shape of every
 * session's SQL, the fixture (2001, inactive, no Toast guid), the retirement (nothing deleted, scoped by id + tag),
 * and that its orchestration passes on a scripted good run and FAILS on each scripted bad one.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as raw from "../scripts/sim/toast-labor-0361-two-sessions.mjs";

type Rows = Array<Record<string, unknown>>;
type Query = (sql: string) => Promise<Rows>;
type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; redirect?: string; signal?: unknown };
type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
type Fetcher = (url: string, init: FetchInit) => Promise<FakeResponse>;
type Entry = {
  location_id: string; time_entry_guid: string; business_date: string; employee_guid: string; employee_first_name: string | null;
  job_guid: string | null; job_name: string | null; in_at: string; out_at: string | null; hours: number | null;
  overtime_hours: number | null; auto_clocked_out: boolean; deleted: boolean; source_modified_at: string | null;
};
type Step = { kind: string; rows?: Entry[]; shop?: string; employee?: string; user?: string; actor?: string; linkId?: string };
type Case = {
  id: string; label: string; keys: string[]; seeded: boolean; shop: string; lockType: string | null;
  holder: Step[]; racer: Step[]; link?: boolean; control?: boolean;
};
type Fixture = { shop: string; linkShop: string; user: string; tag: string; linkTag: string; employee: string; linkEmployee: string };
type RestClient = { rpc: (name: string, args: { p_rows: Entry[] }) => Promise<{ data: unknown; error: { code?: string } | null }> };
type Opts = { sleep?: (ms: number) => Promise<void>; pollMs?: number; rest?: boolean; restClient?: () => Promise<RestClient> };
type Log = (line: string) => void;
interface Script {
  SIM_REF: string; PROD_REF: string; MANAGEMENT_URL: string; DAY: string;
  M: { m0: string; m1: string; m2: string };
  parseArgs(args: string[]): { ok: boolean; reason?: string };
  managementDriver(ref: string, token: string, fetcher: Fetcher): Query;
  fixture(ids?: Partial<Pick<Fixture, "shop" | "linkShop" | "user">>): Fixture;
  fixtureSQL(f: Fixture): string;
  activateLinkShopSQL(f: Fixture): string;
  cases(f: Fixture): Case[];
  seedRows(f: Fixture): Entry[];
  plannedKeys(f: Fixture): string[];
  sessionSQL(name: string, steps: Step[], opts?: { holdSeconds?: number }): string;
  sessionName(f: Fixture, c: Case, role: "h" | "r"): string;
  parseSession(rows: Rows, name: string, count: number): { pid: number; calls: Array<Record<string, unknown>> } | null;
  observerSQL(holder: string, racer: string, lockType?: string | null): string;
  preflightSQL(): string;
  retireEntriesSQL(f: Fixture): string;
  retireConfigSQL(f: Fixture): string;
  entriesReadBackSQL(f: Fixture): string;
  guardCountsViolation(answer: unknown): string | null;
  judgeCounts(who: string, got: unknown, want: Record<string, number>): string | null;
  counts(partial: Record<string, number>): Record<string, number>;
  runProof(query: Query, log: Log, opts?: Opts): Promise<number>;
  main(args: string[], env: Record<string, string | undefined>, log: Log, deps?: Opts & { fetcher?: Fetcher }): Promise<number>;
}
const S = raw as unknown as Script;
const SCRIPT = "scripts/sim/toast-labor-0361-two-sessions.mjs";
const source = readFileSync(SCRIPT, "utf8").replace(/\r\n/g, "\n");
const SIM = S.SIM_REF, PROD = S.PROD_REF;
const TOKEN = "sbp_SECRET_TEST_TOKEN_0361_never_printed";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINK_ID = "11111111-2222-4333-8444-555555555555";

const byId = (f: Fixture, id: string): Case => {
  const c = S.cases(f).find((x) => x.id === id);
  if (!c) throw new Error(`no case ${id}`);
  return c;
};
const payloads = (sql: string): Entry[][] =>
  [...sql.matchAll(/toast_time_entries_apply_newer\('([^']*)'::jsonb\)/g)].map((m) => JSON.parse(m[1] ?? "[]") as Entry[]);
const statements = (sql: string): string[] => sql.split(";").map((s) => s.trim()).filter(Boolean);

afterEach(() => { vi.restoreAllMocks(); });

// ── arguments and transport ────────────────────────────────────────────────────────────────────
describe("0361 two-session proof: refusals and transport (offline)", () => {
  it("refuses a missing ref, the prod ref, any non-sim ref, unknown / repeated flags and a missing token BEFORE any request", async () => {
    const fetcher = vi.fn<Fetcher>();
    const cases: Array<[string[], Record<string, string | undefined>]> = [
      [[], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [[`--ref=${PROD}`], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [["--ref=abcdefghijklmnopqrst"], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [[`--ref=${SIM}`, "--bogus"], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [[`--ref=${SIM}`, `--ref=${SIM}`], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [[`--ref=${SIM}`, "--rest", "--rest"], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [[`--ref=${SIM}`, "--rest", `--retire=${LINK_ID}`], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [[`--ref=${SIM}`, "--retire=not-a-uuid"], { SUPABASE_ACCESS_TOKEN: TOKEN }],
      [[`--ref=${SIM}`], {}],
      [[`--ref=${SIM}`], { SUPABASE_ACCESS_TOKEN: "" }],
      [[`--ref=${SIM}`], { SUPABASE_ACCESS_TOKEN: "has a space" }],
    ];
    for (const [args, env] of cases) {
      const lines: string[] = [];
      expect(await S.main(args, env, (l) => lines.push(l), { fetcher })).toBe(2);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^REFUSED: /);
      expect(lines[0]).not.toContain(TOKEN);
    }
    expect(fetcher).not.toHaveBeenCalled();
    const prod: string[] = [];
    await S.main([`--ref=${PROD}`], { SUPABASE_ACCESS_TOKEN: TOKEN }, (l) => prod.push(l), { fetcher });
    expect(prod[0]).toContain(`PRODUCTION project ${PROD}`);
    const other: string[] = [];
    await S.main(["--ref=abcdefghijklmnopqrst"], { SUPABASE_ACCESS_TOKEN: TOKEN }, (l) => other.push(l), { fetcher });
    expect(other[0]).toContain(PROD);
    expect(S.parseArgs([`--ref=${SIM}`, "--rest"])).toMatchObject({ ok: true });
    expect(S.parseArgs([`--ref=${SIM}`, `--retire=${LINK_ID}`])).toMatchObject({ ok: true });
  });

  it("the driver posts ONLY to the sim project's Management URL, with redirect: 'error', and never retries", async () => {
    expect(S.MANAGEMENT_URL).toBe(`https://api.supabase.com/v1/projects/${SIM}/database/query`);
    expect(() => S.managementDriver(PROD, TOKEN, vi.fn<Fetcher>())).toThrow();
    expect(() => S.managementDriver(SIM, "", vi.fn<Fetcher>())).toThrow();
    const ok = vi.fn<Fetcher>(async () => ({ ok: true, status: 200, json: async () => [{ x: 1 }] }));
    expect(await S.managementDriver(SIM, TOKEN, ok)("select 1")).toEqual([{ x: 1 }]);
    expect(ok).toHaveBeenCalledTimes(1);
    const [url, init] = ok.mock.calls[0]!;
    expect(url).toBe(S.MANAGEMENT_URL);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeDefined();
    expect(init.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body ?? "{}")).toEqual({ query: "select 1" });

    const broken = vi.fn<Fetcher>(async () => { throw new Error("ECONNRESET with server text"); });
    await expect(S.managementDriver(SIM, TOKEN, broken)("select 1")).rejects.toThrow("management request failed (transport)");
    expect(broken).toHaveBeenCalledTimes(1);
    const refused = vi.fn<Fetcher>(async () => ({ ok: false, status: 400, json: async () => ({ message: "ERROR: secret server text" }) }));
    const error = await S.managementDriver(SIM, TOKEN, refused)("select 1").catch((e: unknown) => e);
    expect(String(error)).toContain("HTTP 400");
    expect(String(error)).not.toContain("secret server text");
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("reads no env file, no token file and no database URL; the only env value it reads is the token", () => {
    expect(source).toContain("FILE ONLY");
    expect(source).not.toMatch(/dotenv|DATABASE_URL|from ['"]pg['"]|readFileSync|\.supabase-token|\.env\.local/);
    expect(source.match(/env\.[A-Z_]+/g)?.filter((m) => !m.startsWith("env.NEXT_PUBLIC_SUPABASE_URL") && m !== "env.SUPABASE_SERVICE_ROLE_KEY"))
      .toEqual(["env.SUPABASE_ACCESS_TOKEN"]);
    // --rest goes through the repo's sim-only loader, never a file read of its own.
    expect(source).toContain("import('./launch-readiness/env.ts')");
    expect(source).toContain("loader.loadSimEnv(");
  });
});

// ── SQL shapes ─────────────────────────────────────────────────────────────────────────────────
describe("0361 two-session proof: session SQL shapes", () => {
  const f = S.fixture();

  it("every case session is ONE transaction as service_role; the holder sleeps before commit, the racer does not", () => {
    const all = S.cases(f);
    expect(all.map((c) => c.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8a", "8b", "9", "10"]);
    for (const c of all) {
      for (const role of ["h", "r"] as const) {
        const name = S.sessionName(f, c, role);
        expect(name.length).toBeLessThanOrEqual(63); // application_name is truncated past 63 bytes
        const sql = S.sessionSQL(name, role === "h" ? c.holder : c.racer);
        expect(sql.match(/begin isolation level read committed;/g)).toHaveLength(1);
        expect(sql.match(/\bcommit;/g)).toHaveLength(1);
        expect(sql).toContain("set local role service_role;");
        expect(sql).toContain(`set local application_name = '${name}';`);
        expect(sql.indexOf("set local role service_role;")).toBeLessThan(sql.indexOf("do $s0361$"));
        // Results go into session settings, and are selected AFTER the commit with the backend pid.
        expect(sql).toMatch(/set_config\('co_ops\.s0361_1', jsonb_build_object\('tag', '[^']+', 'ok', v\)::text, false\)/);
        const commitAt = sql.indexOf("commit;");
        expect(sql.indexOf("current_setting('co_ops.s0361_1', true) as s1")).toBeGreaterThan(commitAt);
        expect(sql.indexOf("pg_backend_pid() as pid")).toBeGreaterThan(commitAt);
        // A stale setting from another request on the same backend is cleared first.
        expect(sql.indexOf("set_config('co_ops.s0361_1', '', false)")).toBeLessThan(sql.indexOf("begin isolation"));
        // The 40P01 handler is in every call, and it answers with the SQLSTATE as data.
        expect(sql).toContain("when deadlock_detected then perform set_config(");
        expect(sql).toContain("'sqlstate', sqlstate");
        expect(sql).not.toContain("sqlerrm)"); // server text is never stored raw
        if (role === "h") {
          expect(sql).toContain("select pg_sleep(7);");
          expect(sql.indexOf("select pg_sleep(7);")).toBeLessThan(commitAt);
        } else {
          expect(sql).not.toContain("pg_sleep");
        }
      }
    }
  });

  it("cases 1 to 8 call the guarded function with the expected payloads", () => {
    const k = (n: string) => `${f.tag}-${n}`;
    const one = (id: string) => {
      const c = byId(f, id);
      const h = payloads(S.sessionSQL(S.sessionName(f, c, "h"), c.holder));
      const r = payloads(S.sessionSQL(S.sessionName(f, c, "r"), c.racer));
      return { c, h, r };
    };
    const c1 = one("1");
    expect(c1.h).toHaveLength(1); expect(c1.r).toHaveLength(1);
    expect(c1.h[0]![0]).toMatchObject({ time_entry_guid: k("c01"), source_modified_at: S.M.m2, deleted: false });
    expect(c1.h[0]![0]!.out_at).not.toBeNull();
    expect(c1.r[0]![0]).toMatchObject({ time_entry_guid: k("c01"), source_modified_at: S.M.m1, out_at: null });
    expect(one("5").h[0]![0]).toMatchObject({ deleted: true, source_modified_at: S.M.m2 });
    expect(one("6").r[0]![0]).toMatchObject({ deleted: true, source_modified_at: S.M.m2 });
    expect(one("7").h[0]).toEqual(one("7").r[0]);
    expect(S.M.m0 < S.M.m1 && S.M.m1 < S.M.m2).toBe(true);

    // 8a: the holder applies K1, pauses, then K2, in ONE transaction; the racer is ONE call listing K2 first,
    // K2 live and K1 archived. K1 sorts before K2 under collate "C".
    const c8a = one("8a");
    const holder8a = S.sessionSQL(S.sessionName(f, c8a.c, "h"), c8a.c.holder);
    expect(c8a.h.map((p) => p.map((e) => e.time_entry_guid))).toEqual([[k("c08a-k1")], [k("c08a-k2")]]);
    expect(holder8a.indexOf(k("c08a-k1"))).toBeLessThan(holder8a.indexOf("pg_sleep"));
    expect(holder8a.indexOf("pg_sleep")).toBeLessThan(holder8a.indexOf(k("c08a-k2")));
    expect(holder8a.indexOf(k("c08a-k2"))).toBeLessThan(holder8a.indexOf("commit;"));
    expect(c8a.r).toHaveLength(1);
    expect(c8a.r[0]!.map((e) => [e.time_entry_guid, e.deleted, e.source_modified_at]))
      .toEqual([[k("c08a-k2"), false, S.M.m2], [k("c08a-k1"), true, S.M.m2]]);
    expect(Buffer.compare(Buffer.from(k("c08a-k1")), Buffer.from(k("c08a-k2")))).toBe(-1);
    const c8b = one("8b");
    expect(c8b.r[0]!.map((e) => [e.time_entry_guid, e.deleted, e.source_modified_at]))
      .toEqual([[k("c08b-k2"), true, S.M.m2], [k("c08b-k1"), false, S.M.m2]]);
    expect(c8b.h.map((p) => p.map((e) => e.time_entry_guid))).toEqual([[k("c08b-k1")], [k("c08b-k2")]]);
  });

  it("case 9's racer is main's unconditional upsert listing K2 before K1, never the guarded function", () => {
    const c = byId(f, "9");
    const racer = S.sessionSQL(S.sessionName(f, c, "r"), c.racer);
    const holder = S.sessionSQL(S.sessionName(f, c, "h"), c.holder);
    expect(racer).not.toContain("toast_time_entries_apply_newer");
    expect(racer).toMatch(/insert into public\.toast_time_entries \(location_id, time_entry_guid, [^)]*source_modified_at, pulled_at\)/);
    expect(racer).toContain("on conflict (location_id, time_entry_guid) do update set business_date = excluded.business_date");
    for (const col of ["employee_first_name", "user_id"]) {
      if (col === "user_id") expect(racer).not.toContain("user_id = excluded.user_id");
      else expect(racer).toContain(`${col} = excluded.${col}`);
    }
    expect(racer).toContain("pulled_at = excluded.pulled_at");
    expect(racer.indexOf(`'${f.tag}-c09-k2'`)).toBeLessThan(racer.indexOf(`'${f.tag}-c09-k1'`));
    expect(racer).toContain("get diagnostics v_n = row_count;");
    // The same holder as case 8.
    expect(payloads(holder).map((p) => p.map((e) => e.time_entry_guid))).toEqual([[`${f.tag}-c09-k1`], [`${f.tag}-c09-k2`]]);
  });

  it("case 10's holder calls the real link_toast_employee (auto, no actor) and the racer inserts a NEW key at the link shop", () => {
    const c = byId(f, "10");
    const holder = S.sessionSQL(S.sessionName(f, c, "h"), c.holder);
    expect(holder).toContain(`public.link_toast_employee(null, '${f.linkShop}'::uuid, '${f.linkEmployee}', '${f.user}'::uuid, 'auto')`);
    expect(holder).not.toContain("toast_time_entries_apply_newer");
    const r = payloads(S.sessionSQL(S.sessionName(f, c, "r"), c.racer));
    expect(r[0]).toHaveLength(1);
    expect(r[0]![0]).toMatchObject({ location_id: f.linkShop, employee_guid: f.linkEmployee, time_entry_guid: `${f.tag}-c10` });
    expect(c.lockType).toBe("advisory");
    expect(S.observerSQL("h", "r", "advisory")).toContain("l.locktype = 'advisory'");
    expect(c.seeded).toBe(false);
  });

  it("the observer looks for a WAITING racer whose blockers include the holder", () => {
    const sql = S.observerSQL("SIM-h", "SIM-r");
    expect(sql).toContain("not l.granted");
    expect(sql).toContain("h.pid = any(pg_blocking_pids(r.pid))");
    expect(sql).toContain("r.wait_event_type = 'Lock'");
    expect(sql).toContain("r.application_name = 'SIM-r' and h.application_name = 'SIM-h'");
    expect(sql).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it("a session answer is read from its own tagged setting only", () => {
    const name = "SIM-0361-x-c01-r";
    const own = JSON.stringify({ tag: name, ok: { inserted: 1 } });
    const stale = JSON.stringify({ tag: "SIM-0361-other", ok: { inserted: 1 } });
    expect(S.parseSession([{ s1: own, pid: 7 }], name, 1)).toEqual({ pid: 7, calls: [{ ok: { inserted: 1 } }] });
    expect(S.parseSession([{ s1: stale, pid: 7 }], name, 1)?.calls[0]).toEqual({ missing: true });
    expect(S.parseSession([{ s1: "", pid: 7 }], name, 1)?.calls[0]).toEqual({ missing: true });
    const dead = JSON.stringify({ tag: name, sqlstate: "40P01", code: null });
    expect(S.parseSession([{ s1: dead, pid: 7 }], name, 1)?.calls[0]).toEqual({ sqlstate: "40P01", code: null });
    const odd = JSON.stringify({ tag: name, sqlstate: "server text here", code: "free text" });
    expect(S.parseSession([{ s1: odd, pid: 7 }], name, 1)?.calls[0]).toEqual({ sqlstate: "unknown", code: null });
  });
});

describe("0361 two-session proof: fixture and retirement", () => {
  const f = S.fixture();

  it("every fixture timestamp and business date is in 2001; synthetic names; a fresh key per case", () => {
    const rows: Entry[] = [...S.seedRows(f)];
    for (const c of S.cases(f)) for (const s of [...c.holder, ...c.racer]) rows.push(...(s.rows ?? []));
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      expect(r.business_date).toMatch(/^2001-/);
      expect(r.in_at).toMatch(/^2001-/);
      if (r.out_at !== null) expect(r.out_at).toMatch(/^2001-/);
      expect(r.source_modified_at).toMatch(/^2001-/);
      expect(r.employee_first_name).toBe("Testa");
      expect(r.time_entry_guid.startsWith(`${f.tag}-`)).toBe(true);
    }
    const keys = S.cases(f).flatMap((c) => c.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(S.seedRows(f).every((r) => r.source_modified_at === S.M.m0 && !r.deleted)).toBe(true);
    expect(f.tag).toBe(`SIM-0361-${f.shop}`);
    for (const id of [f.shop, f.linkShop, f.user]) expect(id).toMatch(UUID_RE);
    expect(new Set([f.shop, f.linkShop, f.user]).size).toBe(3);
    expect(f.linkEmployee.length).toBeLessThanOrEqual(64);
  });

  it("both shops are inserted INACTIVE with NO Toast restaurant guid; the fixture only inserts", () => {
    const sql = S.fixtureSQL(f);
    expect(sql).not.toMatch(/\b(update|delete|truncate|drop|alter)\b/i);
    expect(sql).toContain(`('${f.shop}'::uuid,'${f.tag}','${f.tag}','permanent',false,null)`);
    expect(sql).toContain(`('${f.linkShop}'::uuid,'${f.linkTag}','${f.linkTag}','permanent',false,null)`);
    expect(sql).toContain("(id,name,code,type,active,toast_restaurant_guid)");
    expect(sql).toContain(`'gm','SIM-NO-VALID-CREDENTIAL',true`);
    expect(sql).not.toMatch(/toast_time_entries/);
    // The link shop is switched on only for case 10, still without a Toast guid.
    expect(S.activateLinkShopSQL(f)).toBe(`update public.locations set active=true where id='${f.linkShop}'::uuid and code='${f.linkTag}' and toast_restaurant_guid is null`);
    // The preflight is read-only and checks the function's grants.
    const pre = S.preflightSQL();
    expect(pre).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
    expect(pre).toContain("has_function_privilege('authenticated', to_regprocedure('public.toast_time_entries_apply_newer(jsonb)'), 'EXECUTE')");
    expect(pre).toContain("has_function_privilege('anon'");
    expect(pre).toContain("is_nullable='NO' and column_default is null");
  });

  it("the retirement deletes nothing and every UPDATE is scoped by the fixture's ids AND its tag", () => {
    const entries = S.retireEntriesSQL(f), config = S.retireConfigSQL(f);
    for (const sql of [entries, config, S.entriesReadBackSQL(f)]) expect(sql).not.toMatch(/\b(delete|truncate|drop|alter|insert)\b/i);
    expect(entries).toContain("set deleted=true");
    expect(entries).toContain(`location_id in ('${f.shop}'::uuid, '${f.linkShop}'::uuid)`);
    expect(entries).toContain(`time_entry_guid like '${f.tag}-%'`);
    for (const key of S.plannedKeys(f)) expect(entries).toContain(`'${key}'`);
    const updates = statements(config).filter((s) => /^update/.test(s));
    expect(updates).toHaveLength(4);
    for (const u of updates) {
      expect(u).toContain("set active=false");
      expect(u).toMatch(new RegExp(`(name|code)='${f.tag}(-L)?'`));
      expect(u).toMatch(/(id|user_id)='[0-9a-f-]{36}'::uuid/);
    }
  });
});

// ── the orchestration, against a scripted transport ───────────────────────────────────────────
type Scenario = {
  neverBlocked?: string; wrongCount?: string; bothCommit9?: boolean; racerDeadlock8a?: boolean;
  observerThrowsAt?: string; noGuard?: boolean; leftLink?: boolean; holderMs?: number; racerMs?: number;
  lookup?: Record<string, unknown> | null;
  /** Replace the FIRST call's guarded answer of one case session (raw, as the session would carry it). */
  override?: { id: string; role: "h" | "r"; ok: unknown };
};
const ep = (iso: string) => Date.parse(iso) / 1000;
const full = (p: Record<string, number>) => {
  const keys = ["inserted", "updated", "unchanged", "skipped_same_stamp", "skipped_older", "skipped_no_stamp", "duplicates"];
  const out: Record<string, number> = {};
  for (const key of keys) out[key] = p[key] ?? 0;
  out.received = keys.reduce((s, key) => s + (out[key] ?? 0), 0);
  return out;
};
// Written by hand from the 0361 header (independent of the script's own expectation table).
const ANSWERS: Record<string, { holder: unknown[]; racer: unknown[] }> = {
  "01": { holder: [full({ inserted: 1 })], racer: [full({ skipped_older: 1 })] },
  "02": { holder: [full({ inserted: 1 })], racer: [full({ updated: 1 })] },
  "03": { holder: [full({ updated: 1 })], racer: [full({ skipped_older: 1 })] },
  "04": { holder: [full({ updated: 1 })], racer: [full({ updated: 1 })] },
  "05": { holder: [full({ updated: 1 })], racer: [full({ skipped_older: 1 })] },
  "06": { holder: [full({ updated: 1 })], racer: [full({ updated: 1 })] },
  "07": { holder: [full({ inserted: 1 })], racer: [full({ unchanged: 1 })] },
  "8a": { holder: [full({ updated: 1 }), full({ updated: 1 })], racer: [full({ updated: 2 })] },
  "8b": { holder: [full({ updated: 1 }), full({ updated: 1 })], racer: [full({ updated: 2 })] },
  "09": { holder: [full({ updated: 1 }), { sqlstate: "40P01" }], racer: [{ rows: 2 }] },
  "10": { holder: [{ id: LINK_ID, changed: true, backfilled: 0 }], racer: [full({ inserted: 1 })] },
};
const FINAL: Record<string, [boolean, boolean, string]> = {
  c01: [false, true, "m2"], c02: [false, true, "m2"], c03: [false, true, "m2"], c04: [false, true, "m2"],
  c05: [true, true, "m2"], c06: [true, true, "m2"], c07: [false, true, "m1"],
  "c08a-k1": [true, true, "m2"], "c08a-k2": [false, true, "m2"], "c08b-k1": [false, true, "m2"], "c08b-k2": [true, true, "m2"],
  "c09-k1": [true, true, "m2"], "c09-k2": [false, true, "m2"], c10: [false, true, "m1"],
};

function transport(scenario: Scenario = {}) {
  const sent: string[] = [];
  const events: string[] = [];
  const pids = new Map<string, number>();
  const pidOf = (name: string) => { if (!pids.has(name)) pids.set(name, 100 + pids.size); return pids.get(name)!; };
  let tag = "", user = "", unlinked = false;
  const later = <T,>(ms: number, name: string, value: T) =>
    new Promise<T>((resolve) => setTimeout(() => { events.push(`done:${name}`); resolve(value); }, ms));
  const answer = (name: string, calls: unknown[]): Rows => {
    const row: Record<string, unknown> = { pid: pidOf(name) };
    calls.forEach((call, i) => {
      const c = call as Record<string, unknown>;
      row[`s${i + 1}`] = JSON.stringify(typeof c.sqlstate === "string" ? { tag: name, sqlstate: c.sqlstate, code: null } : { tag: name, ok: c });
    });
    return [row];
  };
  const query: Query = async (sql) => {
    sent.push(sql);
    if (sql.includes("set deleted=true")) events.push("retire:entries");
    if (sql.includes("update public.users set active=false")) events.push("retire:config");
    if (sql.includes("as has_guard")) {
      return [{ missing_columns: [], unfilled_required: [], has_guard: !scenario.noGuard, guard_service: !scenario.noGuard, guard_authenticated: false,
        guard_anon: false, has_link: true, link_service: true, link_triggers: 2 }];
    }
    const users = /insert into public\.users\(id,name,role,pin_hash,active\) values\('([0-9a-f-]{36})'::uuid,'(SIM-0361-[0-9a-f-]{36})'/.exec(sql);
    if (users) { user = users[1]!; tag = users[2]!; return []; }
    if (sql.includes("as link_shop")) return scenario.lookup ? [scenario.lookup] : [];
    if (sql.includes("wait_event='PgSleep'")) return [{ ready: true }];
    if (sql.includes("pg_blocking_pids")) {
      const m = /r\.application_name = '([^']+)' and h\.application_name = '([^']+)'/.exec(sql)!;
      const racer = m[1]!, holder = m[2]!;
      const id = /-c(\w\w)-r$/.exec(racer)?.[1] ?? "";
      if (scenario.observerThrowsAt === id) throw new Error("observer transport broke");
      if (scenario.neverBlocked === id) return [];
      return [{ racer_pid: pidOf(racer), holder_pid: pidOf(holder) }];
    }
    if (sql.includes("from public.toast_employee_links")) return scenario.leftLink && !unlinked ? [{ id: LINK_ID }] : [];
    if (sql.includes("as stamp_epoch")) {
      const list = /time_entry_guid in \(([^)]*)\)/.exec(sql)![1]!.split(",").map((s) => s.replace(/'/g, ""));
      return list.map((key) => {
        const suffix = key.slice(tag.length + 1);
        const [deleted, closed, stamp] = FINAL[suffix]!;
        const linked = suffix === "c10" && !unlinked ? user : null;
        return { key, deleted, closed, stamp_epoch: ep(S.M[stamp as "m1" | "m2"]), user_id: linked };
      });
    }
    if (sql.includes("as total")) return [{ total: 15, live: 0 }];
    if (sql.includes("as active_left")) return [{ active_left: 0 }];
    const app = /set local application_name = '([^']+)'/.exec(sql)?.[1];
    if (app) {
      if (app.endsWith("-seed")) return answer(app, [full({ inserted: (sql.match(/"time_entry_guid"/g) ?? []).length })]);
      if (app.endsWith("-unlink")) { unlinked = true; return answer(app, [{ id: LINK_ID, changed: true, cleared: 1 }]); }
      const m = /-c(\w\w)-(h|r)$/.exec(app);
      if (m) {
        const id = m[1]!, role = m[2]!;
        const base = ANSWERS[id]!;
        let calls = role === "h" ? base.holder : base.racer;
        if (role === "r" && scenario.wrongCount === id) calls = [full({ inserted: 1 })];
        if (id === "09" && scenario.bothCommit9) calls = role === "h" ? [full({ updated: 1 }), full({ updated: 1 })] : [{ rows: 2 }];
        if (id === "8a" && role === "r" && scenario.racerDeadlock8a) calls = [{ sqlstate: "40P01" }];
        if (scenario.override?.id === id && scenario.override.role === role) calls = [scenario.override.ok, ...calls.slice(1)];
        return later(role === "h" ? (scenario.holderMs ?? 15) : (scenario.racerMs ?? 25), app, answer(app, calls));
      }
    }
    return [];
  };
  return { query, sent, events };
}
const instant: Opts = { sleep: async () => {}, pollMs: 0 };

describe("0361 two-session proof: orchestration against a scripted transport", () => {
  it("a good run passes every case, in order, and retires the fixture last", async () => {
    const t = transport();
    const lines: string[] = [];
    expect(await S.runProof(t.query, (l) => lines.push(l), instant)).toBe(0);
    const pass = lines.filter((l) => l.startsWith("PASS 0361 case "));
    expect(pass.map((l) => /^PASS 0361 case (\w+):/.exec(l)?.[1])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8a", "8b", "9", "10"]);
    expect(lines).toContain("PASS 0361 two-session proof: 11 cases");
    expect(lines.some((l) => l.startsWith("FAIL"))).toBe(false);
    expect(lines[0]).toMatch(/^FIXTURE allocated \{"shop":"[0-9a-f-]{36}","linkShop":"[0-9a-f-]{36}","user":"[0-9a-f-]{36}","tag":"SIM-0361-/);
    expect(lines.at(-1)).toMatch(/^RETIRED fixture SIM-0361-/);
    // Wire order: read-only preflight, the fixture insert, the seed, ..., the retirement last.
    expect(t.sent[0]).toContain("as has_guard");
    expect(t.sent[1]).toContain("insert into public.locations");
    expect(t.sent[2]).toContain("-seed'");
    expect(t.sent.at(-1)).toContain("as active_left");
    expect(t.sent.some((s) => /\bdelete\s+from\b|\btruncate\b|\bdrop\b/i.test(s))).toBe(false);
    // The link shop is switched on right before case 10, and case 10's link is retired with the real unlink.
    const activate = t.sent.findIndex((s) => s.includes("set active=true"));
    const c10 = t.sent.findIndex((s) => s.includes("-c10-h'"));
    expect(activate).toBeGreaterThan(-1); expect(activate).toBeLessThan(c10);
    const unlink = t.sent.find((s) => s.includes("-c10-unlink'"))!;
    expect(unlink).toContain(`public.unlink_toast_employee('`);
    expect(unlink).toContain(`'${LINK_ID}'::uuid`);
    // Every racer was launched only after its holder was seen in pg_sleep, and observed before judging.
    for (const id of ["01", "8a", "09", "10"]) {
      const h = t.sent.findIndex((s) => s.includes(`-c${id}-h'`));
      const ready = t.sent.findIndex((s, i) => i > h && s.includes("wait_event='PgSleep'"));
      const r = t.sent.findIndex((s) => s.includes(`-c${id}-r'`) && s.includes("begin isolation"));
      expect(h).toBeLessThan(ready); expect(ready).toBeLessThan(r);
    }
  });

  it("FAILS (exit 1, a fixed FAIL line naming the case) when the racer is never observed blocked, and still retires", async () => {
    const t = transport({ neverBlocked: "03" });
    const lines: string[] = [];
    expect(await S.runProof(t.query, (l) => lines.push(l), instant)).toBe(1);
    expect(lines).toContain("FAIL 0361 case 3: the racer was never observed blocked by the holder");
    expect(lines.some((l) => l.startsWith("PASS 0361 two-session proof"))).toBe(false);
    expect(lines.at(-1)).toMatch(/^RETIRED fixture/);
    expect(t.sent.at(-1)).toContain("as active_left");
  });

  it("FAILS when a count is wrong", async () => {
    const lines: string[] = [];
    expect(await S.runProof(transport({ wrongCount: "05" }).query, (l) => lines.push(l), instant)).toBe(1);
    expect(lines.find((l) => l.startsWith("FAIL 0361 case 5:"))).toContain("racer count");
  });

  it("FAILS when both sessions of the control (case 9) commit: the fixture did not deadlock", async () => {
    const lines: string[] = [];
    expect(await S.runProof(transport({ bothCommit9: true }).query, (l) => lines.push(l), instant)).toBe(1);
    expect(lines).toContain("FAIL 0361 case 9: no session reported its own 40P01 (the fixture did not deadlock)");
  });

  it("FAILS when case 8a's racer reports 40P01", async () => {
    const lines: string[] = [];
    expect(await S.runProof(transport({ racerDeadlock8a: true }).query, (l) => lines.push(l), instant)).toBe(1);
    expect(lines).toContain("FAIL 0361 case 8a: racer reported SQLSTATE 40P01");
  });

  it("refuses before any write when the guarded function is missing", async () => {
    const t = transport({ noGuard: true });
    const lines: string[] = [];
    expect(await S.runProof(t.query, (l) => lines.push(l), instant)).toBe(1);
    expect(t.sent).toHaveLength(1);
    expect(lines[0]).toContain("toast_time_entries_apply_newer(jsonb) is not installed");
  });

  it("retires nothing before BOTH sessions of a case have settled, even when the observer breaks", async () => {
    const t = transport({ observerThrowsAt: "01", holderMs: 40, racerMs: 60 });
    const lines: string[] = [];
    expect(await S.runProof(t.query, (l) => lines.push(l), instant)).toBe(1);
    expect(lines.some((l) => l.startsWith("FAIL 0361 case 1:"))).toBe(true);
    const retireAt = t.events.indexOf("retire:entries");
    const holderDone = t.events.findIndex((e) => /^done:.*-c01-h$/.test(e));
    const racerDone = t.events.findIndex((e) => /^done:.*-c01-r$/.test(e));
    expect(holderDone).toBeGreaterThan(-1); expect(racerDone).toBeGreaterThan(-1);
    expect(retireAt).toBeGreaterThan(holderDone); expect(retireAt).toBeGreaterThan(racerDone);
  });

  it("end to end through main(): every request goes to the sim Management URL with redirect 'error'; the token is never logged", async () => {
    const t = transport();
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const fetcher = vi.fn<Fetcher>(async (_url, init) => {
      const rows = await t.query((JSON.parse(init.body ?? "{}") as { query: string }).query);
      return { ok: true, status: 200, json: async () => rows };
    });
    const lines: string[] = [];
    expect(await S.main([`--ref=${SIM}`], { SUPABASE_ACCESS_TOKEN: TOKEN }, (l) => lines.push(l), { ...instant, fetcher })).toBe(0);
    expect(fetcher.mock.calls.length).toBeGreaterThan(20);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe(S.MANAGEMENT_URL);
      expect(init.redirect).toBe("error");
    }
    expect(globalFetch).not.toHaveBeenCalled();
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines).toContain("PASS 0361 two-session proof: 11 cases");
  });

  it("--rest: one real-path rpc pair through an injected client (inserted, then unchanged), retired with the rest", async () => {
    const t = transport();
    const rpc = vi.fn<RestClient["rpc"]>()
      .mockResolvedValueOnce({ data: full({ inserted: 1 }), error: null })
      .mockResolvedValueOnce({ data: full({ unchanged: 1 }), error: null });
    const lines: string[] = [];
    expect(await S.runProof(t.query, (l) => lines.push(l), { ...instant, rest: true, restClient: async () => ({ rpc }) })).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(2);
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("toast_time_entries_apply_newer");
    expect(Array.isArray(args.p_rows)).toBe(true);
    expect(args.p_rows[0]?.time_entry_guid).toMatch(/^SIM-0361-[0-9a-f-]{36}-rest$/);
    expect(args.p_rows[0]?.business_date).toMatch(/^2001-/);
    expect(rpc.mock.calls[1]![1]).toEqual(args);
    expect(lines.some((l) => l.startsWith("PASS 0361 rest:"))).toBe(true);
    const failing = vi.fn<RestClient["rpc"]>().mockResolvedValue({ data: null, error: { code: "42501" } });
    const bad: string[] = [];
    expect(await S.runProof(transport().query, (l) => bad.push(l), { ...instant, rest: true, restClient: async () => ({ rpc: failing }) })).toBe(1);
    expect(bad).toContain("FAIL 0361 rest: rest call 1 refused (42501)");
  });

  it("--retire refuses a shop without its SIM-0361 tag, and retires a tagged one (real unlink first)", async () => {
    const shop = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const fetchFor = (t: ReturnType<typeof transport>) => vi.fn<Fetcher>(async (_url, init) => {
      const rows = await t.query((JSON.parse(init.body ?? "{}") as { query: string }).query);
      return { ok: true, status: 200, json: async () => rows };
    });
    const untagged = transport({ lookup: { id: shop, name: "Capitol Mocko", code: "CAP" } });
    const lines: string[] = [];
    expect(await S.main([`--ref=${SIM}`, `--retire=${shop}`], { SUPABASE_ACCESS_TOKEN: TOKEN }, (l) => lines.push(l), { fetcher: fetchFor(untagged) })).toBe(2);
    expect(lines[0]).toMatch(/^REFUSED: shop .* does not carry its SIM-0361- tag/);
    expect(untagged.sent).toHaveLength(1);
    expect(untagged.sent.some((s) => /\bupdate\b/i.test(s))).toBe(false);

    const tag = `SIM-0361-${shop}`;
    const tagged = transport({ leftLink: true, lookup: { id: shop, name: tag, code: tag, link_shop: LINK_ID, user_id: "99999999-8888-4777-8666-555555555555" } });
    const ok: string[] = [];
    expect(await S.main([`--ref=${SIM}`, `--retire=${shop}`], { SUPABASE_ACCESS_TOKEN: TOKEN }, (l) => ok.push(l), { fetcher: fetchFor(tagged) })).toBe(0);
    const unlinkAt = tagged.sent.findIndex((s) => s.includes("public.unlink_toast_employee("));
    const entriesAt = tagged.sent.findIndex((s) => s.includes("set deleted=true"));
    expect(unlinkAt).toBeGreaterThan(-1); expect(unlinkAt).toBeLessThan(entriesAt);
    expect(tagged.sent.find((s) => s.includes("set deleted=true"))).toContain(`time_entry_guid like '${tag}-%'`);
    expect(ok.at(-1)).toMatch(new RegExp(`^RETIRED fixture ${tag}: \\d+ time entries marked deleted, 1 link`));
    expect(tagged.sent.some((s) => /\bdelete\s+from\b|\btruncate\b/i.test(s))).toBe(false);
  });
});

describe("0361 two-session proof: a guarded answer is judged as strictly as lib/toast/labor.ts parseLaborGuardCounts", () => {
  // Case 1: the holder inserts (expected inserted 1), the racer is skipped as older (expected skipped_older 1).
  const holder1 = full({ inserted: 1 });
  const racer1 = full({ skipped_older: 1 });
  const without = (o: Record<string, number>, key: string): Record<string, number> =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
  const malformed: Array<{ name: string; role: "h" | "r"; ok: Record<string, unknown>; line: string }> = [
    { name: "inserted as the string \"1\"", role: "h", ok: { ...holder1, inserted: "1" },
      line: "FAIL 0361 case 1: holder call 1 answer count inserted is not a non-negative integer" },
    { name: "an expected zero as null", role: "r", ok: { ...racer1, updated: null },
      line: "FAIL 0361 case 1: racer answer count updated is not a non-negative integer" },
    { name: "a missing key", role: "r", ok: without(racer1, "duplicates"),
      line: "FAIL 0361 case 1: racer answer lacks the key duplicates" },
    { name: "an extra key", role: "r", ok: { ...racer1, extra: 0 },
      line: "FAIL 0361 case 1: racer answer carries an unexpected key" },
    { name: "a fractional count", role: "r", ok: { ...racer1, skipped_older: 1.5 },
      line: "FAIL 0361 case 1: racer answer count skipped_older is not a non-negative integer" },
    { name: "received not the sum", role: "r", ok: { ...racer1, received: 2 },
      line: "FAIL 0361 case 1: racer answer received is not the sum of the other counts" },
  ];
  for (const m of malformed) {
    it(`FAILS the run when a guarded answer carries ${m.name}`, async () => {
      const lines: string[] = [];
      expect(await S.runProof(transport({ override: { id: "01", role: m.role, ok: m.ok } }).query, (l) => lines.push(l), instant)).toBe(1);
      expect(lines).toContain(m.line);
      expect(lines.some((l) => l.startsWith("PASS 0361 two-session proof"))).toBe(false);
      expect(lines.at(-1)).toMatch(/^RETIRED fixture/);
    });
  }

  it("the unchanged happy path still passes with the strict judge", async () => {
    const lines: string[] = [];
    expect(await S.runProof(transport().query, (l) => lines.push(l), instant)).toBe(0);
    expect(lines).toContain("PASS 0361 two-session proof: 11 cases");
  });

  it("--rest answers go through the same strict judge", async () => {
    const rpc = vi.fn<RestClient["rpc"]>()
      .mockResolvedValueOnce({ data: { ...full({ inserted: 1 }), inserted: "1" }, error: null });
    const lines: string[] = [];
    expect(await S.runProof(transport().query, (l) => lines.push(l), { ...instant, rest: true, restClient: async () => ({ rpc }) })).toBe(1);
    expect(lines).toContain("FAIL 0361 rest: rest call 1 answer count inserted is not a non-negative integer");
  });

  it("guardCountsViolation: each malformed shape is named; a well-formed answer is null", () => {
    const good = full({ updated: 2 });
    expect(S.guardCountsViolation(good)).toBeNull();
    expect(S.guardCountsViolation(full({}))).toBeNull();
    expect(S.guardCountsViolation(null)).toBe("is not an object");
    expect(S.guardCountsViolation(undefined)).toBe("is not an object");
    expect(S.guardCountsViolation([good])).toBe("is not an object");
    expect(S.guardCountsViolation("{}")).toBe("is not an object");
    expect(S.guardCountsViolation({ ...good, updated: "2" })).toBe("count updated is not a non-negative integer");
    expect(S.guardCountsViolation({ ...good, inserted: null })).toBe("count inserted is not a non-negative integer");
    expect(S.guardCountsViolation({ ...good, inserted: 1.5, received: 3.5 })).toBe("count received is not a non-negative integer");
    expect(S.guardCountsViolation({ ...good, unchanged: 0.5, received: 2.5 })).toBe("count received is not a non-negative integer");
    expect(S.guardCountsViolation({ ...good, skipped_older: 1.5 })).toBe("count skipped_older is not a non-negative integer");
    expect(S.guardCountsViolation({ ...good, duplicates: -1, received: 1 })).toBe("count duplicates is not a non-negative integer");
    expect(S.guardCountsViolation({ ...good, duplicates: Number.NaN })).toBe("count duplicates is not a non-negative integer");
    expect(S.guardCountsViolation({ ...good, duplicates: Number.MAX_SAFE_INTEGER + 1 })).toBe("count duplicates is not a non-negative integer");
    expect(S.guardCountsViolation(without(good, "skipped_no_stamp"))).toBe("lacks the key skipped_no_stamp");
    expect(S.guardCountsViolation({ ...good, rows: 2 })).toBe("carries an unexpected key");
    expect(S.guardCountsViolation({ ...good, received: 3 })).toBe("received is not the sum of the other counts");
  });

  it("judgeCounts: the strict shape is checked before the comparison, and the comparison is exact", () => {
    const want = S.counts({ inserted: 1 });
    expect(S.judgeCounts("seed", { ok: full({ inserted: 1 }) }, want)).toBeNull();
    expect(S.judgeCounts("seed", { ok: { ...full({ inserted: 1 }), inserted: "1" } }, want)).toBe("seed answer count inserted is not a non-negative integer");
    expect(S.judgeCounts("seed", { ok: { ...full({ inserted: 1 }), updated: null } }, want)).toBe("seed answer count updated is not a non-negative integer");
    expect(S.judgeCounts("seed", { ok: null }, want)).toBe("seed answer is not an object");
    expect(S.judgeCounts("seed", { ok: full({ updated: 1 }) }, want)).toBe("seed count inserted is not 1");
    expect(S.judgeCounts("seed", { missing: true }, want)).toBe("seed answer missing");
    expect(S.judgeCounts("seed", { sqlstate: "40P01", code: null }, want)).toBe("seed reported SQLSTATE 40P01");
  });

  it("a guarded answer carried through the session setting (jsonb text) parses to JSON numbers and passes", () => {
    const name = "SIM-0361-x-c01-r";
    const text = `{"ok": {"inserted": 0, "received": 1, "updated": 0, "unchanged": 0, "duplicates": 0, "skipped_older": 1, "skipped_no_stamp": 0, "skipped_same_stamp": 0}, "tag": "${name}"}`;
    const parsed = S.parseSession([{ s1: text, pid: 7 }], name, 1);
    expect(parsed).not.toBeNull();
    expect(S.judgeCounts("racer", parsed?.calls[0], S.counts({ skipped_older: 1 }))).toBeNull();
  });
});
