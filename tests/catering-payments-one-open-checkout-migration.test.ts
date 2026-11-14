/**
 * Migration 0303 pinned (bug audit 2026-11-14, wave W02, finding B035): ONE open Stripe
 * Checkout Session per quote, as a partial unique index on `catering_payments`.
 *
 * The app retires a quote's other open session before it mints a new one (lib/portal/
 * quotes.ts `createQuoteCheckout`, tests/portal-quote-payments.test.ts); this index is the
 * arbiter for the case code cannot close — two requests racing. What is pinned here: the
 * house header and gate line, the executable PGlite proof, the single object the file
 * creates, its refusals, and that it writes no data and changes no privilege.
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

  it("creates exactly one object: the partial UNIQUE index on (quote_id) for due rows that hold a session", () => {
    expect(sql).toContain(
      "create unique index catering_payments_one_open_checkout\n  on public.catering_payments (quote_id)\n  where status = 'due' and provider_session_id is not null;",
    );
    // Statements only (line-anchored): the post-flight quotes the definition inside a regex.
    expect(sql.match(/^create\s+(unique\s+)?index\b/gim)).toHaveLength(1);
    // No table, column, function, policy, trigger, grant or revoke.
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+(table|function|policy|trigger|type|view)\b/i);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    expect(sql).not.toMatch(/\bdrop\s+index\b/i);
  });

  it("writes NO data: no insert, update, delete or truncate anywhere in the executable SQL", () => {
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
  });

  it("runs in ONE transaction, with a refusing pre-flight and a verifying post-flight", () => {
    expect(sql.trimStart().startsWith("begin;")).toBe(true);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    for (const refusal of [
      "raise exception '0303: 0127 (catering_payments) must be applied first';",
      "raise exception '0303: 0204 (catering_payments.provider_session_id) must be applied first';",
      "raise exception '0303: 0130 (catering_payments_one_due) must be applied first';",
      "raise exception '0303: catering_payments_one_open_checkout already exists: refusing a second apply';",
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

  it("the header says what a reviewer must know: file-only, no ordering with the deploy, and how to roll back", () => {
    expect(src).toContain("THE APP WORKS BEFORE THIS IS APPLIED");
    expect(src).toContain("NO DATA IS WRITTEN, MOVED OR DELETED.");
    expect(src).toContain("--   drop index public.catering_payments_one_open_checkout;");
  });

  it("the app reads the index's 23505 as `payment_in_progress` and works without the index", () => {
    const lib = readFileSync("lib/portal/quotes.ts", "utf8");
    expect(lib).toMatch(/updErr\.code === "23505"[\s\S]{0,200}payment_in_progress/);
    // Nothing queries the index or branches on its existence.
    expect(lib).not.toMatch(/pg_indexes|to_regclass/);
  });
});
