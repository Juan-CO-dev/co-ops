/**
 * Scheduling Phase 1, Task 18 — migration 0271 pinned: the header, the 0267 posture check as the FIRST
 * statement, the executable PGlite proof (which runs the SHARED grade-target and lifecycle case files against
 * the RPCs), the ceilings, the composite FKs, the lock order, and no notification anywhere.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";

const src = normalize(readFileSync("supabase/migrations/0271_pm_reports_v2.sql", "utf8"));
const RPCS = [
  ["open_pm_copy", "uuid, uuid"],
  ["save_pm_copy_grade", "uuid, uuid, uuid, uuid, uuid, text"],
  ["save_pm_copy_note", "uuid, uuid, uuid, uuid, text"],
  ["add_pm_copy_position", "uuid, uuid, uuid, uuid, text"],
  ["set_pm_copy_window", "uuid, uuid, timestamptz, timestamptz"],
  ["mark_pm_copy_done", "uuid, uuid"],
  ["reopen_pm_copy", "uuid, uuid"],
  ["submit_pm_day_v2", "uuid, uuid"],
] as const;
const COPY_TABLES = ["pm_report_copies", "pm_copy_grades", "pm_copy_notes", "pm_copy_positions"];

describe("0271_pm_reports_v2", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0271_pm_reports_v2"
        && /^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0270; REQUIRES 0267\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO PROD 2026-10-20 (schema_migrations version 20261020000004, name 'pm_reports_v2')", ...rest].join("\n"))).toBe(true);
  });

  it("the FIRST statement after begin refuses without 0267's posture, before any object is created", () => {
    const statements = src.split("\n").filter((l) => l.trim() !== "" && !l.startsWith("--"));
    expect(statements[0]).toBe("begin;");
    expect(statements[1]).toMatch(/^do \$\$/);
    const firstBlock = src.slice(src.indexOf("do $$"), src.indexOf("end $$;") + 7);
    expect(firstBlock).toContain("policyname = 'pm_evals_read_self'");
    expect(firstBlock).toContain("raise exception '0271: requires 0267_pm_evals_privacy'");
    expect(src.indexOf("raise exception '0271: requires 0267_pm_evals_privacy'")).toBeLessThan(src.search(/\n(alter|create) /));
  });

  it("the executable proof (PGlite: the REAL 0072/0073/0267/0270 + 0271, both shared case files) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0271.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("P1-1 save_pm_copy_grade agrees with the shared case file");
    expect(out).toContain("LC the RPC guards agree with the shared lifecycle file");
    expect(out).toContain("P0 on the PRE-0267 posture the first statement refuses");
    expect(out).toContain("PASS 0271:");
  }, 260_000);

  it("deny-all: RLS on, no policy; criteria at the SELECT/INSERT/UPDATE ceiling, the copy tables SELECT only", () => {
    expect(src).toContain(`revoke all on public.pm_criteria, public.${COPY_TABLES.join(", public.")}\n  from public, anon, authenticated, service_role;`);
    expect(src).toContain("grant select, insert, update on public.pm_criteria to service_role;");
    expect(src).toContain(`grant select on public.${COPY_TABLES.join(", public.")} to service_role;`);
    for (const t of ["pm_criteria", ...COPY_TABLES]) expect(src).toContain(`alter table public.${t} enable row level security;`);
    expect(src).not.toMatch(/create policy/i);
    expect(src).toContain("v_manifest is distinct from 'service_role:INSERT,service_role:SELECT,service_role:UPDATE'");
  });

  it("r1 P1-1: copy, criterion and position share the report's shop by COMPOSITE foreign keys", () => {
    expect(src).toContain("constraint pm_report_copies_report_at_shop foreign key (pm_report_id, location_id) references public.pm_reports (id, location_id)");
    for (const t of ["pm_copy_grades", "pm_copy_notes", "pm_copy_positions"]) {
      expect(src).toContain(`constraint ${t}_copy_at_shop foreign key (copy_id, location_id) references public.pm_report_copies (id, location_id)`);
      expect(src).toContain(`constraint ${t}_position_at_shop foreign key (position_id, location_id) references public.station_positions (id, location_id)`);
    }
    expect(src).toContain("constraint pm_copy_grades_criterion_at_shop foreign key (criterion_id, location_id) references public.pm_criteria (id, location_id)");
    expect(src).toContain("constraint pm_criteria_position_at_shop foreign key (position_id, location_id) references public.station_positions (id, location_id)");
  });

  it("every RPC is SECURITY DEFINER, pinned, service_role only; each writer goes through the ONE lock (day row first)", () => {
    for (const [name, types] of RPCS) {
      const fn = extractFunction(src, `create function public.${name}(`, "end $$;");
      expect(fn, name).toContain("security definer set search_path = pg_catalog, public as $$");
      expect(src).toContain(`revoke all on function public.${name}(${types}) from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${name}(${types}) to service_role;`);
    }
    const lock = extractFunction(src, "create function public.pm_copy_lock(", "end $$;");
    expect(lock.indexOf("from public.pm_reports where id = v_report for update")).toBeLessThan(lock.indexOf("from public.pm_report_copies where id = p_copy for update"));
    for (const name of ["save_pm_copy_grade", "save_pm_copy_note", "add_pm_copy_position", "set_pm_copy_window"]) {
      expect(extractFunction(src, `create function public.${name}(`, "end $$;"), name).toContain("public.pm_copy_lock(p_actor, p_copy, 'write')");
    }
    expect(extractFunction(src, "create function public.mark_pm_copy_done(", "end $$;")).toContain("public.pm_copy_lock(p_actor, p_copy, 'markDone')");
    expect(extractFunction(src, "create function public.reopen_pm_copy(", "end $$;")).toContain("public.pm_copy_lock(p_actor, p_copy, 'reopen')");
    const submit = extractFunction(src, "create function public.submit_pm_day_v2(", "end $$;");
    expect(submit).toContain("where id = p_report and status = 'open' and format = 'v2' and superseded_at is null;");
    expect(submit.indexOf("for update")).toBeLessThan(submit.indexOf("update public.pm_report_copies"));
  });

  it("the grade guards run in the plan's order", () => {
    const fn = extractFunction(src, "create function public.save_pm_copy_grade(", "end $$;");
    const at = (s: string) => { const i = fn.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const order = [
      at("public.pm_copy_lock(p_actor, p_copy, 'write')"),
      at("public.pm_v2_subject_ok(p_subject, v_copy.location_id)"),
      at("public.people_position_at_shop(p_position, v_copy.location_id)"),
      at("raise exception 'position_not_worked'"),
      at("raise exception 'criterion_mismatch'"),
      at("update public.pm_copy_grades set superseded_at"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("no notification: no 0271 statement mentions one", () => {
    expect(src.replace(/^--.*$/gm, "")).not.toMatch(/notification/i);
  });
});
