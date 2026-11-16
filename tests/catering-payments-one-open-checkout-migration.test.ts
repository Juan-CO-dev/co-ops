/**
 * Migration 0303 pinned (bug audit 2026-11-14, wave W02, finding B035): ONE open Stripe
 * Checkout Session per quote, as a partial unique index on `catering_payments`.
 *
 * The app retires a quote's other open session before it mints a new one (lib/portal/
 * quotes.ts `createQuoteCheckout`, tests/portal-quote-payments.test.ts); this index is the
 * arbiter for the case code cannot close — two requests racing.
 *
 * Review r3 added the file's SECOND object: `catering_payment_attach_checkout`, the function
 * that records a minted session on its intent under the quote's row lock, so a settlement
 * cannot land between "is anything paid?" and the attach (tests/portal-checkout-settlement-
 * race.test.ts drives the app side).
 *
 * Review r6 added the THIRD and FOURTH: the column `catering_payments.settlement_cleanup_at`
 * (the durable marker of a finished settlement — tests/stripe-webhook-resume.test.ts) and the
 * function `catering_payment_checkout_ready` (the app's one question before anything reaches
 * Stripe: without this file the pay tap refuses, there is no lock-free attach to fall back to).
 *
 * What is pinned here: the house header and gate line, the executable PGlite proof, the four
 * objects the file creates and nothing else, its refusals, both functions' privilege
 * ceiling, and that APPLYING it writes no data.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "supabase/migrations/0303_catering_payments_one_open_checkout.sql";
const src = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
/** The executable SQL only: `--` comment lines dropped. */
const sql = src
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
/** The attach function's body (between its `$$` quotes), and the file with that body removed. */
const fnStart = sql.indexOf("create function public.catering_payment_attach_checkout(");
const bodyStart = sql.indexOf("as $$", fnStart) + "as $$".length;
const bodyEnd = sql.indexOf("\n$$;", bodyStart);
const fnBody = sql.slice(bodyStart, bodyEnd);
const sqlOutsideFn = sql.slice(0, bodyStart) + sql.slice(bodyEnd);

describe("0303_catering_payments_one_open_checkout", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (text: string) => {
      const lines = text.split("\n");
      return (
        lines[0] === "-- Migration 0303_catering_payments_one_open_checkout" &&
        /^-- AUTHORED 2026-11-14\. NOT YET APPLIED — file only; apply via MCP after review \(sim first, prod on Juan's word, AFTER 0204\)\.$/.test(lines[1] ?? "") &&
        lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l))
      );
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(
      ok([first, gate, "-- APPLIED TO SIM 2026-11-15 (schema_migrations version 20261115000001, name '0303_catering_payments_one_open_checkout')", ...rest].join("\n")),
    ).toBe(true);
  });

  it("is the ONLY file numbered 0303 (one migration per reserved number)", () => {
    expect(readdirSync("supabase/migrations").filter((f) => f.startsWith("0303_"))).toEqual([
      "0303_catering_payments_one_open_checkout.sql",
    ]);
  });

  it("the executable proof (PGlite: the REAL 0127 / 0130 / 0204 DDL + 0303 over existing rows) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0303.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0303:");
  }, 260_000);

  it("creates exactly FOUR objects: the partial UNIQUE index, the attach function, the marker column, the readiness function — nothing else", () => {
    expect(fnStart).toBeGreaterThan(0);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    expect(sql).toContain(
      "create unique index catering_payments_one_open_checkout\n  on public.catering_payments (quote_id)\n  where status = 'due' and provider_session_id is not null;",
    );
    // Statements only (line-anchored): the post-flight quotes the definition inside a regex.
    expect(sql.match(/^create\s+(unique\s+)?index\b/gim)).toHaveLength(1);
    expect(sql.match(/^create\s+(or\s+replace\s+)?function\b[^\n(]*/gim)).toEqual([
      "create function public.catering_payment_attach_checkout",
      "create function public.catering_payment_checkout_ready",
    ]);
    expect(sql).toContain("create function public.catering_payment_checkout_ready() returns boolean\nlanguage sql\nstable\nset search_path = pg_catalog, public\nas $$");
    // ONE column, added once: nullable, no default (no existing row is rewritten).
    expect(sql.match(/^alter\s+table\b[^;]*;/gim)).toEqual(["alter table public.catering_payments add column settlement_cleanup_at timestamptz;"]);
    expect(sql).toContain(
      "create function public.catering_payment_attach_checkout(\n  p_payment_id   uuid,\n  p_quote_id     uuid,\n  p_amount_cents integer,\n  p_session_id   text\n) returns text",
    );
    // No table, policy, trigger, type or view is created or dropped; the one ALTER is the column above.
    expect(sql).not.toMatch(/\b(create|drop)\s+(table|policy|trigger|type|view)\b/i);
    expect(sql).not.toMatch(/\balter\s+(policy|trigger|type|view)\b/i);
    expect(sql).not.toMatch(/\b(drop|rename)\s+column\b/i);
    expect(sql).not.toMatch(/\b(alter|drop)\s+function\b/i);
    expect(sql).not.toMatch(/\bdrop\s+index\b/i);
  });

  it("the attach function is a definer with a pinned search_path; BOTH functions' ceiling is service_role only", () => {
    expect(sql).toMatch(/\) returns text\nlanguage plpgsql\nsecurity definer\nset search_path = pg_catalog, public\nas \$\$/);
    // The only grant / revoke in the file are the two functions' own statements. The table's
    // grants are untouched (a new column inherits them).
    expect(sql.match(/^\s*(grant|revoke)\b[^;]*;/gim)!.map((m) => m.replace(/\s+/g, " ").trim())).toEqual([
      "revoke all on function public.catering_payment_attach_checkout(uuid, uuid, integer, text) from public, anon, authenticated, service_role;",
      "grant execute on function public.catering_payment_attach_checkout(uuid, uuid, integer, text) to service_role;",
      "revoke all on function public.catering_payment_checkout_ready() from public, anon, authenticated, service_role;",
      "grant execute on function public.catering_payment_checkout_ready() to service_role;",
    ]);
    // The readiness function is asserted the same way, by its own post-flight.
    for (const proof of [
      "has_function_privilege('anon', r, 'EXECUTE')",
      "has_function_privilege('authenticated', r, 'EXECUTE')",
      "not has_function_privilege('service_role', r, 'EXECUTE')",
      "aclexplode(p.proacl) a where p.oid = r and a.grantee = 0",
      "if public.catering_payment_checkout_ready() is not true then",
    ]) {
      expect(sql, proof).toContain(proof);
    }
    // …and the post-flight ASSERTS the result instead of trusting it.
    for (const proof of [
      "has_function_privilege('anon', f, 'EXECUTE')",
      "has_function_privilege('authenticated', f, 'EXECUTE')",
      "not has_function_privilege('service_role', f, 'EXECUTE')",
      "aclexplode(p.proacl) a where p.oid = f and a.grantee = 0",
      "p.prosecdef",
    ]) {
      expect(sqlOutsideFn, proof).toContain(proof);
    }
  });

  it("the function LOCKS before it reads: the quote row, then every payment row of the quote, then the checks, then the write", () => {
    const quoteLock = fnBody.indexOf("from public.catering_quotes q where q.id = p_quote_id for update;");
    const rowsLock = fnBody.indexOf("from public.catering_payments p where p.quote_id = p_quote_id order by p.id for update;");
    const paid = fnBody.indexOf("return 'already_paid';");
    const unresolved = fnBody.indexOf("return 'session_unresolved';");
    const write = fnBody.indexOf("update public.catering_payments");
    expect(quoteLock).toBeGreaterThan(0);
    expect(rowsLock).toBeGreaterThan(quoteLock);
    expect(paid).toBeGreaterThan(rowsLock);
    expect(unresolved).toBeGreaterThan(paid);
    expect(write).toBeGreaterThan(unresolved);
    // FOR UPDATE on the quote — not NO KEY UPDATE, which a payment's foreign-key check would slip past.
    expect(fnBody).not.toMatch(/for no key update/i);
    // A session on a due OR a void row is unresolved; any paid row refuses.
    expect(fnBody).toContain("p.status in ('due', 'void') and p.provider_session_id is not null");
    expect(fnBody).toContain("p.quote_id = p_quote_id and p.status = 'paid'");
    // The closed vocabulary the app maps (lib/portal/quotes.ts ATTACH_OUTCOMES).
    const answers = [...fnBody.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]);
    expect([...new Set(answers)].sort()).toEqual(["already_paid", "attached", "in_progress", "not_due", "not_payable", "session_unresolved"]);
    const lib = readFileSync("lib/portal/quotes.ts", "utf8");
    const mapped = lib.match(/const ATTACH_OUTCOMES: readonly AttachOutcome\[\] = \[([^\]]+)\]/)![1]!;
    expect(mapped.split(",").map((v) => v.trim().replace(/"/g, "")).sort()).toEqual([...new Set(answers)].sort());
  });

  it("the readiness function answers for the WHOLE file: the attach function, the index and the marker column", () => {
    const start = sql.indexOf("create function public.catering_payment_checkout_ready()");
    const body = sql.slice(sql.indexOf("as $$", start) + 5, sql.indexOf("\n$$;", start));
    expect(body).toContain("to_regprocedure('public.catering_payment_attach_checkout(uuid,uuid,integer,text)') is not null");
    expect(body).toContain("indexname = 'catering_payments_one_open_checkout'");
    expect(body).toContain("a.attname = 'settlement_cleanup_at' and not a.attisdropped");
    // It reads the catalog only: no table of ours, no write.
    expect(body).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(body).not.toMatch(/from public\./i);
  });

  it("APPLYING it writes NO data: the one UPDATE in the file is inside the function body", () => {
    expect(sqlOutsideFn).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
    // …and the post-flight REFUSES an apply that somehow wrote a marker.
    expect(sql).toContain("raise exception '0303: the apply wrote a settlement marker: refusing';");
    expect(fnBody.match(/\bupdate\s+public\.catering_payments\b/gi)).toHaveLength(1);
    expect(fnBody).not.toMatch(/\b(insert\s+into|delete\s+from|truncate)\b/i);
  });

  it("runs in ONE transaction, with a refusing pre-flight and a verifying post-flight", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    for (const refusal of [
      "raise exception '0303: 0127 (catering_payments) must be applied first';",
      "raise exception '0303: 0204 (catering_payments.provider_session_id) must be applied first';",
      "raise exception '0303: 0130 (catering_payments_one_due) must be applied first';",
      "raise exception '0303: catering_payments_one_open_checkout already exists: refusing a second apply';",
      "raise exception '0303: catering_payment_attach_checkout already exists: refusing a second apply';",
      "raise exception '0303: catering_payment_checkout_ready already exists: refusing a second apply';",
      "raise exception '0303: catering_payments.settlement_cleanup_at already exists: refusing a second apply';",
      "raise exception '0303: catering_payments.settlement_cleanup_at was not created';",
      "raise exception '0303: catering_payments.settlement_cleanup_at is not a nullable timestamptz with no default';",
      "raise exception '0303: catering_payment_checkout_ready was not created';",
      "raise exception '0303: catering_payment_checkout_ready privilege ceiling is not held (service_role only)';",
      "raise exception '0303: catering_payment_checkout_ready is executable by PUBLIC';",
      "raise exception '0303: catering_payment_checkout_ready does not answer true after the apply';",
      "raise exception '0303: 0120 (catering_quotes.superseded_at) must be applied first';",
      "raise exception '0303: catering_payment_attach_checkout was not created';",
      "raise exception '0303: catering_payment_attach_checkout privilege ceiling is not held (service_role only)';",
      "raise exception '0303: catering_payment_attach_checkout is executable by PUBLIC';",
      "raise exception '0303: catering_payment_attach_checkout is not SECURITY DEFINER with search_path = pg_catalog, public';",
      "raise exception '0303: % quote(s) already hold more than one due payment with an open checkout session: refusing",
      "raise exception '0303: catering_payments_one_open_checkout was not created';",
      "raise exception '0303: a pre-existing catering_payments index went missing';",
    ]) {
      expect(sql, refusal).toContain(refusal);
    }
    // The pre-flight runs BEFORE the index is created; the post-flight after.
    expect(sql.indexOf("refusing a second apply")).toBeLessThan(sql.indexOf("create unique index"));
    expect(sql.indexOf("create unique index")).toBeLessThan(sql.indexOf("was not created"));
  });

  it("the header says what a reviewer must know: file-only, APPLY BEFORE ANY STRIPE KEY, the app fails closed without it, and how to roll back", () => {
    // The r3–r5 header promised the opposite ("THE APP WORKS BEFORE THIS IS APPLIED"): gone.
    expect(src).not.toContain("THE APP WORKS BEFORE THIS IS APPLIED");
    expect(src).toContain("THE APP FAILS CLOSED WITHOUT THIS FILE: APPLY 0303 BEFORE ANY STRIPE KEY IS SET");
    expect(src).toContain("ORDER OF ROLLOUT: (1) apply this file (sim, then prod), (2) deploy, (3) only then may Stripe keys be set.");
    expect(src).toContain("NO DATA IS WRITTEN, MOVED OR DELETED BY THE APPLY.");
    // The rollback names every object, the readiness function FIRST, and says to remove the keys before it.
    const rollback = src.slice(src.indexOf("-- ROLLBACK"), src.indexOf("\nbegin;"));
    expect(rollback).toContain("FIRST remove every Stripe key");
    const order = [
      "--   drop function public.catering_payment_checkout_ready();",
      "--   drop function public.catering_payment_attach_checkout(uuid, uuid, integer, text);",
      "--   drop index public.catering_payments_one_open_checkout;",
      "--   alter table public.catering_payments drop column settlement_cleanup_at;",
    ].map((line) => rollback.indexOf(line));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("the app reads the index's 23505 as `payment_in_progress`, and REFUSES — never falls back — without the functions", () => {
    const lib = readFileSync("lib/portal/quotes.ts", "utf8").replace(/\r\n/g, "\n");
    // The attach answers a unique violation with `in_progress`…
    expect(lib).toMatch(/error\.code === "23505" \|\| error\.code === "40P01" \|\| error\.code === "55P03"\) return "in_progress";/);
    // …which the caller refuses as 409 payment_in_progress, after closing the session it minted.
    expect(lib).toMatch(/if \(attached !== "attached"\) \{\n\s+await abandonSession\(creds\.secretKey, session\.id\);/);
    expect(lib).toMatch(/default:\n[^\n]*\n\s+throw new PortalQuoteError\(409, "payment_in_progress"/);
    // A missing function is PostgREST's PGRST202 (Postgres: 42883). The app REFUSES on it — at
    // the readiness question, before any Stripe call, and again at the attach itself.
    expect(lib).toMatch(/return error\.code === "PGRST202" \|\| error\.code === "42883"/);
    expect(lib).toMatch(/const \{ data, error \} = await sb\.rpc\("catering_payment_checkout_ready"\);\n\s+if \(error\) \{\n\s+if \(isMissingFunction\(error\)\) \{/);
    expect(lib).toMatch(/if \(data !== true\) \{/);
    expect(lib).toMatch(/new PortalQuoteError\(503, "payment_unavailable"/);
    expect(lib).not.toMatch(/attachCheckoutSessionUnlocked/);
    // The readiness question comes BEFORE the first Stripe call of `createQuoteCheckout`.
    const fn = lib.slice(lib.indexOf("export async function createQuoteCheckout("));
    const asked = fn.indexOf("await requireCheckoutSchema(sb);");
    expect(asked).toBeGreaterThan(0);
    for (const stripeCall of ["retireOrRefuse(", "inspectOrRefuse(", "createCheckoutSession("]) {
      expect(fn.indexOf(stripeCall), stripeCall).toBeGreaterThan(asked);
    }
    // Nothing queries the catalog itself; 0303's own function answers for it.
    expect(lib).not.toMatch(/pg_indexes|to_regclass|pg_proc/);
  });
});
