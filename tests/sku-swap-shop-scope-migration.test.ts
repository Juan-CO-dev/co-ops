/**
 * W08/B057 — migration 0308 pinned: the house header and gate line, the executable PGlite proof, and the two
 * re-emitted functions are 0265's bodies EXACTLY except the two blocks marked 0308 (no other drift).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const m0308 = read("supabase/migrations/0308_sku_swap_shop_scope.sql");
const m0265 = read("supabase/migrations/0265_sku_swaps.sql");

function fn(sql: string, head: string): string {
  const i = sql.indexOf(head);
  expect(i, `${head} not found`).toBeGreaterThan(-1);
  const j = sql.indexOf("end $$;", i);
  return sql.slice(i, j + "end $$;".length);
}

const START_0308_BLOCK = [
  "  -- 0308 (W08/B057): a swap never moves another shop. Only a product THIS swap created gets a default",
  "  -- (pinned to the old item, so every other shop keeps resolving to what it had); an existing product",
  "  -- without a default refuses rather than guess.",
  "  if not v_created then raise exception 'swap:product_needs_primary' using errcode='P0001'; end if;",
].join("\n") + "\n";
const END_0308_BLOCK = [
  " -- 0308 (W08/B057): a pre-0308 journal may hold a default made for an EXISTING product (not grouping_created);",
  " -- it moved every other shop. Remove it only at its exact id + revision (untouched since the swap made it).",
  " if s.default_created is not null and not s.grouping_created then",
  "  delete from public.product_primaries",
  "   where id=(s.default_created->>'id')::uuid and revision=(s.default_created->>'revision')::bigint;",
  " end if;",
].join("\n") + "\n";

describe("0308_sku_swap_shop_scope", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0308_sku_swap_shop_scope"
        && /^-- AUTHORED 2026-11-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0265\)\.$/.test(lines[1] ?? "");
    };
    expect(ok(m0308)).toBe(true);
    expect(m0308).toContain("-- ROLLBACK:");
    expect(m0308).toContain("-- PRE-FLIGHT");
    expect(m0308).toContain("-- EXISTING ROWS:");
  });

  it("is one transaction under the graph lock, with a preflight that refuses without 0265", () => {
    expect(m0308).toMatch(/\nbegin;\n/);
    expect(m0308.trimEnd().endsWith("commit;")).toBe(true);
    expect(m0308).toContain("select pg_advisory_xact_lock(7258025800);");
    expect(m0308).toContain("raise exception '0308: 0265 (sku swaps) must be applied first';");
    // No table, column or row change: functions and grants only.
    const outsideBodies = m0308
      .replace(fn(m0308, "create or replace function public.start_sku_swap("), "")
      .replace(fn(m0308, "create or replace function public.end_sku_swap("), "")
      .split("\n").filter((l) => !l.startsWith("--")).join("\n");
    expect(outsideBodies).not.toMatch(/\b(alter table|create table|drop |update public\.|insert into|delete from|truncate)\b/i);
  });

  it("start_sku_swap is 0265's body exactly, plus the product_needs_primary guard", () => {
    const before = fn(m0265, "create function public.start_sku_swap(");
    const after = fn(m0308, "create or replace function public.start_sku_swap(");
    expect(after).toContain(START_0308_BLOCK);
    expect(after.replace(START_0308_BLOCK, "")).toBe(before.replace(/^create function/, "create or replace function"));
    // The guard sits AFTER the stale-evidence checks and BEFORE the default insert.
    expect(after.indexOf("swap:product_needs_primary")).toBeGreaterThan(after.indexOf("swap:recipes_changed"));
    expect(after.indexOf("swap:product_needs_primary")).toBeLessThan(after.indexOf("insert into public.product_primaries(product_id,primary_sku_id,updated_by)"));
  });

  it("end_sku_swap is 0265's body exactly, plus the pre-0308 default cleanup before the grouping block", () => {
    const before = fn(m0265, "create function public.end_sku_swap(");
    const after = fn(m0308, "create or replace function public.end_sku_swap(");
    expect(after).toContain(END_0308_BLOCK);
    expect(after.replace(END_0308_BLOCK, "")).toBe(before.replace(/^create function/, "create or replace function"));
    expect(after.indexOf(END_0308_BLOCK)).toBeLessThan(after.indexOf("-- Any new reference, member, primary rechoice or recipe edit keeps the grouping."));
    expect(after.indexOf(END_0308_BLOCK)).toBeGreaterThan(after.indexOf("v_primary:='restored';"));
  });

  it("re-asserts the 0265 ACL: service_role only, no PUBLIC, definer with a pinned search_path", () => {
    expect(m0308).toContain("revoke all on function public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb),public.end_sku_swap(uuid,uuid) from public,anon,authenticated;");
    expect(m0308).toContain("grant execute on function public.start_sku_swap(uuid,uuid,uuid,uuid,jsonb,jsonb,boolean,text,jsonb),public.end_sku_swap(uuid,uuid) to service_role;");
    expect(m0308).toContain("raise exception '0308: PUBLIC holds EXECUTE on %', f;");
    expect(m0308).toContain("raise exception '0308: % must be SECURITY DEFINER with a pinned search_path', f;");
  });

  it("the executable proof (PGlite: the REAL 0258 → 0265 + 0308 on synthetic rows) runs green", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0308.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0308:");
  }, 260_000);
});
