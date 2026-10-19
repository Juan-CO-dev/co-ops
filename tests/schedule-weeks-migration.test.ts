/**
 * Scheduling Phase 2, Task 14 — migration 0275 pinned: the header and gate line, the executable PGlite proof (the
 * historical contract end to end, inheritance integrity, the confirmation check, every unresolved_search gap blocking
 * Approve, the shared shape case files, a real generator week), the deny-all posture, the definer writers, the lib's
 * named arguments, every refusal a ScheduleErrorCode, the 0268 lease re-emit (a line-for-line extension), and what the
 * content comparison binds.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMods, extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";
import { SCHEDULE_ERROR_CODES } from "@/lib/scheduling/errors-shared";
import { approveWeekCall, commitRevisionCall } from "@/lib/scheduling/rpc-args-shared";
import { CONTEXT_MAX_BYTES } from "@/lib/scheduling/context-shared";

const src = normalize(readFileSync("supabase/migrations/0275_schedule_weeks.sql", "utf8"));
const src0268 = normalize(readFileSync("supabase/migrations/0268_sevenshifts_sync.sql", "utf8"));
const src0274 = normalize(readFileSync("supabase/migrations/0274_schedule_settings.sql", "utf8"));
const TABLES = ["schedule_weeks", "schedule_revisions", "schedule_revision_shifts", "schedule_revision_days", "schedule_revision_gaps",
  "schedule_revision_contexts", "schedule_week_approvals"];

function sqlParams(name: string): string[] {
  const fn = extractFunction(src, `create function public.${name}(`, "returns");
  const inner = fn.slice(fn.indexOf("(") + 1, fn.lastIndexOf(")"));
  return inner.split(",").map((p) => p.trim().split(/\s+/)[0]!).filter(Boolean);
}

describe("0275_schedule_weeks", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0275_schedule_weeks"
        && /^-- AUTHORED 2026-10-16\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0274\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO SIM 2026-10-20 (schema_migrations version 20261020000002, name 'schedule_weeks')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the stub's Supabase grants, the REAL 0243 / 0268 / 0270 / 0274, then 0275; writers called as the lib calls them) runs green", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0275.mjs"], { encoding: "utf8", timeout: 300_000 });
    expect(out).not.toContain("FAIL ");
    for (const line of [
      "W3 valid_schedule_segments agrees with the shared segment case file",
      "W3 valid_gap_certificate agrees with the shared certificate case file",
      "W5 (c) Monday carried UNCHANGED after U was deactivated and P retired → ACCEPTED",
      "W5 (d) a NEW future shift for the deactivated U → person_not_at_shop",
      "W5 (d) a NEW future shift on the retired P → position_retired",
      "W6 r4 P1: Approve refuses while ANY unresolved_search gap exists",
      "W7 (a) a FUTURE inherited shift moved to another ACTIVE position → history_changed",
      "W7 (c) a PAST inherited gap dropped → history_changed",
      "W8 generated → edited → regenerated WITHOUT the confirmation → edited_week_unconfirmed (a CONFIRMATION check, not a password check)",
      "W10 approve writes NO revision",
      "W15 golden F1",
      "PASS 0275:",
    ]) expect(out, line).toContain(line);
  }, 320_000);

  it("deny-all: every table RLS on, no policy, SELECT-only for service_role", () => {
    expect(src).toContain(`revoke all on public.${TABLES.slice(0, 4).join(", public.")},\n  public.${TABLES.slice(4).join(", public.")}\n  from public, anon, authenticated, service_role;`);
    expect(src).toContain(`grant select on public.${TABLES.slice(0, 4).join(", public.")},\n  public.${TABLES.slice(4).join(", public.")}\n  to service_role;`);
    for (const t of TABLES) expect(src).toContain(`alter table public.${t} enable row level security;`);
    expect(src).not.toMatch(/create policy/i);
    expect(src).not.toMatch(/grant (insert|update|delete|all)/i);
  });

  it("the two writers: SECURITY DEFINER, pinned search_path, service_role only; the week lock before the week row", () => {
    for (const [name, types] of [
      ["commit_schedule_revision", "uuid, uuid, date, uuid, text, uuid, jsonb, jsonb, jsonb, jsonb, jsonb"],
      ["approve_schedule_week", "uuid, uuid, date, uuid"],
    ] as const) {
      const fn = extractFunction(src, `create function public.${name}(`, "end $$;");
      expect(fn, name).toContain("returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$");
      expect(fn.indexOf("pg_advisory_xact_lock(hashtextextended('schedule-week/'"), name).toBeGreaterThan(-1);
      expect(fn.indexOf("pg_advisory_xact_lock"), name).toBeLessThan(fn.indexOf("select * into v_week"));
      expect(src).toContain(`revoke all on function public.${name}(${types}) from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${name}(${types}) to service_role;`);
    }
  });

  it("the lib's named arguments (rpc-args-shared) are EXACTLY each writer's SQL parameters, in order", () => {
    const commit = commitRevisionCall({ actorId: null, locationId: "l", weekStart: "2026-10-26", expectedHead: null, kind: "generated", structureVersionId: null,
      shifts: [], days: [], gaps: [], context: {}, meta: { actorContext: "cron", inputsDigest: "d", generatorVersion: "p2.2", problemsSummary: {}, contextDigest: "x" } });
    expect(Object.keys(commit.args)).toEqual(sqlParams("commit_schedule_revision"));
    const approve = approveWeekCall({ actorId: "a", locationId: "l", weekStart: "2026-10-26", expectedHead: "h" });
    expect(Object.keys(approve.args)).toEqual(sqlParams("approve_schedule_week"));
    // The meta keys the builder emits are a subset of the keys SQL accepts.
    const accepted = ["actor_context", "confirmed_overwrite", "inputs_digest", "generator_version", "horizon_run_id", "problems_summary", "revision_id", "context_digest"];
    const full = commitRevisionCall({ actorId: "a", locationId: "l", weekStart: "2026-10-26", expectedHead: "h", kind: "edited", structureVersionId: null, shifts: [], days: [], gaps: [],
      context: {}, meta: { actorContext: "user", confirmedOverwrite: true, inputsDigest: "d", generatorVersion: "p2.2", horizonRunId: null, problemsSummary: {}, revisionId: "r", contextDigest: "x" } });
    expect(Object.keys(full.args.p_meta).sort()).toEqual([...accepted].sort());
    for (const k of accepted) expect(extractFunction(src, "create function public.commit_schedule_revision(", "end $$;")).toContain(`'${k}'`);
  });

  it("every refusal the schedule writers raise is a ScheduleErrorCode (the lease's own invalid_cron_route aside)", () => {
    const withoutLease = src.slice(0, src.indexOf("-- ── THE CRON LEASE"));
    const raised = [...withoutLease.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]!);
    for (const code of new Set(raised)) expect(SCHEDULE_ERROR_CODES as readonly string[], code).toContain(code);
    for (const code of ["head_moved", "shop_not_enabled", "past_week", "day_locked", "edited_week_unconfirmed", "history_changed", "person_not_at_shop",
      "shift_over_maximum", "unresolved_gaps", "rules_failing", "week_not_found", "gap_certificate_invalid", "edit_segments_malformed", "edit_overlap", "invalid_payload"]) {
      expect(raised, code).toContain(code);
    }
  });

  it("claim_cron_route is 0268's body with exactly the job list extended by 'schedule-draft' (nothing else moved)", () => {
    const body = (s: string) => extractFunction(s, "function public.claim_cron_route(p_job text)", "end $$;");
    const expected = applyMods(body(src0268), [[
      "p_job not in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync')",
      "p_job not in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft')",
    ]]);
    expect(body(src)).toBe(expected);
    expect(src).toContain("add constraint cron_route_leases_job_check check (job in ('toast-sales-today', 'toast-catering-scan', 'sevenshifts-sync', 'schedule-draft'))");
    expect(src).toMatch(/revoke all on function public\.claim_cron_route\(text\) from public, anon, authenticated;\ngrant execute on function public\.claim_cron_route\(text\) to service_role;/);
  });

  it("what the content comparison binds: the day row, the COMPLETE shift set (segments + flags + REASONS, Astra chunk D P2) and the COMPLETE gap set", () => {
    const canon = extractFunction(src, "create function public.schedule_day_canon(", "$$;");
    for (const k of ["'origin'", "'sv'", "'problems'", "'segments', s.segments", "'cm', s.closing_manager", "'flex', s.flex", "'pinned', s.pinned",
      "'certificate', g.certificate", "'origin', g.origin_revision_id", "'from', g.from_q", "'to', g.to_q", "'cause', g.cause"]) expect(canon, k).toContain(k);
    expect(canon).toContain("'reasons', s.reasons");
    // Astra chunk D P2 / P3: the certificate admission is IS TRUE, and impossible dates are caught by name.
    expect(src).toContain("check (public.valid_gap_certificate(cause, certificate) is true)");
    expect(src).toContain("if public.valid_gap_certificate(v_e ->> 'cause', v_e -> 'certificate') is not true then raise exception 'gap_certificate_invalid'");
    expect(src.split("begin v_date := (v_e ->> 'date')::date; exception when others then raise exception 'invalid_payload'; end;").length - 1).toBe(3);
    expect(extractFunction(src, "create function public.schedule_problems_canon(", "$$;")).toContain("e - 'inherited'");
  });

  it("the ET clock the writers read is 0274's real one (the harness injects time; production never does)", () => {
    expect(src0274).toContain("create function public.schedule_et_today()\nreturns date language sql stable set search_path = pg_catalog, public as $$\n  select (now() at time zone 'America/New_York')::date\n$$;");
    expect(src).toContain("v_today date := public.schedule_et_today();");
  });

  it("the stored context ceiling matches the TS one (context-shared CONTEXT_MAX_BYTES)", () => {
    expect(src).toContain(`octet_length(context::text) <= ${CONTEXT_MAX_BYTES}`);
    expect(src).toContain(`octet_length(p_context::text) > ${CONTEXT_MAX_BYTES}`);
  });
});
