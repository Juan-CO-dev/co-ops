/**
 * Migration 0359 (catering refunds Part B1, the money half: reconciler, ingress, recovery, sweep, operator exits, the
 * epoch, the install record) pinned BY NAME. CC applies sim then prod on Juan's word; nothing here touches a real
 * database (PGlite only, synthetic rows).
 *
 * Pins, in the house style of the 0357 / 0358 pins:
 *   · the header and gate line, one transaction, that it is the ONLY 0359, the four denies on every new table, the
 *     privilege statements, no defaults, the pinned search_path, the install record written LAST, no epoch opened;
 *   · that the re-emitted bodies are their sources' (0357's request guard, 0343's cron lease) and that the seven
 *     fingerprint pairs its pre-flight carries are the md5s of the bodies in the 0357 / 0358 / 0343 FILES;
 *   · the SQL <-> TypeScript vocabulary parity (lib/catering/refund-outcomes-shared.ts is 0359's twin);
 *   · the activation order (`recovery_epoch_precedes_master_on`, executable, against the real SQL too);
 *   · the B1 half of the migration order (0359 writes only B1; B2 = 0362 and B3 = 0363 are later files);
 *   · and runs the offline proof, scripts/sql-harness-0359.mjs, whole and `--behaviour-only` (addendum Opus P3-e).
 *
 * "Historical migrations and historical test assertions stay pinned to their original schema stage" (plan B1.5): the
 * 0357 / 0358 pins are untouched by this file; it owns 0359's stage only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { PGliteInterface as PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BLOCKING_REFUND_ISSUE_CODES,
  EVIDENCE_REQUIRED_ACTIONS,
  REFUND_B1_SQL_REFUSALS,
  REFUND_CALLER_CONTRACT,
  REFUND_CLASSES,
  REFUND_DISPOSITION_ACTIONS,
  REFUND_EPOCH_STATES,
  REFUND_ISSUE_CODES,
  activationNextStep,
  dispositionActionsFor,
  parseEpochState,
  refundClassOf,
  type RefundDispositionAction,
  type RefundEpochState,
  type RefundIssueCode,
} from "@/lib/catering/refund-outcomes-shared";
import { REFUND_SQL_REFUSALS } from "@/lib/catering/refunds-shared";
import { REFUND_INGRESS_TYPES } from "@/lib/stripe/shared";

import { refundDb } from "./helpers/refund-pglite";

const NAME = "0359_catering_refund_reconciler";
const read = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8").replace(/\r\n/g, "\n");
const sql = read(NAME);
const sql0357 = read("0357_catering_refund_requests");
const sql0358 = read("0358_catering_refund_roles");
const sql0343 = read("0343_demand_signal_sources");
/** Comments out. (Only where no string literal holds a "--"; the raw file is used where one does.) */
const strip = (text: string) => text.replace(/--[^\n]*/g, "");
const code = strip(sql);
const quoted = (text: string) => [...text.matchAll(/'([a-z_.-]+)'/g)].map((m) => m[1]!);
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** Every `create [or replace] function public.<name>(<args>) <head> as $$<body>$$;` of a file, raw (prosrc = the raw text). */
interface Fn { name: string; args: string; head: string; body: string; replace: boolean; at: number }
function functionsOf(text: string): Fn[] {
  return [...text.matchAll(/^create (or replace )?function public\.([a-z_]+)\(([^)]*)\)([\s\S]*?)\bas \$\$([\s\S]*?)\$\$;/gm)].map((m) => ({
    name: m[2]!, replace: Boolean(m[1]), args: m[3]!, head: m[4]!, body: m[5]!, at: m.index!,
  }));
}
const FNS = functionsOf(sql);
const fnOf = (text: string, name: string): Fn => {
  const f = functionsOf(text).find((x) => x.name === name);
  if (!f) throw new Error(`function ${name} not found`);
  return f;
};
const fn59 = (name: string) => fnOf(sql, name);

// 0358's two fingerprint conventions, verbatim from tests/catering-refund-0358-migration.test.ts (a test file cannot be
// imported without running its suites, so the two one-liners are repeated here unchanged).
/** The 0354 convention: md5 of the body with every non-printing character removed. */
const fingerprint = (text: string) => createHash("md5").update(text.replace(/[^\x21-\x7E]+/g, ""), "utf8").digest("hex");
/** The EXACT fingerprint: only line breaks (and the whitespace around them) normalized, every in-line character kept. */
const exactFingerprint = (text: string) => createHash("md5").update(text.replace(/\s*[\r\n]+\s*/g, "\n").trim(), "utf8").digest("hex");

const NEW_TABLES = [
  "catering_refund_install_contracts", "catering_refund_epochs", "catering_refund_payment_work", "catering_refund_identities",
  "catering_refund_event_work", "catering_payment_refund_outcomes", "catering_refund_issues",
] as const;

/** The arguments of one SQL call, split at top-level commas (parentheses and string literals respected). */
function callArgs(text: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (let i = open; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) { cur += c; if (c === "'") quote = false; continue; }
    if (c === "'") { quote = true; cur += c; continue; }
    if (c === "(") { depth += 1; if (depth === 1) continue; }
    if (c === ")") { depth -= 1; if (depth === 0) { out.push(cur.trim()); return out; } }
    if (c === "," && depth === 1) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  throw new Error("unterminated call");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("0359 header, shape and privileges", () => {
  it("0359_identity_and_four_denies: the ONLY 0359, the header and gate line, one transaction, the lock before the pre-flight, the pre-flight before every CREATE", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("0359_"))).toEqual([`${NAME}.sql`]);
    const lines = sql.split("\n");
    expect(lines[0]).toBe(`-- Migration ${NAME}`);
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-27 \(catering refunds Part B1 "money", CO CC Fable lead, for CC\)\. /);
    expect(lines[1]).toContain("NOT YET APPLIED -- GATE CC/JUAN");
    // An APPLIED stamp goes UNDER the gate line, never instead of it.
    expect(lines.slice(2, 6).filter((l) => /^-- APPLIED /.test(l)).every((l) => new RegExp(`^-- APPLIED TO (PROD|SIM) \\d{4}-\\d{2}-\\d{2}( UTC)? \\(schema_migrations version \\d{14}, name '${NAME}'\\)$`).test(l))).toBe(true);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(code.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
    // The table lock is the first statement after begin, before the pre-flight and its live-claim check.
    const afterBegin = code.slice(code.indexOf("\nbegin;\n") + 8).split("\n").map((l) => l.trim()).filter(Boolean);
    expect(afterBegin[0]).toBe("lock table public.catering_refund_requests in share row exclusive mode;");
    expect(afterBegin[1]).toBe("do $$");
    const lockAt = code.indexOf("lock table public.catering_refund_requests in share row exclusive mode;");
    const preAt = code.indexOf("\ndo $$");
    const liveClaimAt = sql.indexOf("raise exception '0359: a live refund claim exists");
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(preAt);
    expect(sql.indexOf("lock table public.catering_refund_requests")).toBeLessThan(liveClaimAt);
    expect(sql.slice(sql.indexOf("\ndo $$"), liveClaimAt)).not.toContain("end $$;"); // the live-claim check is IN the pre-flight
    const firstCreate = code.search(/^(create|alter|revoke|grant|insert|update)\b/m);
    expect(preAt).toBeLessThan(firstCreate);
    expect(code.slice(preAt, firstCreate)).toMatch(/\nend \$\$;\n/); // the pre-flight block closed before the first change
  });

  it("0359_identity_and_four_denies: each of the 7 new tables gets RLS, the four _no_user_* denies and a revoke from public, anon, authenticated, service_role", () => {
    expect(code.match(/^create table public\.([a-z_]+)/gm)!.map((l) => l.replace("create table public.", ""))).toEqual([...NEW_TABLES]);
    // The deny loop: its table list is exactly the new tables, and its body is the four denies + RLS + the revoke.
    const block = sql.slice(sql.indexOf("-- ── RLS: deny-all"), sql.indexOf("-- ── The stale sender"));
    expect(quoted(block.slice(block.indexOf("foreach t in array array["), block.indexOf("] loop")))).toEqual([...NEW_TABLES]);
    for (const stmt of [
      "execute format('alter table public.%I enable row level security', t);",
      "execute format('create policy %I on public.%I for select using (false)', t || '_no_user_select', t);",
      "execute format('create policy %I on public.%I for insert with check (false)', t || '_no_user_insert', t);",
      "execute format('create policy %I on public.%I for update using (false)', t || '_no_user_update', t);",
      "execute format('create policy %I on public.%I for delete using (false)', t || '_no_user_delete', t);",
      "execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);",
    ]) expect(block, stmt).toContain(stmt);
    // No other policy anywhere in the file, and the in-file assertion checks the same seven by the same four names.
    expect(code.match(/create policy/g)).toHaveLength(4);
    const assertions = sql.slice(sql.indexOf("-- (2) The seven new tables"), sql.indexOf("-- (3) 0357's two tables"));
    expect(quoted(assertions.slice(assertions.indexOf("foreach t in array array["), assertions.indexOf("] loop")))).toEqual([...NEW_TABLES]);
    expect(assertions).toContain("t || '_no_user_delete:d:true,' || t || '_no_user_insert:a:true,' || t || '_no_user_select:r:true,' || t || '_no_user_update:w:true'");
    expect(assertions).toContain("foreach r in array array['public', 'anon', 'authenticated', 'service_role'] loop");
  });

  it("0359_identity_and_four_denies: no table grant to anyone; grants are EXECUTE on functions to service_role only", () => {
    const grants = (code.match(/^\s*grant\b[^;]*;/gm) ?? []).map((g) => g.trim());
    expect(grants).toEqual([
      "grant execute on function public.catering_refund_actor_ok(uuid, uuid) to service_role;",
      "grant execute on function public.catering_refund_figures(uuid) to service_role;",
      "grant execute on function public.claim_cron_route(text) to service_role;",
    ]);
    // …and the worker loop's one dynamic grant, EXECUTE on a function, to service_role.
    expect(code.match(/execute format\('grant [^']*'/g)).toEqual(["execute format('grant execute on function %s to service_role'"]);
    expect(code).not.toMatch(/\bgrant\s+(select|insert|update|delete|all|truncate|references|trigger)\b/i);
    expect(code).not.toMatch(/\bgrant\b[^;]*\bto\s+(public|anon|authenticated)\b/i);
    // The withdrawn stale sender (plan B1.5): the nine column grants and 0357's reserve / claim / snapshot writer.
    expect(code).toContain("revoke update (status, stripe_refund_id, stripe_status, last_error_code, last_error_message, updated_at, settled_at,\n               claim_token, claimed_until)\n  on table public.catering_refund_requests from service_role;");
    for (const f of ["catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)", "catering_refund_claim(uuid)", "catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)"]) {
      expect(code).toContain(`revoke all on function public.${f} from public, anon, authenticated, service_role;`);
    }
  });

  it("0359_identity_and_four_denies: no `default` in any function argument list, and every function of the family pins search_path", () => {
    expect(FNS.length).toBeGreaterThan(40);
    for (const f of FNS) {
      expect(f.args, `${f.name}(${f.args})`).not.toMatch(/\bdefault\b|:=|=/i);
      if (f.name === "claim_cron_route") expect(f.head, f.name).toContain("set search_path=pg_catalog,public"); // 0343's own spelling, kept
      else expect(f.head, f.name).toContain("set search_path = pg_catalog, public");
    }
    // Every catering_refund_* function 0359 CREATES, plus 0357's six, is the 51 the in-file assertion expects.
    const created = FNS.filter((f) => !f.replace && f.name.startsWith("catering_refund_")).length;
    expect(sql).toContain("if v_n <> 51 then raise exception '0359: the catering_refund_* function family has % members, expected 51', v_n; end if;");
    expect(created + functionsOf(sql0357).filter((f) => f.name.startsWith("catering_refund_")).length).toBe(51);
    // The only re-emitted (create or replace) functions are the guard and the cron lease.
    expect(FNS.filter((f) => f.replace).map((f) => f.name)).toEqual(["catering_refund_requests_guard", "claim_cron_route"]);
  });

  it("0359_identity_and_four_denies: the install record is the LAST statement before commit and the only write to the install table; no epoch is opened; no secret-looking text", () => {
    const statements = code.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(statements.slice(-2)).toEqual([
      "insert into public.catering_refund_install_contracts (part, version, migration) values ('B1', 'b1-1', '0359_catering_refund_reconciler');",
      "commit;",
    ]);
    expect(code.match(/insert into public\.catering_refund_install_contracts/gi)).toHaveLength(1);
    expect(code).not.toMatch(/update public\.catering_refund_install_contracts|delete from public\.catering_refund_install_contracts|truncate[^;]*catering_refund_install_contracts/i);
    // Opens no epoch: the only `open_recovery(` is its own definition; nothing inserts an epoch outside it.
    const opens = [...code.matchAll(/open_recovery\(/g)].map((m) => code.slice(code.lastIndexOf("\n", m.index!) + 1, m.index! + 14));
    expect(opens).toEqual(["create function public.catering_refund_open_recovery("]);
    expect(code.match(/insert into public\.catering_refund_epochs\b/g)).toHaveLength(1);
    expect(FNS.filter((f) => /insert into public\.catering_refund_epochs\b/.test(f.body)).map((f) => f.name)).toEqual(["catering_refund_open_recovery"]);
    // No project ref, URL, email address or key-looking string.
    for (const banned of [/https?:\/\//i, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, /bgcvurheqzylyfehqgzh/, /supabase\.co\b/i,
      /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]+/, /\bwhsec_[A-Za-z0-9]+/, /\beyJ[A-Za-z0-9_-]{10,}/, /[A-Za-z0-9+/]{48,}={0,2}/]) {
      expect(sql, String(banned)).not.toMatch(banned);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("the re-emitted bodies are their sources'", () => {
  it("the request guard is 0357's body, with its two documented amendments and three documented additions, and nothing else", () => {
    const b57 = fnOf(sql0357, "catering_refund_requests_guard");
    const b59 = fn59("catering_refund_requests_guard");
    // Same trigger function identity: no arguments, returns trigger, invoker (no security definer), pinned path.
    expect(b59.args).toBe("");
    expect(b59.head).toBe(b57.head);
    expect(b59.head).toBe(" returns trigger\nlanguage plpgsql set search_path = pg_catalog, public ");
    const l57 = b57.body.split("\n");
    const l59 = b59.body.split("\n");
    // (1) The documented AMENDMENTS (plan B1.5: "Amend both its status transition test and its terminal freeze").
    const AMEND_TRANSITION_OLD = ["    or (old.status = 'submitted' and new.status in ('succeeded', 'failed'))) then"];
    const AMEND_TRANSITION_NEW = [
      "    or (old.status = 'submitted' and new.status in ('succeeded', 'failed'))",
      "    or (new.reconcile_seq > old.reconcile_seq and (",
      "            (old.status = 'succeeded' and new.status in ('submitted', 'failed'))",
      "         or (old.status = 'failed' and new.status in ('submitted', 'succeeded'))))) then",
    ];
    const AMEND_FREEZE_OLD = [
      "  if old.status in ('succeeded', 'failed') and (new.stripe_status is distinct from old.stripe_status",
      "     or new.last_error_code is distinct from old.last_error_code) then",
    ];
    const AMEND_FREEZE_NEW = [
      "  if old.status in ('succeeded', 'failed') and new.reconcile_seq = old.reconcile_seq",
      "     and (new.stripe_status is distinct from old.stripe_status or new.last_error_code is distinct from old.last_error_code) then",
    ];
    // (2) The documented ADDITIONS: reconcile_seq never goes back; the arm and the first reversal are write-once.
    const ADDITIONS = [
      "  if new.reconcile_seq < old.reconcile_seq then",
      "    raise exception 'refund_request_immutable' using errcode = 'P0001';",
      "  end if;",
      "  if old.create_armed_at is not null and (new.create_armed_at is distinct from old.create_armed_at",
      "     or new.arm_epoch_id is distinct from old.arm_epoch_id or new.arm_payment_intent is distinct from old.arm_payment_intent) then",
      "    raise exception 'refund_request_immutable' using errcode = 'P0001';",
      "  end if;",
      "  if old.first_reversed_at is not null and new.first_reversed_at is distinct from old.first_reversed_at then",
      "    raise exception 'refund_request_immutable' using errcode = 'P0001';",
      "  end if;",
    ];
    const replaceRun = (lines: string[], from: string[], to: string[]) => {
      const at = lines.findIndex((_, i) => from.every((f, k) => lines[i + k] === f));
      expect(at, from[0]).toBeGreaterThan(-1);
      return [...lines.slice(0, at), ...to, ...lines.slice(at + from.length)];
    };
    let rebuilt = replaceRun(l57, AMEND_TRANSITION_OLD, AMEND_TRANSITION_NEW);
    rebuilt = replaceRun(rebuilt, AMEND_FREEZE_OLD, AMEND_FREEZE_NEW);
    const statusAt = rebuilt.indexOf("  if new.status is distinct from old.status and not (");
    rebuilt = [...rebuilt.slice(0, statusAt), ...ADDITIONS, ...rebuilt.slice(statusAt)];
    expect(l59).toEqual(rebuilt);
    // The LINE SUBSEQUENCE: every line of 0357's guard that is not one of the amended lines appears in 0359's, in order.
    const amended = new Set([...AMEND_TRANSITION_OLD, ...AMEND_FREEZE_OLD]);
    let j = 0;
    for (const line of l57.filter((l) => !amended.has(l))) {
      while (j < l59.length && l59[j] !== line) j += 1;
      expect(j, `0357 line missing or out of order: ${line}`).toBeLessThan(l59.length);
      j += 1;
    }
    // Same trigger binding is asserted in the file (it is not re-created): 0357's trigger stays the only one.
    expect(code).not.toMatch(/create trigger catering_refund_requests_guard/);
    expect(code).toContain("and tg.tgfoid = 'public.catering_refund_requests_guard()'::regprocedure and tg.tgtype = 19");
  });

  it("the cron lease is 0343's with the one job added: same 330-second lease, same conflict clause, same CHECK plus one name", () => {
    const c43 = fnOf(sql0343, "claim_cron_route");
    const c59 = fn59("claim_cron_route");
    expect(c59.head).toBe(c43.head);
    expect(c59.args).toBe(c43.args);
    const JOBS43 = "'toast-sales-today','toast-catering-scan','sevenshifts-sync','schedule-draft','catering-inbox-delivery','meta-leads','fact-build','demand-signals'";
    expect(c43.body.split(JOBS43)).toHaveLength(2);
    expect(c59.body).toBe(c43.body.replace(JOBS43, `${JOBS43},'catering-refund-sweep'`));
    expect(c59.body).toContain("clock_timestamp()+interval '330 seconds'");
    expect(c59.body).toContain("on conflict(job) do update set lease_until=clock_timestamp()+interval '330 seconds'\n    where cron_route_leases.lease_until<=clock_timestamp() returning job into claimed;");
    expect(sql0343).toContain(`add constraint cron_route_leases_job_check check(job in (${JOBS43}));`);
    expect(code).toContain(`add constraint cron_route_leases_job_check check(job in (${JOBS43},'catering-refund-sweep'));`);
    // The ACL is stated again: no PUBLIC / anon / authenticated, service_role EXECUTE (0343's).
    expect(code).toContain("grant execute on function public.claim_cron_route(text) to service_role;");
  });

  it("the fingerprints written in 0359's pre-flight are the md5s (house + exact) of the bodies in the 0357 / 0358 / 0343 FILES", () => {
    const tuples = [...sql.matchAll(/\('([a-z_]+\([^)]*\))',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})',\s*'(\d{4})'\)/g)].map((m) => ({ sig: m[1]!, house: m[2]!, exact: m[3]!, src: m[4]! }));
    const SOURCES: Record<string, { file: string; name: string }> = {
      "catering_refund_requests_guard()": { file: sql0357, name: "catering_refund_requests_guard" },
      "catering_refund_figures(uuid)": { file: sql0357, name: "catering_refund_figures" },
      "catering_refund_record_snapshot(uuid, timestamptz, bigint, jsonb)": { file: sql0357, name: "catering_refund_record_snapshot" },
      "catering_refund_reserve(uuid, uuid, uuid, bigint, text, text, text)": { file: sql0357, name: "catering_refund_reserve" },
      "catering_refund_claim(uuid)": { file: sql0357, name: "catering_refund_claim" },
      "catering_refund_actor_ok(uuid, uuid)": { file: sql0358, name: "catering_refund_actor_ok" },
      "claim_cron_route(text)": { file: sql0343, name: "claim_cron_route" },
    };
    // Seven functions, two fingerprints each (14 values): every body 0359 re-emits or relies on.
    expect(tuples.map((t) => t.sig).sort()).toEqual(Object.keys(SOURCES).sort());
    const SRC_OF: Record<string, string> = { [sql0357]: "0357", [sql0358]: "0358", [sql0343]: "0343" };
    for (const t of tuples) {
      const s = SOURCES[t.sig]!;
      const b = fnOf(s.file, s.name).body;
      expect([t.sig, t.house, t.exact, t.src]).toEqual([t.sig, fingerprint(b), exactFingerprint(b), SRC_OF[s.file]]);
    }
    // 0358's own final values are these too (its header verify line), and 0359's assertion (6) re-checks the house one.
    const actor = tuples.find((t) => t.sig === "catering_refund_actor_ok(uuid, uuid)")!;
    expect(sql0358).toContain(`'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure; -- ${actor.house}`);
    expect(sql).toContain(`where p.oid = 'public.catering_refund_actor_ok(uuid, uuid)'::regprocedure) <> '${actor.house}' then`);
    // Every fingerprint in the file is one of these (no stale value left behind).
    const all = [...strip(sql).matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]!);
    for (const v of all) expect(tuples.some((t) => t.house === v || t.exact === v), v).toBe(true);
    // The pre-flight compares BOTH, by 0358's two SQL spellings.
    expect(code).toContain("select md5(regexp_replace(p.prosrc, '[^\\x21-\\x7E]+', '', 'g')),");
    expect(code).toContain("md5(btrim(regexp_replace(p.prosrc, '\\s*[\\r\\n]+\\s*', E'\\n', 'g'), E' \\t\\r\\n'))");
    expect(code).toContain("if v_house is distinct from fp.house or v_exact is distinct from fp.exact then");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("the executable proof (scripts/sql-harness-0359.mjs, PGlite, the REAL 0357 -> 0358 -> 0359)", () => {
  const harness = readFileSync("scripts/sql-harness-0359.mjs", "utf8").replace(/\r\n/g, "\n");
  const named = [...harness.matchAll(/^(stage|test)\("([^"]+)"/gm)].map((m) => ({ group: m[1]!, name: m[2]! }));
  const run = (args: string[]) => execFileSync(process.execPath, ["scripts/sql-harness-0359.mjs", ...args], { encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });

  it("the harness names its tests (stage-pinned and behaviour), uniquely", () => {
    expect(named.length).toBeGreaterThanOrEqual(46);
    expect(new Set(named.map((n) => n.name)).size).toBe(named.length);
    expect(named.filter((n) => n.group === "stage").map((n) => n.name)).toEqual([
      "0359_identity_and_four_denies", "preflight_refuses_drift_by_name", "fingerprints_in_the_file_are_the_real_ones",
      "whole_acl_trigger_operator_worker_matrix", "in_file_assertions_refuse_a_drifted_database",
    ]);
  });

  it("whole_acl_trigger_operator_worker_matrix + every named test: the whole harness exits 0, ends ALL 0359 HARNESS CHECKS PASS, and prints an ok line for EVERY named test", () => {
    const out = run([]);
    expect(out).not.toContain("FAIL ");
    expect(out.trimEnd().split("\n").pop()).toBe("ALL 0359 HARNESS CHECKS PASS");
    expect(out).toContain("Groups: STAGE-PINNED + BEHAVIOUR.");
    // A named test that silently stops running (or stops checking) fails CI here.
    const silent = named.filter((n) => !out.includes(`ok   ${n.name}: `)).map((n) => n.name);
    expect(silent).toEqual([]);
    const summary = out.match(/\n(\d+) checks, (\d+) failed, (\d+) named tests\.\n/);
    expect(summary).not.toBeNull();
    expect([Number(summary![2]), Number(summary![3])]).toEqual([0, named.length]);
  }, 620_000);

  it("--behaviour-only (addendum Opus P3-e: the split): the stage-pinned group is skipped, said so, and the behaviour group still passes", () => {
    const out = run(["--behaviour-only"]);
    expect(out).toContain("Groups: BEHAVIOUR only (stage-pinned fingerprint / ACL checks skipped).");
    expect(out).not.toContain("STAGE-PINNED (0359's own schema stage)");
    expect(out).not.toContain("FAIL ");
    expect(out.trimEnd().split("\n").pop()).toBe("ALL 0359 HARNESS CHECKS PASS");
    for (const n of named) {
      if (n.group === "stage") expect(out, n.name).not.toContain(`ok   ${n.name}: `);
      else expect(out, n.name).toContain(`ok   ${n.name}: `);
    }
  }, 620_000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("SQL <-> TypeScript vocabulary parity (lib/catering/refund-outcomes-shared.ts is 0359's twin)", () => {
  const issuesTable = code.slice(code.indexOf("create table public.catering_refund_issues"), code.indexOf("create index catering_refund_issues_open"));
  const checkList = (text: string, col: string) => quoted(text.match(new RegExp(`\\n  ${col}\\s+text[^\\n]*?check \\(${col} (?:is null or ${col} )?in \\(([\\s\\S]*?)\\)\\)`))![1]!);

  /** Every `catering_refund_raise_issue('<code>', ...)` call site: its code and its blocking literal (the 8th argument). */
  const raiseSites = [...code.matchAll(/catering_refund_raise_issue\(/g)]
    .filter((m) => !code.slice(Math.max(0, m.index! - 30), m.index!).includes("create function public."))
    .map((m) => {
      const args = callArgs(code, m.index! + "catering_refund_raise_issue".length);
      return { code: args[0]!.replace(/^'|'$/g, ""), blocking: args[7]! };
    });
  const SQL_BLOCKING = sorted(raiseSites.filter((s) => s.blocking === "true").map((s) => s.code));
  const SQL_NONBLOCKING = sorted(raiseSites.filter((s) => s.blocking === "false").map((s) => s.code));

  const resolve = fn59("catering_refund_resolve_anomaly").body;
  /** The CASE that decides which action admits which issue (`v_ok := case p_action ... else false end;`). */
  const caseText = resolve.slice(resolve.indexOf("v_ok := case p_action"), resolve.indexOf("else false end;"));
  const caseBranches = [...caseText.matchAll(/when '([a-z_]+)' then ([^\n]+)/g)].map((m) => ({ action: m[1]!, expr: m[2]!.trim() }));
  const admits = (expr: string, codeName: string, state: "open" | "held"): boolean => {
    let m: RegExpMatchArray | null;
    if ((m = expr.match(/^v_issue\.code = '([a-z_]+)'$/))) return m[1] === codeName;
    if ((m = expr.match(/^v_issue\.code in \(([^)]*)\)$/))) return quoted(m[1]!).includes(codeName);
    if (expr === "v_issue.blocking") return SQL_BLOCKING.includes(codeName);
    if (expr === "v_issue.state = 'held'") return state === "held";
    throw new Error(`unparsed CASE branch: ${expr}`);
  };

  it("every_hold_code_has_an_exit (TS half): REFUND_ISSUE_CODES is the CHECK list on catering_refund_issues.code, and every code is raised somewhere", () => {
    expect(checkList(issuesTable, "code")).toEqual([...REFUND_ISSUE_CODES]);
    expect(sorted(raiseSites.map((s) => s.code))).toEqual(sorted(REFUND_ISSUE_CODES));
    // An issue row is only ever made by catering_refund_raise_issue.
    expect(code.match(/insert into public\.catering_refund_issues\b/g)).toHaveLength(1);
    expect(fn59("catering_refund_raise_issue").body).toContain("insert into public.catering_refund_issues");
  });

  it("every_hold_code_has_an_exit (TS half): BLOCKING_REFUND_ISSUE_CODES is the set the SQL raises with blocking = true; no code is raised both ways", () => {
    expect(raiseSites.every((s) => s.blocking === "true" || s.blocking === "false")).toBe(true);
    const both = SQL_BLOCKING.filter((c) => SQL_NONBLOCKING.includes(c));
    expect(both, `raised both blocking and non-blocking: ${both.join(", ")}`).toEqual([]);
    expect(SQL_BLOCKING).toEqual(sorted(BLOCKING_REFUND_ISSUE_CODES));
    expect(sorted([...SQL_BLOCKING, ...SQL_NONBLOCKING])).toEqual(sorted(REFUND_ISSUE_CODES));
  });

  it("every_hold_code_has_an_exit (TS half): REFUND_DISPOSITION_ACTIONS is catering_refund_resolve_anomaly's action list (and the disposition CHECK = those + the system's evidence_cleared)", () => {
    const listed = quoted(resolve.match(/p_action not in \(([\s\S]*?)\)/)![1]!);
    expect(listed).toEqual([...REFUND_DISPOSITION_ACTIONS]);
    expect(caseBranches.map((b) => b.action)).toEqual([...REFUND_DISPOSITION_ACTIONS]);
    expect(sorted(checkList(issuesTable, "disposition"))).toEqual(sorted([...REFUND_DISPOSITION_ACTIONS, "evidence_cleared"]));
  });

  it("every_hold_code_has_an_exit (TS half): dispositionActionsFor(code, state) is EXACTLY what the SQL CASE admits; every code has an action; every BLOCKING code has a real exit", () => {
    const PARKING: readonly RefundDispositionAction[] = ["acknowledge_followup", "keep_held", "access_still_required"];
    for (const c of REFUND_ISSUE_CODES) {
      for (const state of ["open", "held"] as const) {
        const sqlSet = sorted(caseBranches.filter((b) => admits(b.expr, c, state)).map((b) => b.action));
        expect([c, state, sorted(dispositionActionsFor(c, state))]).toEqual([c, state, sqlSet]);
      }
      expect(dispositionActionsFor(c, "open").length, c).toBeGreaterThan(0);
      expect(dispositionActionsFor(c, "open")).not.toContain("reopen_recheck");
      expect(dispositionActionsFor(c, "held")).toContain("reopen_recheck");
      if ((BLOCKING_REFUND_ISSUE_CODES as readonly RefundIssueCode[]).includes(c)) {
        expect(dispositionActionsFor(c, "open"), `${c}: keep_held`).toContain("keep_held");
        const exits = dispositionActionsFor(c, "open").filter((a) => !PARKING.includes(a));
        expect(exits.length, `${c} has only parking actions`).toBeGreaterThan(0);
      }
    }
    // awaiting_identity's FINANCIAL exit (plan r5 1): the floor resolution, not an acknowledgement.
    expect(dispositionActionsFor("awaiting_identity", "open")).toContain("resolve_event_floor");
  });

  it("every_hold_code_has_an_exit (TS half): EVIDENCE_REQUIRED_ACTIONS is the SQL's evidence_required list", () => {
    const m = resolve.match(/if p_action in \(([\s\S]*?)\) and p_evidence_ref is null then\s*raise exception 'evidence_required'/);
    expect(m).not.toBeNull();
    expect(sorted(quoted(m![1]!))).toEqual(sorted(EVIDENCE_REQUIRED_ACTIONS));
  });

  it("every_hold_code_has_an_exit (TS half): every P0001 name a route-reachable worker function can raise has an HTTP mapping (none is guessed here)", () => {
    // The worker surface = the functions 0359 grants to service_role.
    const grantBlock = strip(sql.slice(sql.indexOf("-- ── Privileges, stated"), sql.indexOf("-- ── Assertions")));
    const workers = [...grantBlock.matchAll(/'public\.([a-z_]+)\(/g)].map((m) => m[1]!).filter((n) => FNS.some((f) => f.name === n));
    expect(workers.length).toBe(20);
    // Which of them the app calls through refundRpc (the mapping refundRpc applies is REFUND_B1_SQL_REFUSALS).
    const appSrc = ["lib/catering/refunds.ts", "lib/catering/refund-reconcile.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    const reachable = workers.filter((n) => new RegExp(`refundRpc(?:<[^>]*>)?\\(\\s*sb,\\s*"${n}"`).test(appSrc));
    expect(reachable.length).toBeGreaterThan(8);
    const byName = new Map(FNS.map((f) => [f.name, f.body]));
    const raisedBy = (n: string, seen = new Set<string>()): Set<string> => {
      const out = new Set<string>();
      if (seen.has(n)) return out;
      seen.add(n);
      const b = byName.get(n);
      if (!b) return out;
      for (const m of strip(b).matchAll(/raise exception '([a-z_]+)'/g)) out.add(m[1]!);
      for (const m of b.matchAll(/public\.(catering_refund_[a-z_]+)\(/g)) if (m[1] !== n) for (const x of raisedBy(m[1]!, seen)) out.add(x);
      return out;
    };
    const unmapped: string[] = [];
    for (const n of reachable) {
      // The reserve keeps 0357's own named refusals: lib/catering/refunds.ts maps them with REFUND_SQL_REFUSALS (Part A).
      const mapped = new Set([...Object.keys(REFUND_B1_SQL_REFUSALS), ...(n === "catering_refund_reserve_admitted" ? Object.keys(REFUND_SQL_REFUSALS) : [])]);
      for (const name of raisedBy(n)) if (!mapped.has(name)) unmapped.push(`${n}: ${name}`);
    }
    expect(unmapped, `raised by a route-reachable worker function with no HTTP mapping:\n${unmapped.join("\n")}`).toEqual([]);
  });

  it("REFUND_CALLER_CONTRACT is the B1 version of catering_refund_install_manifest() and of the install record", () => {
    const manifest = JSON.parse(fn59("catering_refund_install_manifest").body.match(/select '(\{[^']*\})'::jsonb/)![1]!) as Record<string, string>;
    expect(manifest.B1).toBe(REFUND_CALLER_CONTRACT);
    expect(code).toContain(`values ('B1', '${REFUND_CALLER_CONTRACT}', '${NAME}');`);
    // The admission's shape check accepts it, and fails closed on anything else (every worker takes p_caller FIRST).
    expect(fn59("catering_refund_admit").body).toContain("if p_caller is null or p_caller !~ '^b1-[0-9]{1,6}$'");
    expect(REFUND_CALLER_CONTRACT).toMatch(/^b1-[0-9]{1,6}$/);
    const grantBlock = strip(sql.slice(sql.indexOf("-- ── Privileges, stated"), sql.indexOf("-- ── Assertions")));
    for (const m of grantBlock.matchAll(/'public\.(catering_refund_[a-z_]+)\(([^)]*)\)'::regprocedure/g)) {
      if (m[1] === "catering_refund_effective_figures") continue; // a pure read of one payment's figures, no admission
      expect(m[2]!.split(",")[0]!.trim(), m[1]).toBe("text");
      expect(fn59(m[1]!).args.split(",")[0]!.trim(), m[1]).toBe("p_caller text");
    }
  });

  let db: PGlite;
  beforeAll(async () => { db = await refundDb(); }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("refundClassOf equals SQL catering_refund_class_of over every status (run both, PGlite)", async () => {
    const statuses: Array<string | null> = ["succeeded", "failed", "canceled", "pending", "requires_action", null, "", "processing", "SUCCEEDED", "refunded"];
    for (const s of statuses) {
      const r = await db.query<{ c: string }>("select public.catering_refund_class_of($1) as c", [s]);
      expect([s, r.rows[0]!.c]).toEqual([s, refundClassOf(s)]);
      expect(REFUND_CLASSES).toContain(r.rows[0]!.c);
    }
    // The CHECK lists of the class columns are the TS classes.
    expect(quoted(code.match(/class\s+text check \(class is null or class in \(([^)]*)\)\)/)![1]!)).toEqual([...REFUND_CLASSES]);
  });

  it("REFUND_INGRESS_TYPES is the event_type CHECK (and the lists ingress registration and the recovery seed accept)", () => {
    const eventWork = code.slice(code.indexOf("create table public.catering_refund_event_work"), code.indexOf("create index catering_refund_event_work_pi"));
    expect(quoted(eventWork.match(/event_type\s+text not null check \(event_type in \(([^)]*)\)\)/)![1]!)).toEqual([...REFUND_INGRESS_TYPES]);
    expect(quoted(fn59("catering_refund_event_register").body.match(/p_event_type not in \(([^)]*)\)/)![1]!)).toEqual([...REFUND_INGRESS_TYPES]);
    expect(quoted(fn59("catering_refund_recovery_seed_batch").body.match(/s\.type in \(([^)]*)\)/)![1]!)).toEqual([...REFUND_INGRESS_TYPES]);
  });

  it("the epoch states: the TS view is none + sealed + the open states of the epochs CHECK (closed is never a view state)", () => {
    const epochs = code.slice(code.indexOf("create table public.catering_refund_epochs"), code.indexOf("create unique index catering_refund_epochs_one_open"));
    const stored = quoted(epochs.match(/state\s+text not null check \(state in \(([^)]*)\)\)/)![1]!);
    expect(stored).toEqual(["recovering", "live", "draining", "closed"]);
    expect([...REFUND_EPOCH_STATES]).toEqual(["none", "sealed", ...stored.filter((s) => s !== "closed")]);
    const view = fn59("catering_refund_epoch_state").body;
    expect(view).toContain("'state', case when coalesce(v_sealed, false) then 'sealed' else 'none' end");
    expect(fn59("catering_refund_admit").body).toContain("o_state := case when coalesce(v_sealed, false) then 'sealed' else 'none' end;");
  });

  it("recovery_epoch_precedes_master_on: activationNextStep NEVER says set_switch_on unless the read-back epoch is recovering with callerOk, and says open_recovery_first for none / sealed whatever the switch says", () => {
    const STATES: RefundEpochState[] = ["none", "sealed", "recovering", "live", "draining"];
    let cells = 0;
    for (const switchOn of [false, true]) {
      for (const state of STATES) {
        for (const callerOk of [true, false]) {
          cells += 1;
          const step = activationNextStep({ switchOn, epoch: { state, epochId: state === "none" || state === "sealed" ? null : "e", callerOk } });
          if (step === "set_switch_on") expect([state, callerOk, switchOn]).toEqual(["recovering", true, false]);
          if (!callerOk) expect(step).toBe("refuse_incompatible");
          if (callerOk && (state === "none" || state === "sealed")) expect([state, switchOn, step]).toEqual([state, switchOn, "open_recovery_first"]);
          if (callerOk && state === "recovering") expect(step).toBe(switchOn ? "seed_and_recover" : "set_switch_on");
          if (callerOk && state === "live") expect(step).toBe("already_live");
          if (callerOk && state === "draining") expect(step).toBe("refuse_draining");
        }
      }
    }
    expect(cells).toBe(20);
  });

  it("recovery_epoch_precedes_master_on (real SQL): before catering_refund_open_recovery the read-back is open_recovery_first; after it, set_switch_on", async () => {
    const readBack = async () => parseEpochState((await db.query<{ s: unknown }>("select public.catering_refund_epoch_state($1) as s", [REFUND_CALLER_CONTRACT])).rows[0]!.s);
    const before = await readBack();
    expect(before).toMatchObject({ state: "none", callerOk: true });
    expect(activationNextStep({ switchOn: false, epoch: before })).toBe("open_recovery_first");
    expect(activationNextStep({ switchOn: true, epoch: before })).toBe("open_recovery_first");
    // A build compiled for another contract is refused whatever the state.
    const other = parseEpochState((await db.query<{ s: unknown }>("select public.catering_refund_epoch_state($1) as s", ["b1-999"])).rows[0]!.s);
    expect(activationNextStep({ switchOn: false, epoch: other })).toBe("refuse_incompatible");
    // The operator step (CC, as the owner, with the switch still OFF).
    await db.query("select public.catering_refund_open_recovery($1)", ["cc"]);
    const after = await readBack();
    expect(after).toMatchObject({ state: "recovering", callerOk: true });
    expect(after.epochId).toMatch(/^[0-9a-f-]{36}$/);
    expect(activationNextStep({ switchOn: false, epoch: after })).toBe("set_switch_on");
    expect(activationNextStep({ switchOn: true, epoch: after })).toBe("seed_and_recover");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe("fix round 2 (CC addendum RULINGS-refundB1-r2): the shapes the SQL must keep", () => {
  const body = (name: string) => fn59(name).body;
  const RESOLVES = /update public\.catering_refund_issues[\s\S]{0,400}?set state = (?:'resolved'|v_state)/;

  it("F3 restricted_at_has_one_derivation: every function that resolves, clears or dispositions an issue calls catering_refund_recompute_restriction, and nothing else writes restricted_at", () => {
    const resolvers = FNS.filter((f) => RESOLVES.test(f.body)).map((f) => f.name).sort();
    expect(resolvers).toEqual(["catering_refund_apply_inner", "catering_refund_arm", "catering_refund_finish", "catering_refund_register_hints",
      "catering_refund_release", "catering_refund_resolve_anomaly"]);
    for (const name of resolvers) expect(body(name), name).toContain("perform public.catering_refund_recompute_restriction(");
    // The ONE writer of the column.
    const writers = FNS.filter((f) => /\brestricted_at\s*=/.test(f.body.replace(/--[^\n]*/g, ""))).map((f) => f.name);
    expect(writers).toEqual(["catering_refund_recompute_restriction"]);
    // In the financial writer the derivation runs AFTER every evidence clear and BEFORE the projection reads `held`.
    const apply = body("catering_refund_apply_inner");
    const at = apply.indexOf("perform public.catering_refund_recompute_restriction(p_payment_id);");
    expect(at).toBeGreaterThan(apply.lastIndexOf("disposition = 'evidence_cleared'"));
    expect(at).toBeLessThan(apply.indexOf("-- The projection: available / reserved / returned"));
  });

  it("F5 one_lock_order: the payment is locked BEFORE the event in ingress (promotion included), settlement attach, housekeeping and seed stage 2; events are taken in ascending event id", () => {
    const reg = body("catering_refund_event_register");
    const payLock = reg.indexOf("from public.catering_payments p where p.id = v_lock for no key update");
    const evLock = reg.indexOf("from public.catering_refund_event_work e where e.event_id = p_event_id for update");
    const evInsert = reg.indexOf("insert into public.catering_refund_event_work");
    expect(payLock).toBeGreaterThan(0);
    expect([payLock < evInsert, payLock < evLock, evInsert < evLock]).toEqual([true, true, true]);
    // No payment lock is ever taken after the event lock in that function; a payment that moved steps back by name.
    expect(reg.slice(evLock)).not.toMatch(/catering_payments[\s\S]{0,200}for no key update/);
    expect(reg).toContain("raise exception 'ingress_retry'");
    // Settlement attach: the payment (FOR NO KEY UPDATE) first, then its events in ascending event id.
    const att = body("catering_refund_settlement_attach");
    expect(att.indexOf("for no key update")).toBeLessThan(att.indexOf("catering_refund_attach_event("));
    expect(att).toMatch(/and e\.restamped_at is null\s+order by e\.event_id /);
    // Housekeeping: payments ascending, each before its own events, a payment's events ascending.
    expect(body("catering_refund_sweep_housekeeping")).toMatch(/order by p\.id nulls last, e\.event_id limit 200/);
    // Seed stage 2: every payment of the batch locked (ascending) before the first event is written; events ascending.
    const seed = body("catering_refund_recovery_seed_batch");
    const lockStmt = "perform 1 from public.catering_payments p where p.id = any(v_locked) order by p.id for no key update;";
    const lockAll = seed.indexOf(lockStmt);
    expect(lockAll).toBeGreaterThan(0);
    expect(lockAll).toBeLessThan(seed.indexOf("where s.id = any(v_batch) order by s.id"));
    expect(seed.slice(lockAll + lockStmt.length)).not.toContain("for no key update");
    expect(seed).toContain("v_pay_id = any(v_locked)");
    // attach_event states its precondition and locks the event only (the caller holds the payment).
    expect(sql).toContain("-- Attach ONE event to its settled payment. THE CALLER HOLDS THE PAYMENT LOCK.");
    expect(sql).toMatch(/-- LOCK ORDER \(ONE order, every function of this file\)[\s\S]{0,400}PAYMENT rows FOR NO KEY UPDATE, ascending payment id -> EVENT rows[\s\S]{0,200}ascending event id -> REQUEST rows, ascending request id/);
  });

  it("F1 conditional_writes_read_their_row_count: each compare-and-set of 0359 is followed by its row count (or an effect check) and a named refusal", () => {
    const apply = body("catering_refund_apply_inner");
    for (const cas of ["set status = 'refunded' where p.id = p_payment_id and p.status = 'paid';", "set status = 'paid' where p.id = p_payment_id and p.status = 'refunded';"]) {
      const at = apply.indexOf(cas);
      expect(at, cas).toBeGreaterThan(0);
      expect(apply.slice(at, at + 420), cas).toMatch(/get diagnostics v_rows = row_count;\s+if v_rows <> 1 then raise exception 'stale_generation'/);
    }
    const reg = body("catering_refund_event_register");
    expect(reg).toMatch(/where s\.id = p_event_id and \(s\.outcome is null or s\.outcome = 'processing_failed'\);\s+get diagnostics v_stamped = row_count;/);
    expect(reg).toContain("raise exception 'ledger_row_missing'");
    expect(reg).toMatch(/on conflict \(event_id\) do nothing;[\s\S]{0,200}get diagnostics v_new = row_count;/);
    const restamp = body("catering_refund_restamp_events");
    expect(restamp).toContain("and exists (select 1 from public.stripe_events s where s.id = e.event_id and s.outcome = 'payment_not_found')");
    expect(body("catering_refund_finish_drain")).toMatch(/if v_restamped <> coalesce\(cardinality\(v_ids\), 0\) then\s+raise exception 'restamp_incomplete'/);
    expect(body("catering_refund_break_glass_close")).toContain("'not_restamped'");
    expect(body("catering_refund_sweep_housekeeping")).toMatch(/and e\.state = 'unmatched';[\s\S]{0,200}get diagnostics v_n = row_count;\s+v_parked := v_parked \+ v_n;/);
    expect(body("catering_refund_finish")).toMatch(/where r\.id = p_request_id and r\.status = 'pending';\s+get diagnostics v_n = row_count;[\s\S]{0,300}'not_pending'/);
    const resolve = body("catering_refund_resolve_anomaly");
    expect(resolve).toMatch(/where i\.id = p_issue_id;\s+get diagnostics v_n = row_count;\s+if v_n <> 1 then raise exception 'stale_generation'/);
    expect(resolve).toMatch(/and x\.state = 'quarantined';\s+get diagnostics v_n = row_count;\s+if v_n <> 1 then raise exception 'invalid_action'/);
    // The evidence review of an immutable conflict no longer writes the identity at all.
    expect(resolve.replace(/--[^\n]*/g, "")).not.toMatch(/set verified = false/);
  });

  it("F7 + R3: a null event charge matches nothing in BOTH coverage queries; scope at the seal is any payment row carrying the PaymentIntent, in any status", () => {
    for (const name of ["catering_refund_apply_inner", "catering_refund_resolve_anomaly"]) {
      expect(body(name), name).toContain("and v_ev.livemode = v_w.livemode and v_ev.charge_id is not null and v_ev.charge_id = v_w.charge_id");
      expect(body(name), name).not.toContain("v_ev.charge_id is null or");
    }
    const drain = body("catering_refund_drain_report").replace(/--[^\n]*/g, "");
    const scope = drain.slice(drain.indexOf("into v_scope"), drain.indexOf("into v_quar"));
    expect(scope).toContain("and not exists (select 1 from public.catering_payments p where p.provider = 'stripe' and p.provider_ref = e.payment_intent_id);");
    expect(scope).not.toContain("p.status");
    expect(drain.slice(0, drain.indexOf("into v_send"))).not.toContain("p.status in ('paid', 'refunded')");
    expect(body("catering_refund_finish_drain")).toContain("or jsonb_array_length(v_report->'whole_refunds_unsettled') > 0");
  });
});

describe("the migration order (plan r5 6, addendum P3 f)", () => {
  it("refund_migrations_require_0359_0362_0363_order (B1 half): the manifest names exactly B1, B2, B3; 0359 writes only B1; no 0360 / 0361 / 0362 / 0363 refund file on this branch", () => {
    const manifest = JSON.parse(fn59("catering_refund_install_manifest").body.match(/select '(\{[^']*\})'::jsonb/)![1]!) as Record<string, string>;
    expect(Object.keys(manifest)).toEqual(["B1", "B2", "B3"]);
    expect(manifest).toEqual({ B1: "b1-1", B2: "b2-1", B3: "b3-1" });
    // 0359 writes B1 only (the install table's own CHECK admits the three parts, nothing else).
    const writes = [...code.matchAll(/insert into public\.catering_refund_install_contracts \(part, version, migration\) values \(([^;]*)\);/g)].map((m) => m[1]);
    expect(writes).toEqual([`'B1', 'b1-1', '${NAME}'`]);
    expect(code).toContain("part               text not null check (part in ('B1', 'B2', 'B3')),");
    // Recovery and promotion require all three current records (a 0359-only database refuses: the harness proves it).
    expect(fn59("catering_refund_install_check").body).toContain("if v_n <> 3 or v_live is distinct from v_expected then");
    expect(fn59("catering_refund_open_recovery").body).toContain("v_manifest := public.catering_refund_install_check();");
    expect(fn59("catering_refund_promote").body).toContain("v_manifest := public.catering_refund_install_check();");
    // No later refund migration on this branch; 0360 is other work and 0361 is RELEASED (addendum P3 f).
    const files = readdirSync("supabase/migrations");
    expect(files.filter((f) => /^036[0-3]_/.test(f) && /refund/i.test(f))).toEqual([]);
    expect(files.filter((f) => /^036[23]_/.test(f))).toEqual([]);
    expect(sql).toContain("B2 (email) = 0362 and B3 (digest) = 0363 are LATER files; 0360 belongs to other work; 0361 is released.");
  });
});
