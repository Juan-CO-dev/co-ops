/**
 * 0331 (audit wave W23, owner decision W23-5 b): the offline PGlite proof, plus a pin that the
 * re-emitted apply_ezcater_order keeps every 0225 line except the unmapped-location gate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0331_ezcater_unmapped_shop_lifecycle.sql");
const body = (text: string) => {
  const m = text.match(/create or replace function public\.apply_ezcater_order\([\s\S]*?\nend \$\$;/);
  if (!m) throw new Error("no apply body");
  return m[0].split("\n").map((l) => l.trim()).filter(Boolean);
};

describe("0331 header and shape", () => {
  it("house header, prod apply on Juan's word, one transaction", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0331_ezcater_unmapped_shop_lifecycle");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-15\. NOT YET APPLIED - sim first; PROD APPLY ONLY ON JUAN'S WORD/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("re-emits 0225's apply_ezcater_order changing only the unmapped gate and the fetch-failure result", () => {
    const src = body(read("0225_ezcater_pass2.sql")), dst = body(sql);
    const missing: string[] = [];
    let j = 0;
    for (const line of src) {
      const k = dst.indexOf(line, j);
      if (k < 0) missing.push(line); else j = k + 1;
    }
    expect(missing).toEqual([
      "if (select count(*) from public.locations where active and ezcater_caterer_uuid = p_caterer_uuid) <> 1 then",
      "raise exception 'unmapped_location';",
      "select id into v_location from public.locations where active and ezcater_caterer_uuid = p_caterer_uuid;",
      "'created',false,'from_stage',v_lead.stage,'to_stage',coalesce(v_target,v_lead.stage),'location_id',v_location);",
    ]);
  });
});

it("0331 offline proof: frozen before, lifecycle applies at the lead's shop after; new orders still parked", () => {
  const output = execFileSync(process.execPath, ["scripts/sql-harness-0331.mjs"], { encoding: "utf8", timeout: 300_000 });
  expect(output).toMatch(/EXPECTED FAIL 0331 broken variant/);
  expect(output).toMatch(/^PASS 0331: \d+ checks/m);
}, 300_000);
