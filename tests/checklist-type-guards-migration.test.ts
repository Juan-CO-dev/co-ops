/**
 * W13 migrations 0313 + 0314 — every re-emitted body is its latest definer plus ADDITIONS ONLY
 * (line subsequence, comments and trailing commas ignored), each new guard sits where the plan
 * put it, and the offline PGlite harnesses pass (with their deliberately broken variants).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n");
const m0313 = read("0313_checklist_type_guards.sql");
const m0314 = read("0314_closing_release_floor_midday_create.sql");

/** The function whose header contains `marker`, through its closing `end`. */
function fn(source: string, marker: string, end: string): string {
  const start = source.indexOf(marker);
  expect(start, `marker ${marker}`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf(end, start) + end.length);
}
const statements = (body: string, from = /\bDECLARE\b|\bdeclare\b/) => {
  const at = body.search(from);
  return body.slice(at).split("\n").map(line => line.replace(/--.*$/, "").trim().replace(/,$/, "")).filter(Boolean);
};
function expectSubsequence(prior: string[], next: string[], label: string) {
  expect(prior.length, `${label} prior body`).toBeGreaterThan(10);
  let cursor = 0;
  for (const line of prior) {
    while (cursor < next.length && next[cursor] !== line) cursor++;
    expect(cursor, `${label}: missing or reordered statement: ${line}`).toBeLessThan(next.length);
    cursor++;
  }
}

const REEMITS: Array<[string, string, string, string]> = [
  ["submit_am_prep_atomic", "0291_prep_submit_idempotency.sql", "FUNCTION public.submit_am_prep_atomic(", "$function$;"],
  ["submit_phase1_atomic", "0215_batch_vs_bottle.sql", "FUNCTION public.submit_phase1_atomic(", "$function$;"],
  ["submit_mid_day_phase1_atomic", "0215_batch_vs_bottle.sql", "FUNCTION public.submit_mid_day_phase1_atomic(", "$function$;"],
  ["checklist_confirm_instance", "0288_checklist_confirm_filtered_only.sql", "function public.checklist_confirm_instance(", "end $$;"],
  ["checklist_write_completion", "0276_checklist_guarded_writers.sql", "function public.checklist_write_completion(", "end $$;"],
  ["checklist_submit_batch", "0276_checklist_guarded_writers.sql", "function public.checklist_submit_batch(", "end $$;"],
];

describe("0313 re-emits its latest definers with additions only", () => {
  it.each(REEMITS)("%s keeps every %s statement in order", (_name, source, marker, end) => {
    expectSubsequence(statements(fn(read(source), marker, end)), statements(fn(m0313, marker, end)), _name);
  });

  it("keeps each signature's header (arguments, defaults, security, search_path) byte-identical", () => {
    // From "FUNCTION public.<name>(" through the body opener ("AS $function$" / "as $$").
    const header = (s: string, marker: string) => {
      const start = s.indexOf(marker);
      const rest = s.slice(start);
      const open = rest.search(/\bAS \$(function)?\$/i);
      expect(open, `body opener for ${marker}`).toBeGreaterThan(0);
      return rest.slice(0, open);
    };
    for (const [name, source, marker] of REEMITS) {
      expect(header(m0313, marker), name).toBe(header(read(source), marker));
    }
  });

  it("places the AM prep guard under the parent lock, before the replay block", () => {
    const body = fn(m0313, "FUNCTION public.submit_am_prep_atomic(", "$function$;");
    const lock = body.indexOf("WHERE id = p_prep_instance_id FOR NO KEY UPDATE;");
    const guard = body.indexOf("submit_am_prep_atomic: wrong_checklist_type");
    expect(lock).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(lock);
    expect(guard).toBeLessThan(body.indexOf("SELECT * INTO v_replay"));
    expect(guard).toBeLessThan(body.indexOf("IF NOT p_is_update THEN"));
  });

  it("places the Phase 1 guards before either branch, before the loop, and inside the original loop", () => {
    const body = fn(m0313, "FUNCTION public.submit_phase1_atomic(", "$function$;");
    const notFound = body.indexOf("opening instance % not found");
    const typeGuard = body.indexOf("wrong_checklist_type — instance % is not an opening");
    const branch = body.indexOf("IF NOT p_is_update THEN");
    const incomplete = body.indexOf("phase1_incomplete");
    const loop = body.indexOf("FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)");
    const membership = body.indexOf("item_not_in_template");
    const chainEdit = body.indexOf("C.46 CHAIN-EDIT PATH");
    expect(notFound).toBeLessThan(typeGuard);
    expect(typeGuard).toBeLessThan(branch);
    expect(branch).toBeLessThan(incomplete);
    expect(incomplete).toBeLessThan(loop);
    expect(loop).toBeLessThan(membership);
    expect(membership).toBeLessThan(chainEdit);
    // B074's universe is snapshot rows ∩ ACTIVE items of the instance's template — never widened.
    expect(body).toContain("AND cti.template_id = v_template_id AND cti.active = TRUE");
    expect(body.match(/item_not_in_template/g)).toHaveLength(1);
  });

  it("places the generic guard right after instance_not_found in each 0276/0288 writer", () => {
    for (const [, , marker, end] of REEMITS.slice(3)) {
      const body = fn(m0313, marker, end);
      const found = body.indexOf("if not found then raise exception 'instance_not_found'; end if;");
      const guard = body.indexOf("raise exception 'wrong_checklist_type'");
      expect(found).toBeGreaterThan(0);
      expect(guard).toBeGreaterThan(found);
      expect(guard).toBeLessThan(body.indexOf("instance_not_open"));
    }
  });

  it("refuses drift and a second apply, and re-asserts the service-role-only grants", () => {
    expect(m0313).toContain("raise exception '0313: public.submit_phase1_atomic drifted from its latest definer'");
    expect(m0313).toContain("already carries the type guard");
    expect(m0313).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated;\ngrant execute on function[\s\S]*to service_role;/);
    expect(m0313).toContain("-- AUTHORED 2026-11-15. NOT YET APPLIED - sim first, prod on Juan's word.");
  });

  it("runs actual SQL: the guard-stripped variant lets the bugs through, the real one refuses", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0313.mjs"], { encoding: "utf8", timeout: 120_000 });
    expect(output).toContain("EXPECTED FAIL 0313 broken variant:");
    expect(output).toContain("PASS 0313:");
    expect(output).toContain("two-session sim proof NOT RUN");
  }, 130_000);
});

describe("0314 release floor + atomic mid-day create", () => {
  it("re-emits 0046's release_overdue_closings with additions only", () => {
    const prior = fn(read("0046_state_finalize_columns_and_auto_release.sql"), "FUNCTION release_overdue_closings(", "END;\n$$;");
    const next = fn(m0314, "FUNCTION public.release_overdue_closings(", "END;\n$$;");
    expectSubsequence(statements(prior), statements(next), "release_overdue_closings");
  });

  it("pins the owner decision: 07:00 ET on the morning after the closing's date, kept beside the 16 h rule", () => {
    expect(m0314).toContain("v_release_floor_hour constant integer := 7;");
    expect(m0314).toContain("AND now() >= (((ci.date + 1)::timestamp + make_interval(hours => v_release_floor_hour)) AT TIME ZONE 'America/New_York')");
    expect(m0314).toContain("AND ci.shift_start_at < (now() - (v_grace_hours || ' hours')::interval)");
  });

  it("counts and inserts under one advisory lock, pins the ET day and is service-role only", () => {
    const body = fn(m0314, "create function public.create_mid_day_prep_instance_atomic(", "end $$;");
    const lock = body.indexOf("pg_advisory_xact_lock");
    expect(body.indexOf("date_not_today")).toBeLessThan(lock);
    expect(body.indexOf("template_mismatch")).toBeLessThan(lock);
    expect(lock).toBeLessThan(body.indexOf("select count(*) into v_n"));
    expect(body.indexOf("select count(*) into v_n")).toBeLessThan(body.indexOf("insert into public.checklist_instances"));
    expect(m0314).toContain("revoke all on function public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer) from public, anon, authenticated;");
    expect(m0314).toContain("grant execute on function public.create_mid_day_prep_instance_atomic(uuid,uuid,date,uuid,integer) to service_role;");
  });

  it("runs actual SQL: the 0046 body reproduces B075/B076, 0314 fixes them and caps mid-day creates", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0314.mjs"], { encoding: "utf8", timeout: 120_000 });
    expect(output).toContain("EXPECTED FAIL 0314 broken variant:");
    expect(output).toContain("PASS 0314:");
    expect(output).toContain("two-session cap lock proof NOT RUN");
  }, 130_000);
});
