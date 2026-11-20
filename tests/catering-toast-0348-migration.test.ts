/**
 * Item 21 PR 4: Migration 0348 (the HOUSE RECONCILER). File only; CC applies sim then prod on Juan's word.
 * Pins the file's shape and runs the offline PGlite proof (scripts/sql-harness-0348.mjs) against the REAL 0225
 * transfer, 0229 publisher, 0231 planner, 0330 reconciler and the 0344 / 0347 files. Migrations are pinned BY NAME.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0348_catering_toast_reconciler.sql");
const m0347 = read("0347_catering_toast_link_step.sql");
const code = sql.replace(/--[^\n]*/g, "");
const fn = (src: string, name: string) => src.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n(?:end \\$\\$;|\\$plan\\$;|\\$\\$;)`))![0];

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
const added = (old: string, neu: string) => neu.split("\n").filter((l) => !old.split("\n").includes(l));
const squash = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, "");

describe("0348 header and shape", () => {
  it("gate header, one transaction, file only", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0348_catering_toast_reconciler");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-19 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
    for (const refusal of ["0348: apply 0347 first", "0348: the live plan_ezcater_toast is not the 0347 body", "0348: the live plan_catering_toast is not the 0347 body",
      "0348: the live ezcater_toast_links_house_guard is not the 0347 body", "0348: the live catering_toast_check_house_code is not the 0347 body",
      "0348: sales_channel_map.reviewed_at is missing"]) expect(code).toContain(`raise exception '${refusal}`);
  });

  it("re-emits the ezCater PLANNER by adding lines only: 0347's body is a line-subsequence of the new one", () => {
    const old = fn(m0347, "plan_ezcater_toast");
    const neu = fn(sql, "plan_ezcater_toast");
    expect(isLineSubsequence(old, neu)).toBe(true);
    const lines = added(old, neu);
    // One more column in `checks` (the dining option), and two more branches of house_coded: a recorded note-typed
    // ring code, and a capture the note lookup has not examined yet (evidence pending). Nothing else.
    expect(lines[0]).toBe(" t.dining_option_guid,");
    expect(lines.filter((l) => l.startsWith(" -- "))).toHaveLength(5);
    expect(lines.filter((l) => !l.startsWith(" -- "))).toHaveLength(17);
    expect(lines.join("\n")).toContain("join public.catering_toast_note_codes n on n.toast_snapshot_id=c.toast_snapshot_id and n.check_guid=c.check_guid");
    expect(lines.join("\n")).toContain("and not exists(select 1 from public.catering_toast_note_lookups k where k.location_id=c.location_id");
    // Both new branches live inside house_coded, before `candidates`.
    const body = neu.slice(neu.indexOf("), house_coded as ("), neu.indexOf("), candidates as ("));
    for (const line of lines.slice(1)) expect(body).toContain(line);
  });

  it("re-emits the HOUSE planner by adding lines only: recorded note codes are tokens", () => {
    const old = fn(m0347, "plan_catering_toast");
    const neu = fn(sql, "plan_catering_toast");
    expect(isLineSubsequence(old, neu)).toBe(true);
    expect(added(old, neu)).toEqual([
      "    -- (c) 0348 (contract #3): codes the one note lookup RECORDED on this very capture (codes only, never text).",
      "    select c.toast_snapshot_id, c.check_guid, n.code_norm",
      "      join public.catering_toast_note_codes n",
      "        on n.location_id = c.location_id and n.toast_snapshot_id = c.toast_snapshot_id and n.check_guid = c.check_guid",
    ]);
  });

  it("re-emits the PUBLISHER GUARD by adding lines only; it still never raises and an incumbent still passes first", () => {
    const old = fn(m0347, "ezcater_toast_links_house_guard").replace("create function", "create or replace function");
    const neu = fn(sql, "ezcater_toast_links_house_guard");
    expect(isLineSubsequence(old, neu)).toBe(true);
    const lines = added(old, neu);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("      if v_kind is null and public.catering_toast_ezcater_admission_pending(new.location_id, new.order_guid) then return null; end if;");
    expect(neu).not.toMatch(/raise\s+exception/i);
    expect(neu).toMatch(/exception when others then\n\s+return new;/);
    // The new skip sits inside the "not an incumbent" branch, after the dual-code test.
    const incumbent = neu.indexOf("elsif not public.ezcater_toast_incumbent(");
    expect(neu.indexOf(lines[2]!)).toBeGreaterThan(incumbent);
    expect(neu.indexOf(lines[2]!)).toBeLessThan(neu.indexOf("if v_kind is null then\n"));
    // Replaced, never dropped: 0347's trigger keeps firing it, and the readiness probe is asserted at the end of the file.
    expect(code).not.toMatch(/drop\s+(trigger|function)/i);
    expect(code).toContain("if not public.catering_toast_link_ready() then raise exception '0348: the link step is no longer ready'; end if;");
  });

  it("never re-emits the publisher, the ezCater reconciler, apply or transfer, and never writes ezcater_toast_links", () => {
    expect(code).not.toMatch(/function\s+public\.(publish_ezcater_shadow|reconcile_ezcater_toast|apply_ezcater_order|transfer_catering_lead)\b/i);
    expect(code).not.toMatch(/(update|insert\s+into|delete\s+from)\s+public\.ezcater_toast_links\b/i);
    expect(code).not.toMatch(/function\s+public\.decide_catering_toast\b/i);
  });

  it("the ezCater reconciler never runs in a subtransaction: nothing here calls it, and the house reconciler has no exception block", () => {
    // 0347's incumbent rule reads xmin of a row retired in the SAME top-level transaction.
    expect(code).not.toMatch(/reconcile_ezcater_toast\s*\(/);
    expect(code).not.toMatch(/publish_ezcater_shadow\s*\(/);
    const house = fn(sql, "reconcile_catering_toast").replace(/--[^\n]*/g, "");
    expect(house).not.toMatch(/\bexception\s+when\b/i);
    expect(house).not.toMatch(/savepoint/i);
  });

  it("the house reconciler: off before the lock, the lock before the leads, the leads before any link row", () => {
    const house = fn(sql, "reconcile_catering_toast");
    const off = house.indexOf("return jsonb_build_object('skipped', 'off');");
    const lock = house.indexOf("perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));");
    const leads = house.indexOf("order by p.id for no key update");
    const insert = house.indexOf("insert into public.catering_toast_links");
    expect(off).toBeGreaterThan(0);
    expect(lock).toBeGreaterThan(off);
    expect(leads).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(leads);
    // The settings are read AGAIN under the lock.
    expect(house.slice(lock).match(/return jsonb_build_object\('skipped', 'off'\);/g)).toHaveLength(1);
    expect(code.match(/insert into public\.catering_toast_links\b/g)).toHaveLength(1);
    // Automatic evidence only, never 'manual'; never a decision row.
    expect(house).toContain("r.lead_id, p_location_id, r.order_guid, r.check_guid, r.toast_snapshot_id, v_evidence)");
    expect(code).not.toMatch(/insert into public\.catering_toast_link_decisions/);
  });

  it("every refusal of the automatic link is named, in one order", () => {
    const house = fn(sql, "reconcile_catering_toast");
    const order = ["'blocked'", "'no_ring_expected'", "'switch_off'", "'before_start_date'", "then 'owned'", "'out_of_window'", "'evidence_pending'", "'dual_code'",
      "'two_house_orders'", "'ezcater_dining_option'"];
    let at = house.indexOf("v_reason := case");
    for (const name of order) {
      const next = house.indexOf(name, at);
      expect([name, next > at]).toEqual([name, true]);
      at = next;
    }
  });

  it("no statement sets a house link current again; the run is audited as a system observation", () => {
    expect(code).not.toMatch(/is_current\s*=\s*true/i);
    for (const set of code.match(/update public\.catering_toast_links[\s\S]*?;/g) ?? []) expect(set).toMatch(/set is_current = false, retired_at = clock_timestamp\(\)/);
    const house = fn(sql, "reconcile_catering_toast");
    expect(house).toContain("values (null, null, 'catering.toast_reconciled', 'catering_toast_links', null,");
    expect(house).toMatch(/'link_ids', to_jsonb\(v_links\[1:50\]\)\),\n\s+false\);/);
  });

  it("the note codes and the coverage: codes only, deny-all, ONE definer writer, coverage after the codes", () => {
    expect(code).toContain("code_norm         text not null check (code_norm ~ '^[A-Z0-9]{4,32}$')");
    for (const table of ["catering_toast_note_codes", "catering_toast_note_lookups"]) {
      for (const op of ["select", "insert", "update", "delete"]) expect(code).toContain(`create policy ${table}_no_user_${op} on public.${table}`);
      expect(code).toContain(`grant select on public.${table} to service_role;`);
      expect(code.match(new RegExp(`insert into public\\.${table}\\b`, "g"))).toHaveLength(1);
    }
    expect(code).not.toMatch(/grant\s+(insert|update|delete|all)/i);
    const writer = fn(sql, "record_catering_toast_note_lookup");
    expect(writer).toContain("raise exception 'catering_toast_note_codes_invalid'");
    expect(writer).toContain("raise exception 'catering_toast_note_lookup_invalid'");
    // No key but the named ones: no free text rides in beside a code or an examined capture.
    expect(writer).toContain("where k not in ('location_id', 'order_guid', 'toast_snapshot_id')");
    expect(writer).toContain("where k not in ('location_id', 'order_guid', 'check_guid', 'toast_snapshot_id', 'code')");
    // Stored only for the order's CURRENT capture; a code only if this call examined its capture and it IS a known code.
    expect(writer.match(/join public\.toast_orders_latest t on t\.id = /g)).toHaveLength(2);
    expect(writer).toMatch(/exists \(select 1 from jsonb_array_elements\(coalesce\(p_examined, '\[\]'::jsonb\)\) e/);
    expect(writer).toMatch(/exists \(select 1 from public\.catering_pipeline p[\s\S]*or exists \(select 1 from public\.ezcater_orders e/);
    expect(writer.indexOf("insert into public.catering_toast_note_lookups")).toBeGreaterThan(writer.indexOf("insert into public.catering_toast_note_codes"));
    expect(writer).not.toMatch(/\bexception\s+when\b/i); // one transaction: both inserts or neither
  });

  it("EVIDENCE PENDING is one rule: the planner's set-based test is the functions' test, clause for clause", () => {
    const planner = squash(fn(sql, "plan_ezcater_toast"));
    const scope = fn(sql, "catering_toast_note_scope");
    const complete = fn(sql, "catering_toast_note_evidence_complete");
    const pending = fn(sql, "catering_toast_ezcater_admission_pending");
    const asPlanner = (s: string) => squash(s).replaceAll("p_location_id", "c.location_id").replaceAll("p_dining_option_guid", "c.dining_option_guid");
    // The scope (lib/toast/captured-day.ts gives an order its "catering" sales channel by the same three tests).
    const scopeTest = scope.slice(scope.indexOf("select 1 from public.toast_dining_options"), scope.indexOf("\n$$;")).replace(/\)\s*$/, "");
    expect(scopeTest).toContain("m.reviewed_at is not null and lower(m.channel) = 'catering' and coalesce(m.provider, '') <> 'gift_card'");
    expect(planner).toContain(asPlanner(scopeTest));
    // Complete = out of scope, or the CURRENT capture is the examined one.
    expect(complete).toContain("select not public.catering_toast_note_scope(t.location_id, t.dining_option_guid)");
    expect(complete).toContain("and k.order_guid = t.order_guid and k.toast_snapshot_id = t.id)");
    expect(planner).toContain(squash("and not exists(select 1 from public.catering_toast_note_lookups k where k.location_id=c.location_id and k.order_guid=c.order_guid and k.toast_snapshot_id=c.toast_snapshot_id)"));
    // ezCater waits only at a shop that is on and has a live ring code.
    expect(pending).toContain("select exists (select 1 from public.catering_toast_settings g where g.location_id = p_location_id and g.enabled)");
    expect(pending).toContain("and exists (select 1 from public.catering_live_ring_codes r where r.location_id = p_location_id)");
    expect(pending).toContain("and not public.catering_toast_note_evidence_complete(p_location_id, p_order_guid)");
    expect(planner).toContain(squash("where exists(select 1 from public.catering_toast_settings g where g.location_id=c.location_id and g.enabled) and exists(select 1 from public.catering_live_ring_codes r where r.location_id=c.location_id)"));
    // The house reconciler and the guard ask the functions; an incumbent is never held back by the planner's branch.
    expect(fn(sql, "reconcile_catering_toast")).toContain("when not public.catering_toast_note_evidence_complete(p_location_id, r.order_guid) then 'evidence_pending'");
    const branch = fn(sql, "plan_ezcater_toast").split("EVIDENCE PENDING")[1]!.split("), candidates as (")[0]!;
    expect(branch).toContain("and not exists(select 1 from public.ezcater_toast_links z where z.is_current and z.location_id=c.location_id");
  });

  it("ONE rule for house code evidence: 0347's dual-code test is its first element, and the token rule is 0229's", () => {
    const token = "regexp_matches(coalesce(s->>'name',''),'[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*','g') tok";
    expect(fn(sql, "catering_toast_check_code_leads")).toContain(token);
    expect(fn(sql, "catering_toast_check_house_code")).toContain("select (public.catering_toast_check_code_leads(p_location_id, p_order_guid, p_check_guid))[1]");
    expect(fn(sql, "reconcile_catering_toast")).toContain("v_codes := public.catering_toast_check_code_leads(p_location_id, r.order_guid, r.check_guid);");
  });

  it("every new function is definer with a pinned search_path and no user EXECUTE", () => {
    const names = ["record_catering_toast_note_lookup", "catering_toast_note_scope", "catering_toast_note_evidence_complete", "catering_toast_ezcater_admission_pending",
      "catering_toast_uncovered_orders", "catering_toast_check_code_leads", "catering_toast_check_on_ezcater_option", "ensure_catering_ring_codes", "reconcile_catering_toast"];
    for (const name of names) {
      expect(fn(sql, name)).toMatch(/security definer set search_path = pg_catalog, public as \$\$/);
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    }
    // Exactly the functions the cron calls are granted to service_role.
    expect([...code.matchAll(/grant execute on function public\.(\w+)\(/g)].map((m) => m[1]).sort()).toEqual(
      ["catering_toast_uncovered_orders", "ensure_catering_ring_codes", "plan_catering_toast", "reconcile_catering_toast", "record_catering_toast_note_lookup"]);
  });
});

describe("0348 behaviour (PGlite, real writers)", () => {
  it("scripts/sql-harness-0348.mjs passes", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0348.mjs"], { encoding: "utf8" });
    expect(out).toMatch(/sql-harness-0348: \d+ checks passed/);
    expect(Number(out.match(/(\d+) checks passed/)![1])).toBeGreaterThanOrEqual(125);
  }, 600_000);
});
