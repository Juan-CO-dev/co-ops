/**
 * Item 21 PR 3: Migration 0347 (the LINK step). File only; CC applies sim then prod on Juan's word.
 * Pins the file's shape and runs the offline PGlite proof (scripts/sql-harness-0347.mjs) against the REAL 0229
 * publisher, 0231 planner and 0330 reconciler. The two contracts PR 2 left for PR 3 (runbook, Astra r3 #1 and #2) are
 * proven there; this file pins that the planner is 0231 plus ADDED lines only and that no ezCater writer is re-emitted.
 * Migrations are pinned BY NAME, never "the latest".
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0347_catering_toast_link_step.sql");
const code = sql.replace(/--[^\n]*/g, "");
const fn = (src: string, name: string) => src.match(new RegExp(`create (?:or replace )?function public\\.${name}[\\s\\S]*?\\n(?:end \\$\\$;|\\$plan\\$;|\\$\\$;)`))![0];

/** Every line of `a` appears in `b`, in order (b may add lines). */
function isLineSubsequence(a: string, b: string): boolean {
  const bs = b.split("\n");
  let j = 0;
  for (const line of a.split("\n")) {
    while (j < bs.length && bs[j] !== line) j += 1;
    if (j === bs.length) return false;
    j += 1;
  }
  return true;
}

describe("0347 header and shape", () => {
  it("gate header, one transaction, file only, the number explained", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0347_catering_toast_link_step");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-18 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(sql).toMatch(/0346 may be claimed by board PR 2/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
  });

  it("re-emits the ezCater PLANNER only: 0231's body is a line-subsequence of the new one", () => {
    const old = fn(read("0231_ezcater_reconcile_planner_speed.sql"), "plan_ezcater_toast");
    const neu = fn(sql, "plan_ezcater_toast");
    expect(isLineSubsequence(old, neu)).toBe(true);
    // The added lines are the 0347 ownership / dual-code predicates and nothing else.
    const added = neu.split("\n").filter((l) => !old.split("\n").includes(l));
    expect(added.length).toBeLessThanOrEqual(16);
    for (const line of added) expect(line).toMatch(/0347|house|catering_toast_|ezcater_toast_links z|z\.order_guid|tokens k$|r\.code_norm|^\s*(or )?exists|totals\. ezCater|^ and \(public|^ or exists|retires an owner/);
  });

  it("never re-emits the publisher, the reconciler, apply or transfer, and never updates ezcater_toast_links", () => {
    expect(code).not.toMatch(/function\s+public\.(publish_ezcater_shadow|reconcile_ezcater_toast|apply_ezcater_order|transfer_catering_lead)\b/i);
    expect(code).not.toMatch(/(update|insert\s+into|delete\s+from)\s+public\.ezcater_toast_links\b/i);
    expect(code).toContain("create trigger ezcater_toast_links_house_guard before insert on public.ezcater_toast_links");
  });

  it("the publisher guard cannot raise: every statement sits inside one exception block that passes the row", () => {
    const guard = fn(sql, "ezcater_toast_links_house_guard");
    expect(guard).not.toMatch(/raise\s+exception/i);
    expect(guard).toMatch(/exception when others then\n\s+return new;/);
  });

  it("every link insert is the writer's, after the reconcile lock; audit names are literal", () => {
    const writer = fn(sql, "decide_catering_toast");
    const lock = writer.indexOf("perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));");
    expect(lock).toBeGreaterThan(0);
    expect(writer.indexOf("insert into public.catering_toast_links")).toBeGreaterThan(lock);
    expect(code.match(/insert into public\.catering_toast_links\b/g)).toHaveLength(1);
    for (const name of ["catering.toast_link", "catering.toast_unlink", "catering.toast_not_a_match", "catering.toast_no_ring_expected", "catering.toast_ring_expected"]) {
      expect(writer).toContain(`'${name}'`);
    }
  });

  it("the conflict ledger is deny-all with a service-role SELECT ceiling", () => {
    for (const op of ["select", "insert", "update", "delete"]) {
      expect(code).toContain(`create policy catering_toast_conflicts_no_user_${op} on public.catering_toast_conflicts`);
    }
    expect(code).toContain("grant select on public.catering_toast_conflicts to service_role;");
    expect(code).not.toMatch(/grant\s+(insert|update|delete|all)/i);
  });

  it("the token rule is 0229's, verbatim", () => {
    const token = "regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok";
    expect(read("0231_ezcater_reconcile_planner_speed.sql")).toContain(token);
    expect(fn(sql, "catering_toast_check_house_code")).toContain(token);
  });
});

describe("0347 executable proof", () => {
  it("scripts/sql-harness-0347.mjs passes on the real 0229 / 0231 / 0330 / 0344 bodies", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0347.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/sql-harness-0347: \d+ checks passed/);
  }, 180_000);
});
