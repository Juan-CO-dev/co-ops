/**
 * W19 — migration 0325 pinned: the house header and gate line, one transaction, the pre-flight, the lock-order rule
 * (the confirm RPC never writes po_lines), and the executable PGlite proof (scripts/sql-harness-0325.mjs).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const m0325 = read("supabase/migrations/0325_po_confirm_lines_and_vendor_child_removal.sql");
function fn(sql: string, head: string): string {
  const i = sql.indexOf(head);
  expect(i, `${head} not found`).toBeGreaterThan(-1);
  return sql.slice(i, sql.indexOf("end $$;", i) + "end $$;".length);
}

describe("0325_po_confirm_lines_and_vendor_child_removal", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const lines = m0325.split("\n");
    expect(lines[0]).toBe("-- Migration 0325_po_confirm_lines_and_vendor_child_removal");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word\)\.$/);
    for (const section of ["-- WHAT", "-- EXISTING ROWS:", "-- APP COMPATIBILITY:", "-- ROLLBACK:", "-- PRE-FLIGHT"]) expect(m0325).toContain(section);
  });

  it("is one transaction with a pre-flight that refuses without its dependencies", () => {
    expect(m0325).toMatch(/\nbegin;\n/);
    expect(m0325.trimEnd().endsWith("commit;")).toBe(true);
    expect(m0325).toContain("raise exception '0325: 0190 (po_lines_po_sku_uq) must be applied first';");
    expect(m0325).toContain("raise exception '0325: 0174 (purchase_orders, po_lines) must be applied first';");
  });

  it("the confirm RPC never writes po_lines (an editor holds a line lock while it waits for the PO lock)", () => {
    const body = fn(m0325, "create or replace function public.confirm_purchase_order(");
    expect(body).toContain("for no key update");
    expect(body).not.toMatch(/\b(update|insert into|delete from)\s+public\.po_lines\b/i);
    const trigger = fn(m0325, "create or replace function public.po_lines_draft_only()");
    expect(trigger).toContain("for share");
  });

  it("is idempotent: re-runnable objects only, nothing rewritten", () => {
    expect(m0325).toContain("add column if not exists email_send_uncertain_at");
    expect(m0325).toContain("add column if not exists email_attempt_key text null");
    expect(m0325).toContain("add column if not exists email_attempt_at timestamptz null");
    expect(m0325).toContain("drop trigger if exists po_lines_draft_only on public.po_lines;");
    const outside = m0325.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
      .replace(/create or replace function[\s\S]*?end \$\$;/g, "");
    expect(outside).not.toMatch(/\b(update public\.|insert into|delete from|truncate)\b/i);
  });

  it("the PGlite proof passes", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0325.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/PASS 0325: \d+ checks/);
  }, 240_000);
});
