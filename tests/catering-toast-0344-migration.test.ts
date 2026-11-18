/**
 * Item 21 PR 1: Migration 0344 (the house side). File only; CC applies sim then prod on Juan's word.
 * Runs the offline PGlite proof (scripts/sql-harness-0344.mjs) and pins the file's shape: one transaction, the gate
 * header, nothing written to an ezCater table, settings off by default, the partition's valuation lines copied from
 * 0232, and every new table behind deny-all RLS with a service-role SELECT ceiling.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0344_catering_toast_house_side.sql");
const code = sql.replace(/--[^\n]*/g, "");

describe("0344 header and shape", () => {
  it("house header, one transaction, file only, and the number is explained", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0344_catering_toast_house_side");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-18 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(sql).toMatch(/0343 may be claimed by the board PR in flight/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
  });

  it("writes no link, no decision and nothing ezCater", () => {
    expect(code).not.toMatch(/(insert\s+into|update|delete\s+from)\s+public\.(ezcater_\w+|catering_toast_links|catering_toast_link_decisions)\b/i);
    expect(code).not.toMatch(/function\s+public\.\w*ezcater\w*/i);
    // The one write in the file: the ring code, on a lead that has none, inside ensure_catering_ring_code.
    expect(code.match(/update\s+public\.\w+/gi)).toEqual(["update public.catering_pipeline"]);
  });

  it("every switch defaults OFF and no row is seeded", () => {
    for (const s of ["enabled", "ring_code_enabled", "auto_link_enabled", "origin_auto_link_enabled", "include_toast_origin_leads"]) {
      expect(code).toMatch(new RegExp(`\\n\\s+${s}\\s+boolean not null default false,`));
    }
    expect(code).not.toMatch(/insert\s+into\s+public\.catering_toast_settings/i);
  });

  it("the partition values leads exactly as 0232's sales_report_catering_values does", () => {
    const src = read("0232_reports_sales_reads.sql").match(/create function public\.sales_report_catering_values[\s\S]*?\nend \$\$;/)![0];
    const dst = code.match(/create function public\.catering_pipeline_reconciliation[\s\S]*?\nend \$\$;/)![0];
    for (const line of [
      "perform public.sales_report_assert_window(p_location_id, p_from, p_to);",
      "from public.catering_pipeline p",
      "left join lateral (",
      "select qq.total_cents from public.catering_quotes qq",
      "where qq.pipeline_id = p.id and qq.superseded_at is null and qq.status = 'accepted'",
      "order by qq.version desc limit 1) q on true",
      "where p.location_id = p_location_id and p.event_date between p_from and p_to",
    ]) {
      expect(src).toContain(line);
      expect(dst).toContain(line);
    }
    expect(src).toContain("coalesce(q.total_cents, p.estimated_revenue_cents)::bigint as value_cents");
    expect(dst).toContain("coalesce(q.total_cents, p.estimated_revenue_cents)::bigint as value_cents");
  });

  it("three new tables, twelve deny-all policies, a service-role SELECT ceiling", () => {
    for (const t of ["catering_toast_settings", "catering_toast_link_decisions", "catering_toast_links"]) {
      expect(code).toContain(`alter table public.${t} enable row level security;`);
      for (const op of ["select", "insert", "update", "delete"]) expect(code).toContain(`create policy ${t}_no_user_${op} on public.${t}`);
    }
    expect(code).toContain("grant select on public.catering_toast_settings, public.catering_toast_link_decisions, public.catering_toast_links to service_role;");
    expect(code).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });
});

describe("0344 executable proof", () => {
  it("scripts/sql-harness-0344.mjs passes on the real 0221 / 0232 bodies", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0344.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/sql-harness-0344: \d+ checks passed/);
  }, 120_000);
});
