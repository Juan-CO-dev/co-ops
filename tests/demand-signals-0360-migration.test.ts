/**
 * Migration 0360 (the Demand AI monthly ceiling: $5.00 to $50.00, Juan 2026-11-27) pinned BY NAME. CC applies sim then
 * prod; nothing here touches a database (the PGlite proof is tests/demand-signals-0360-harness.test.ts).
 *
 * Pins: the house header and gate line; one transaction; the only 0360; exactly ONE function re-emitted and nothing
 * else touched; the re-emit is 0352's statement with two differences (the verb, the number); the privileges restated in
 * 0358's form; every fingerprint written in the file is the real one, recomputed from the two files; the two copies
 * of the catalog digest are the same text; and THE TIE: the app's DEMAND_AI_CODE_CAP_MICRO is the number in this file.
 * Also the reason the per-reservation bound (0352, 5,000,000) is not raised: one call's worst case is far below it.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  AI_PRICES, DEMAND_AI_CODE_CAP_MICRO, DEMAND_AI_MAX_INPUT_BYTES, DEMAND_AI_MAX_OUTPUT_TOKENS, aiConfig, worstCaseMicro,
} from "@/lib/demand-signals/insights-shared";

const NAME = "0360_demand_ai_cap";
const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8").replace(/\r\n/g, "\n");
const sql = read(NAME);
const sql0352 = read("0352_demand_ai_insights");
const strip = (text: string) => text.replace(/--[^\n]*/g, "");
const code = strip(sql);
/** The code with every SQL string literal emptied: a word inside an exception message is not a statement. */
const bare = (() => {
  // One pass over the RAW file, because a "--" inside a message is not a comment and an apostrophe inside a comment
  // is not a quote: outside a literal `--` runs to the end of the line; a literal runs to its closing quote ('' = one quote).
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") i++; out += "\n"; continue; }
    if (sql[i] === "'") {
      i++;
      while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
      out += "''";
      continue;
    }
    out += sql[i];
  }
  return out;
})();
/** What Postgres stores as `prosrc`: the text between the function's dollar quotes, comments and all (never stripped). */
const body = (text: string, name: string) => {
  const m = text.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([^)]*\\)[^$]*\\$\\$([\\s\\S]*?)\\$\\$;`));
  if (!m) throw new Error(`${name} not found`);
  return m[1]!;
};
/** The whole CREATE statement of the ceiling function. */
const ceilingStatement = (text: string) => {
  const m = strip(text).match(/create (?:or replace )?function public\.demand_ai_cap_ceiling_micro\(\)[^$]*\$\$[\s\S]*?\$\$;/);
  if (!m) throw new Error("ceiling statement not found");
  return m[0];
};
/** The 0354 convention: md5 of the body with every non-printing character removed. */
const fingerprint = (text: string) => createHash("md5").update(text.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
/** The EXACT fingerprint: only line breaks (and the whitespace around them) normalized, every in-line character kept. */
const exactFingerprint = (text: string) => createHash("md5").update(text.replace(/\s*[\r\n]+\s*/g, "\n").replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""), "utf8").digest("hex");
const count = (text: string, needle: string) => text.split(needle).length - 1;

const NEW_MICRO = 50_000_000, OLD_MICRO = 5_000_000;

describe("0360 header and shape", () => {
  it("gate header, one transaction, the number explained", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe(`-- Migration ${NAME}`);
    expect(lines[1]).toBe("-- AUTHORED 2026-11-27 (demand AI cap raise, CO CC Fable lead, for CC). NOT YET APPLIED -- GATE CC/JUAN: sim first, then prod on Juan's word.");
    // An APPLIED stamp goes UNDER the gate line, never instead of it.
    const stamps = lines.slice(2, 6).filter((l) => /^-- APPLIED /.test(l));
    // (0352's own prod stamp carries a trailing sentence after the bracket; that style is allowed here too.)
    expect(stamps.every((l) => new RegExp(`^-- APPLIED TO (PROD|SIM) \\d{4}-\\d{2}-\\d{2}( UTC)? \\(schema_migrations version \\d{14}, name '${NAME}'\\)([,.;] .*)?$`).test(l))).toBe(true);
    expect(stamps.length).toBeGreaterThanOrEqual(1);   // the sim stamp is there
    expect(sql).toMatch(/0360 is claimed there for this one/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(code.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
    expect(code.split("\n").find((l) => l.trim())).toBe("begin;");
  });

  it("is the ONLY file numbered 0360, and 0352's file still carries its own number", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("0360_"))).toEqual([`${NAME}.sql`]);
    expect(body(sql0352, "demand_ai_cap_ceiling_micro")).toBe(`\n  select ${OLD_MICRO}::bigint\n`);
    // 0352 was applied on 2026-11-20 and is never edited: its header still says $5.00.
    expect(sql0352).toMatch(/demand_ai_cap_ceiling_micro\(\) \(5,000,000 = \$5\.00\n-- a month\)/);
  });

  it("re-emits exactly ONE function and touches nothing else", () => {
    expect(code.match(/create\s+(or\s+replace\s+)?function/gi)).toHaveLength(1);
    expect(code).toMatch(/create or replace function public\.demand_ai_cap_ceiling_micro\(\) returns bigint language sql immutable set search_path = pg_catalog, public as \$\$/);
    // No table, column, row, policy, trigger, index, type, sequence, comment or other function; no PostgREST reload.
    expect(bare).not.toMatch(/\b(create|alter|drop)\s+(table|index|unique|policy|trigger|type|sequence|view|materialized|schema|role|extension)\b/i);
    expect(bare).not.toMatch(/\balter\s+function\b|\bdrop\s+function\b|\bcomment\s+on\b|\btruncate\b|\bnotify\b|\bsecurity\s+definer\b/i);
    expect(bare).not.toMatch(/\binsert\s+into\b|\bdelete\s+from\b|\bupdate\s+\w|\bcopy\s/i);
    expect(bare).not.toMatch(/\bexecute\s+(format|'|\$)/i);   // no dynamic SQL
    // The only statements outside the two DO blocks: begin, the function, the revoke, the grant, commit.
    const outside = code.replace(/do \$\$[\s\S]*?end \$\$;/g, "").replace(/create or replace function[\s\S]*?\n\$\$;/, "FUNCTION;");
    expect(outside.split(";").map((s) => s.trim()).filter(Boolean)).toEqual([
      "begin", "FUNCTION",
      "revoke all on function public.demand_ai_cap_ceiling_micro() from public, anon, authenticated",
      "grant execute on function public.demand_ai_cap_ceiling_micro() to service_role",
      "commit",
    ]);
    expect(code.match(/do \$\$/g)).toHaveLength(2);
    // Each DO block writes nothing but its two transaction-local settings (the pre-flight) or nothing at all.
    expect(code.match(/set_config\('co_ops\.m0360_(fn|public)_before', [\s\S]*?, true\)/g)).toHaveLength(2);
    expect(count(code, "set_config(")).toBe(2);
  });

  it("the re-emit is 0352's statement with exactly two differences: the verb and the number", () => {
    const was = ceilingStatement(sql0352), now = ceilingStatement(sql);
    expect(was.startsWith("create function ")).toBe(true);
    expect(now.startsWith("create or replace function ")).toBe(true);
    expect(now.replace("create or replace function ", "create function ")).toBe(was.replace(`${OLD_MICRO}::bigint`, `${NEW_MICRO}::bigint`));
    expect(count(was, String(OLD_MICRO))).toBe(1);
    expect(body(sql, "demand_ai_cap_ceiling_micro")).toBe(`\n  select ${NEW_MICRO}::bigint\n`);
  });
});

describe("0360: the fingerprints in the file are the real ones", () => {
  const oldBody = body(sql0352, "demand_ai_cap_ceiling_micro"), newBody = body(sql, "demand_ai_cap_ceiling_micro");
  it("the body it replaces (0352's) and the body it writes, by both fingerprints, in the code and in the header", () => {
    const pairs: Array<[string, string, number]> = [
      [fingerprint(oldBody), exactFingerprint(oldBody), 1],     // the pre-flight's "must be 0352's"
      [fingerprint(newBody), exactFingerprint(newBody), 2],     // the pre-flight's "already applied" and the assertion
    ];
    expect(pairs.map((p) => [p[0], p[1]])).toEqual([
      ["49a1a404ee56db730709500d5fe93f75", "1ab3425fc64bd3d111fb014488d8cffa"],
      ["9b5eeb4964ab11ee7ee3242c3dc3d64d", "e501588e358cf93f888cbcb4d4b21fb5"],
    ]);
    for (const [house, exact, times] of pairs) {
      expect(count(code, `'${house}'`), house).toBe(times);
      expect(count(code, `'${exact}'`), exact).toBe(times);
      // And once each in the header's read-only pre-flight / verify queries.
      expect(count(sql, `-- ${house}`), house).toBe(1);
      expect(count(sql, `-- ${exact}`), exact).toBe(1);
    }
    expect(fingerprint(oldBody)).not.toBe(fingerprint(newBody));
    // The header's queries are the code's own expressions.
    expect(sql).toMatch(/select md5\(regexp_replace\(prosrc, '\[\^\\x21-\\x7E\]\+', '', 'g'\)\) from pg_proc where oid = 'public\.demand_ai_cap_ceiling_micro\(\)'::regprocedure; -- 49a1a404/);
    expect(code).toContain(String.raw`md5(regexp_replace(p.prosrc, '[^\x21-\x7E]+', '', 'g'))`);
    expect(code).toContain(String.raw`md5(btrim(regexp_replace(p.prosrc, '\s*[\r\n]+\s*', E'\n', 'g'), E' \t\r\n'))`);
  });

  it("the code that ENFORCES the ceiling is pinned to 0352's bodies: the reserve, the month's accounting, the reader", () => {
    for (const [name, sig] of [["demand_ai_month_spent_micro", "date"], ["demand_ai_reserve", "uuid,uuid,text,text,integer,bigint,bigint"], ["demand_ai_today", "uuid"]] as const) {
      const b = body(sql0352, name);
      expect(code, name).toContain(`('${name}(${sig})', '${fingerprint(b)}', '${exactFingerprint(b)}')`);
    }
    // What those bodies do with the ceiling, read from 0352's file: the reserve refuses a cap above it; the reader reports it.
    expect(body(sql0352, "demand_ai_reserve")).toContain("or p_cap_micro > public.demand_ai_cap_ceiling_micro() then raise exception 'demand_ai_invalid'");
    expect(body(sql0352, "demand_ai_reserve")).toContain("if v_spent + p_reserve_micro > p_cap_micro then raise exception 'demand_ai_cap_reached'");
    expect(body(sql0352, "demand_ai_today")).toContain("'cap_ceiling_micro', public.demand_ai_cap_ceiling_micro()");
    // The ceiling function is read by exactly those two places in 0352, and by no migration BEFORE 0360 other than 0352
    // (so 0360 re-emits from the only definer there was). A LATER migration may name it: the header's own rollback is one.
    expect(count(strip(sql0352), "demand_ai_cap_ceiling_micro()")).toBe(1 + 2 + 2);   // its CREATE, the two readers, the two privilege lists
    const others = readdirSync("supabase/migrations").filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) < 360 && !f.startsWith("0352_"));
    expect(others.length).toBeGreaterThan(300);
    for (const f of others) expect(strip(readFileSync(`supabase/migrations/${f}`, "utf8")), f).not.toContain("demand_ai_cap_ceiling_micro");
  });
});

describe("0360: privileges, assertions and the digest", () => {
  it("restates the privileges in 0358's form and never removes service_role's grant", () => {
    expect(code).toContain("revoke all on function public.demand_ai_cap_ceiling_micro() from public, anon, authenticated;");
    expect(code).toContain("grant execute on function public.demand_ai_cap_ceiling_micro() to service_role;");
    expect(code.match(/\brevoke\b/gi)).toHaveLength(1);
    expect(code.match(/\bgrant execute\b/gi)).toHaveLength(1);
    expect(code).not.toMatch(/revoke[^;]*service_role/i);
    expect(code.indexOf("create or replace function")).toBeLessThan(code.indexOf("revoke all on function"));
    expect(code.indexOf("grant execute on function")).toBeLessThan(code.lastIndexOf("do $$"));
  });

  it("both DO blocks check the owner and the WHOLE ACL of all six 0352 functions, NULL ACLs included", () => {
    const blocks = code.match(/do \$\$[\s\S]*?end \$\$;/g)!;
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      for (const f of ["demand_ai_cap_ceiling_micro()", "demand_ai_month_spent_micro(date)", "demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)",
        "demand_ai_claims_valid(jsonb)", "demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)", "demand_ai_today(uuid)"]) {
        expect(b).toContain(`'public.${f}'::regprocedure`);
      }
      expect(b).toContain("is distinct from 'postgres'");
      expect(b).toContain("foreach r in array array['public', 'anon', 'authenticated'] loop");
      expect(b).toContain("if not has_function_privilege('service_role', f, 'EXECUTE')");
      expect(b).toContain("aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))");
      // THE WHOLE ACL, the owner's own entry and every grantor included (review, Astra P2 / Opus P3).
      expect(b).toContain("|| '/' || a.grantor::regrole::text as e");
      expect(b).toContain("where p.oid = f) x;");
      expect(b).not.toContain("a.grantee <> p.proowner");
      expect(b).toContain("if v_acl is distinct from 'postgres=EXECUTE/postgres,service_role=EXECUTE/postgres'");
      // WHAT EACH OF THE SIX IS (review, Astra P2), with a NULL-safe settings check.
      for (const row of ["('demand_ai_cap_ceiling_micro()', 'sql:i:f:bigint:0')", "('demand_ai_month_spent_micro(date)', 'sql:s:t:bigint:1')",
        "('demand_ai_reserve(uuid,uuid,text,text,integer,bigint,bigint)', 'plpgsql:v:t:jsonb:7')", "('demand_ai_claims_valid(jsonb)', 'plpgsql:i:f:boolean:1')",
        "('demand_ai_settle(uuid,text,integer,integer,bigint,text,text,jsonb,integer)', 'plpgsql:v:t:jsonb:9')", "('demand_ai_today(uuid)', 'plpgsql:v:t:jsonb:1')"]) expect(b).toContain(row);
      expect(b).toContain("p.prokind = 'f' and not p.proretset and p.prosqlbody is null and not p.proisstrict and not p.proleakproof and p.proparallel = 'u'");
      expect(b).toContain("p.proconfig is not null and array_length(p.proconfig, 1) = 1 and replace(p.proconfig[1], ' ', '') = 'search_path=pg_catalog,public'");
      expect(b).toContain("if v_now is distinct from v_shape then");
    }
    // The shape / owner / ACL checks are ONE text in two places.
    const shapes = [...sql.matchAll(/-- SHAPE-BEGIN[^\n]*\n([\s\S]*?)\n\s*-- SHAPE-END/g)].map((m) => m[1]!);
    expect(shapes).toHaveLength(2);
    expect(shapes[0]).toBe(shapes[1]);
    // What 0352 declared, read from 0352's own CREATE statements: the six shape rows are not typed from memory.
    for (const [name, want] of [["demand_ai_cap_ceiling_micro", "returns bigint language sql immutable set search_path = pg_catalog, public as"],
      ["demand_ai_month_spent_micro", "returns bigint\nlanguage sql stable security definer set search_path = pg_catalog, public as"],
      ["demand_ai_reserve", "returns jsonb language plpgsql security definer set search_path = pg_catalog, public as"],
      ["demand_ai_claims_valid", "returns boolean language plpgsql immutable set search_path = pg_catalog, public as"],
      ["demand_ai_settle", "returns jsonb language plpgsql security definer set search_path = pg_catalog, public as"],
      ["demand_ai_today", "returns jsonb\nlanguage plpgsql security definer set search_path = pg_catalog, public as"]] as const) {
      const head = sql0352.match(new RegExp(`create function public\\.${name}\\(([^$]*?)\\$\\$`))![1]!.replace(/\s+/g, " ");
      expect(head, name).toContain(want.replace(/\s+/g, " "));
    }
    // 0352's own six, in 0352's own words.
    for (const f of [...strip(sql0352).matchAll(/'(public\.demand_ai_\w+\([^)]*\))'::regprocedure/g)].map((m) => m[1]!)) expect(code).toContain(`'${f}'::regprocedure`);
  });

  it("the pre-flight refuses by name; the assertions compare with IS DISTINCT FROM and require the stash", () => {
    const [pre, post] = code.match(/do \$\$[\s\S]*?end \$\$;/g)!;
    expect(pre).toContain("raise exception '0360: already applied'");
    // (`code` has comments stripped, and the strip cuts a message at its own "--": the raw file carries the whole sentence.)
    expect(pre).toMatch(/is not its 0352 definition/);
    expect(sql).toContain("is not its 0352 definition -- a later definer exists; re-emit from it. Refusing.', v_house, v_exact;");
    expect(pre).toContain("if public.demand_ai_cap_ceiling_micro() is distinct from 5000000 then");
    expect(pre).toContain("has more than one overload. Refusing.");
    expect(pre.indexOf("already applied")).toBeLessThan(pre.indexOf("is not its 0352 definition"));
    // A database that RECORDS 0360 with 0352's body back is never raised a second time (review, Astra P2). The ledger is
    // read only where it exists, and only after the two body checks.
    expect(pre).toContain("if to_regclass('supabase_migrations.schema_migrations') is not null then\n    if exists (select 1 from supabase_migrations.schema_migrations m where m.name = '0360_demand_ai_cap') then");
    expect(pre).toContain("raise exception '0360: already recorded as applied, and the live body is 0352''s again");
    expect(pre.indexOf("is not its 0352 definition")).toBeLessThan(pre.indexOf("already recorded as applied"));
    expect(pre.indexOf("already recorded as applied")).toBeLessThan(pre.indexOf("is distinct from 5000000"));
    expect(post).not.toContain("supabase_migrations");
    // The per-reservation bound is named, read through pg_get_constraintdef (never a stored node tree against a literal).
    expect(pre).toContain(String.raw`regexp_replace(pg_get_constraintdef(co.oid), '[\s()]', '', 'g') = 'CHECKreserved_micro>=1ANDreserved_micro<=5000000'`);
    expect(post).toContain("if public.demand_ai_cap_ceiling_micro() is distinct from 50000000");
    expect(post).toContain("pg_typeof(public.demand_ai_cap_ceiling_micro()) is distinct from 'bigint'::regtype");
    for (const key of ["co_ops.m0360_fn_before", "co_ops.m0360_public_before"]) {
      expect(pre).toContain(`perform set_config('${key}'`);
      expect(post).toContain(`v_before := current_setting('${key}', true);\n  if v_before is null or v_before = '' then raise exception`);
    }
    expect(post).toContain("if v_now is distinct from v_before then");
    expect(post).toContain("if v_digest is distinct from v_before then");
    expect(post).toContain("(public.demand_ai_today('00000000-0000-0000-0000-000000000000'::uuid) ->> 'cap_ceiling_micro') is distinct from '50000000'");
    // No bare <> or = comparison of a value that could be NULL decides an assertion about the stash.
    expect(post).not.toMatch(/v_(now|digest) (<>|!=) v_before/);
  });

  it("the catalog digest is ONE text in two places, ordered, and excludes the one function by oid (never a name)", () => {
    const copies = [...sql.matchAll(/-- DIGEST-BEGIN[^\n]*\n([\s\S]*?)\n\s*-- DIGEST-END/g)].map((m) => m[1]!);
    expect(copies).toHaveLength(2);
    expect(copies[0]).toBe(copies[1]);
    const digest = copies[0]!;
    expect(digest).toContain("from pg_proc p where p.pronamespace = 'public'::regnamespace and p.oid <> v_fn");
    for (const key of ["fn", "rel", "col", "def", "pol", "trg", "con", "idx", "rul", "typ", "enm", "seq", "cmt", "nsp"]) expect(digest, key).toContain(`'${key}:' ||`);
    // Every aggregate has an explicit order (a string_agg without one can differ on identical catalogs).
    const aggs = digest.match(/string_agg\(/g)!;
    expect(aggs).toHaveLength(13);
    expect(digest.match(/'\|'\s+order by /g)).toHaveLength(13);
    // WHOLE catalog rows, minus exactly the columns other sessions' maintenance moves (named in the header too). Outside
    // those two exclusion lists none of them is mentioned.
    const REL_OUT = "to_jsonb(c) - array['reltuples', 'relpages', 'relallvisible', 'relallfrozen', 'relfrozenxid',\n                  'relminmxid', 'relfilenode', 'relhasindex', 'relhasrules', 'relhastriggers', 'relhassubclass']";
    const IDX_OUT = "to_jsonb(i) - array['indisvalid', 'indisready', 'indislive', 'indcheckxmin']";
    expect(digest).toContain(REL_OUT);
    expect(digest).toContain(IDX_OUT);
    expect(digest.replace(REL_OUT, "").replace(IDX_OUT, "")).not.toMatch(/reltuples|relpages|relallvisible|relallfrozen|relfrozenxid|relminmxid|relfilenode|relhas|indisvalid|indisready|indislive|indcheckxmin|last_value|attstattarget|attmissingval/);
    for (const whole of ["to_jsonb(p)::text", "to_jsonb(d)::text", "to_jsonb(po)::text", "to_jsonb(tg)::text", "to_jsonb(co)::text", "to_jsonb(rw)::text", "to_jsonb(ty)::text",
      "to_jsonb(en)::text", "to_jsonb(sq)::text"]) expect(digest, whole).toContain(whole);
    // pg_attribute by a named list (its missing-value column is a pseudo-type): storage and compression are in it (review, Astra P2).
    for (const col of ["a.attstorage", "a.attcompression", "a.attlen", "a.attalign", "a.attbyval", "a.attndims", "a.atthasmissing", "a.attislocal", "a.attinhcount", "a.attfdwoptions::text",
      "a.attnotnull", "a.atthasdef", "a.attidentity", "a.attgenerated", "a.attisdropped", "a.attcollation", "a.attacl::text", "a.attoptions::text"]) expect(digest, col).toContain(col);
    // The header says the same thing the SQL does: every excluded column is named there.
    for (const colName of ["reltuples", "relpages", "relallvisible", "relallfrozen", "relfrozenxid", "relminmxid", "relfilenode", "relhasindex", "relhasrules", "relhastriggers", "relhassubclass",
      "indisvalid", "indisready", "indislive", "indcheckxmin"]) expect(sql.split("\nbegin;\n")[0], colName).toContain(colName);
    // Raw catalog columns only: no pg_get_*def call (the one in the pre-flight is on the reservation check, outside the digest).
    expect(digest).not.toMatch(/pg_get_\w+/);
    expect(count(code, "pg_get_constraintdef(")).toBe(1);
  });

  it("names no sales classifier or fact object (the item-21 pin scans every migration from 0343 on)", () => {
    expect(code).not.toMatch(/\b(sales_report_class|sales_report_facts|sales_report_daily|fact_sales_\w+|fact_order_\w+|business_report_\w+|sales_report_catering_values)\b/);
  });
});

describe("0360: the app's cap and the database's ceiling are the same number", () => {
  it("DEMAND_AI_CODE_CAP_MICRO = the literal in 0360 = 50,000,000 ($50.00); 0352's was 5,000,000", () => {
    const now = Number(body(sql, "demand_ai_cap_ceiling_micro").match(/select (\d+)::bigint/)![1]);
    const was = Number(body(sql0352, "demand_ai_cap_ceiling_micro").match(/select (\d+)::bigint/)![1]);
    expect(now).toBe(NEW_MICRO);
    expect(was).toBe(OLD_MICRO);
    expect(DEMAND_AI_CODE_CAP_MICRO).toBe(now);
    expect(DEMAND_AI_CODE_CAP_MICRO / 1_000_000).toBe(50);
    // The assertion in the file and the reader's check carry the same number.
    const source = readFileSync("lib/demand-signals/insights-shared.ts", "utf8");
    expect(source).toMatch(/\$50\.00[^\n]*0360[^\n]*\*\/\nexport const DEMAND_AI_CODE_CAP_MICRO = 50_000_000;/);
  });

  it("the environment can still only lower it, and $50.00 is a value it can name", () => {
    const cap = (monthlyCapCents: string | undefined) => aiConfig({ enabled: "1", apiKey: "k-test", model: undefined, monthlyCapCents }).capMicro;
    expect(cap(undefined)).toBe(NEW_MICRO);
    expect(cap("5000")).toBe(NEW_MICRO);
    expect(cap("4999")).toBe(NEW_MICRO - 10_000);
    expect(cap("500")).toBe(OLD_MICRO);
    expect(cap("999999")).toBe(NEW_MICRO);
    expect(cap("50.00")).toBe(0);
  });

  it("THE PER-RESERVATION BOUND STAYS: 0352's check is 1 to 5,000,000 and one call's worst case is far below it", () => {
    expect(strip(sql0352)).toContain("reserved_micro bigint not null check (reserved_micro between 1 and 5000000)");
    expect(code).not.toMatch(/reserved_micro\s+between|add\s+constraint|drop\s+constraint/i);
    const worst = Object.keys(AI_PRICES).map((model) => worstCaseMicro(model, DEMAND_AI_MAX_INPUT_BYTES)!);
    expect(worst.every((w) => Number.isInteger(w) && w > 0)).toBe(true);
    // (16,000 bytes + 1,024) x 4 + 2,000 x 20 on the dearest priced model: the number the migration's header gives.
    expect(DEMAND_AI_MAX_INPUT_BYTES).toBe(16_000);
    expect(DEMAND_AI_MAX_OUTPUT_TOKENS).toBe(2_000);
    expect(Math.max(...worst)).toBe(108_096);
    expect(Math.max(...worst) * 46).toBeLessThan(OLD_MICRO);
    expect(sql).toContain("(16,000 bytes + 1,024) x 4 + 2,000 x 20 = 108,096 microdollars");
  });

  it("the deploy order is written where a person will read it", () => {
    expect(sql).toMatch(/-- DEPLOY ORDER: THIS FILE FIRST, THEN THE APP\. Never the other way round\./);
    const runbook = readFileSync("docs/runbooks/demand-ai.md", "utf8");
    expect(runbook).toMatch(/Migration 0360 applied \(the \$50\.00 limit\) \| CC, \*\*BEFORE the app that carries the \$50\.00 limit is deployed\*\*/);
    expect(runbook).toContain("It can only LOWER the built-in limit of $50.00 a month");
    expect(runbook).not.toMatch(/of at most \$5\.00/);
    // The app-first refusal is stated for the cap the app ASKS for (with the environment value at 500 or less it is admitted).
    expect(sql).toMatch(/refuses EVERY request whose cap is above 5,000,000 with demand_ai_invalid/);
    expect(runbook).toMatch(/unless `DEMAND_AI_MONTHLY_CAP_CENTS` is 500 or less/);
  });

  it("no user-facing AI string carries a dollar figure of its own: the page prints the cap it is given", () => {
    for (const file of ["lib/i18n/en.json", "lib/i18n/es.json"]) {
      const strings = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
      const ai = Object.entries(strings).filter(([key]) => key.startsWith("signals.ai."));
      expect(ai.length, file).toBeGreaterThan(10);
      for (const [key, value] of ai) expect(value, `${file} ${key}`).not.toMatch(/\$\s?\d|\d+(\.\d+)?\s?(dollars|d[oó]lares|USD)/i);
      expect(strings["signals.ai.spend"], file).toContain("{cap}");
    }
  });
});
