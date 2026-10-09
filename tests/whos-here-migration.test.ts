/** SQL contract checks for 0233; they complement (never replace) scripts/test-whos-here.sql on the sim. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OVERRIDE_REASON_CODES } from "@/lib/assignments-shared";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0233_whos_here.sql");
const prior = read("0230_station_lifecycle.sql");
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
/** The balanced (...) expression after "add constraint <name> check". */
function checkBody(source: string, name: string): string {
  const marker = `add constraint ${name} check`;
  const at = source.indexOf(marker);
  expect(at, name).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("(", at + marker.length);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    if (source[i] === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced check ${name}`);
}
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("0233 who's here: migration discipline", () => {
  it("is numbered 0233, carries its prod apply stamp, and never touches 0232's number", () => {
    expect(sql.split("\n")[0]).toBe("-- Migration 0233_whos_here");
    expect(sql).toMatch(/AUTHORED ONLY 2026-10-08.*NOT APPLIED/);
    expect(sql).toMatch(/APPLIED TO PROD 2026-10-08/);
    expect(sql.match(/\b0232\b/g)).toHaveLength(1); // the "reserved for Sales" note only
    expect(sql.trim().startsWith("-- Migration")).toBe(true);
    expect(sql).toMatch(/\nbegin;\n/);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("re-emits NO existing RPC: every function is new (backward-compat: current args keep working)", () => {
    expect(sql).not.toMatch(/create or replace function/i);
    expect(sql).not.toMatch(/drop function/i);
    const created = [...sql.matchAll(/create function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(created).toEqual(["toast_time_entry_link_user", "toast_time_entries_link_lock", "toast_link_actor_level", "link_toast_employee",
      "unlink_toast_employee", "whos_here_audit", "end_shift", "reconcile_shop_closed"]);
    for (const existing of ["write_station_event", "write_task_assignment", "reconcile_station_lifecycle", "write_station_break", "release_closed_stations"])
      expect(sql).not.toMatch(new RegExp(`create function public\\.${existing}\\(`));
  });

  it("every new definer function is private: revoked from public/anon/authenticated, granted to service_role, asserted", () => {
    const created = [...sql.matchAll(/create function (public\.[a-z_]+)\(([^)]*)\)/g)].map((m) => m[1]!);
    const grantList = between(sql, "-- Definer helpers are private", "commit;");
    for (const name of created) expect(grantList, name).toContain(`'${name}(`);
    expect(grantList).toContain("revoke all on function %s from public,anon,authenticated");
    expect(grantList).toContain("raise exception '0233: RPC grant escaped'");
    for (const body of sql.split("create function ").slice(1)) expect(body.slice(0, 400)).toContain("security definer set search_path=pg_catalog,public");
  });

  it("both new tables are deny-all RLS with select-only service grants (RPCs are the writers)", () => {
    for (const table of ["toast_employee_links", "shift_ends"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      for (const op of ["select", "insert", "update", "delete"]) expect(sql).toContain(`create policy ${table}_no_user_${op} on public.${table}`);
      expect(sql).toContain(`revoke all on public.${table} from public,anon,authenticated,service_role;`);
      expect(sql).toContain(`grant select on public.${table} to service_role;`);
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete)[^;]*on public\\.${table}`));
    }
  });

  it("constraint changes are ADDITIONS ONLY: every 0230 value stays allowed", () => {
    for (const name of ["station_events_reason_code_check", "assignment_changes_reason_code_check"]) {
      const before = quoted(checkBody(prior, name));
      const after = quoted(checkBody(sql, name));
      for (const value of before) expect(after, `${name} keeps ${value}`).toContain(value);
      expect(after).toEqual(expect.arrayContaining(["ended_shift", "shop_closed"]));
    }
    // The 0230 predicates survive verbatim as the first branch of each widened check.
    expect(checkBody(sql, "assignment_changes_system_actor")).toContain(checkBody(prior, "assignment_changes_system_actor").replace(/^\(|\)$/g, "").trim().slice(0, 120));
    expect(checkBody(sql, "station_events_system_actor")).toContain("reason_code in ('station_closed','clocked_out','shop_closed')");
    const breakCheck = between(sql, "add constraint station_break_events_reason_check check", ";\n");
    expect(breakCheck).toContain("(actor_id is not null and reason_code is null)");
    expect(breakCheck).toContain("(actor_id is null and not on_break and reason_code is not distinct from 'clocked_out')");
    expect(sql).toContain("if v_count<>1 then raise exception '0233: expected exactly one station_break_events reason check");
  });

  it("end_shift keeps the 0228 reason vocabulary and its Other-needs-a-note rule", () => {
    const body = between(sql, "create function public.end_shift", "$$;\n");
    const codes = body.match(/p_reason_code not in \(([^)]+)\)/)![1]!;
    expect(quoted(codes)).toEqual([...OVERRIDE_REASON_CODES]);
    expect(body).toContain("length(coalesce(p_reason_note,''))>500");
    expect(body).toContain("p_reason_code='other' and not coalesce(p_reason_note ~ '[^[:space:]]',false)");
    expect(body).toContain("if v_overridden is not null and p_reason_code is null then raise exception 'override_reason_required'");
    // Same authority as a break: self always, someone else only KH+ and not upward.
    expect(body).toContain("if p_actor_id<>p_user_id and (v_actor<4 or v_target>v_actor) then raise exception 'role_insufficient'");
    // Same lock order as reconcile_station_lifecycle.
    expect(body.indexOf("v_station_day::text,0)")).toBeLessThan(body.indexOf("v_day::text,0)"));
  });

  it("links: auto = system actor only, manual = GM+ (8+ any shop), never above the actor; user_id is derived by trigger", () => {
    const link = between(sql, "create function public.link_toast_employee", "$$;\n");
    expect(link).toContain("(p_source='auto') <> (p_actor_id is null)");
    expect(link).toContain("v_target:=public.assignment_user_level(p_user_id,p_location_id);");
    expect(link).toContain("if v_target>v_actor then raise exception 'role_insufficient'");
    const actor = between(sql, "create function public.toast_link_actor_level", "$$;\n");
    expect(actor).toContain("v_level<7");
    expect(actor).toContain("v_level<8 and not exists");
    expect(sql).toContain("create trigger toast_time_entries_link_user before insert or update on public.toast_time_entries");
    // No active link: the written value stands (an unlink's explicit NULL sticks; 0230's harness keeps its meaning).
    expect(sql).toContain("l.employee_guid=new.employee_guid and l.active),new.user_id);");
    expect(sql).toContain("create unique index toast_employee_links_one_active_employee on public.toast_employee_links(location_id,employee_guid) where active;");
    expect(sql).toContain("create unique index toast_employee_links_one_active_user on public.toast_employee_links(location_id,user_id) where active;");
  });

  // r1 Astra P2-8 (BC-038): no database object can release work on its own; the APP calls the RPC
  // behind WHOS_HERE, so turning the flag off turns the behaviour off.
  it("P2-8: 0233 installs NO trigger on checklist_instances (the flag-gated app path calls the release)", () => {
    expect(sql).not.toMatch(/create trigger[^;]*on public\.checklist_instances/i);
    expect(sql).not.toMatch(/release_shop_closed|checklist_shop_closed_release/);
    const triggers = [...sql.matchAll(/create trigger (\w+)[^;]* on public\.(\w+)/g)].map((m) => `${m[1]} on ${m[2]}`);
    expect(triggers).toEqual(["toast_time_entries_link_user on toast_time_entries", "toast_time_entries_link_lock on toast_time_entries"]);
  });

  // r1 Astra P1-4 (BC-040): never wait on a lock, and a cancel/lock timeout is caught by NAME
  // (query_canceled is not covered by OTHERS).
  it("P1-4: reconcile_shop_closed never blocks: try-lock, short lock_timeout, lock_not_available/query_canceled caught", () => {
    const net = between(sql, "create function public.reconcile_shop_closed", "$$;\n");
    expect(net).toContain("pg_try_advisory_xact_lock(hashtextextended('station/day/'||p_location_id::text||'/'||p_day::text,0))");
    expect(net).not.toMatch(/perform pg_advisory_xact_lock\(/);
    expect(net).toContain("set_config('lock_timeout','2000',true)");
    expect(net).toContain("exception when lock_not_available or query_canceled then");
    expect(net).toContain("'skipped','busy'");
  });

  // r1 Astra P1-5 (BC-042): only a DURABLE finalize releases; a compensated confirm never does.
  it("P1-5: acts only on a durable finalize (status re-read; a fresh confirm waits unless settled)", () => {
    const net = between(sql, "create function public.reconcile_shop_closed", "$$;\n");
    expect(net).toContain("if not found or v_inst.status='open' then return jsonb_build_object('ok',true,'closed',false)");
    expect(net).toContain("v_inst.status in ('confirmed','incomplete_confirmed') and not p_settled");
    // Astra r2: durability = the final-confirmation submission, never elapsed time.
    expect(net).toContain("sub.instance_id=v_inst.id and sub.is_final_confirmation");
    expect(net).not.toContain("interval '2 minutes'");
    // Only holds made at or before the close instant are released.
    expect(net).toContain("where h.at<=v_close and");
    expect(net).toContain("and active and created_at<=v_close");
    expect(net).toContain("on conflict (location_id,business_date) where kind='shop_closed' do nothing");
    expect(net).toContain("'release',null,'shop_closed'");
    expect(net).toContain("'auto_release','shop_closed'");
  });

  // r1 Astra P1-3 (BC-007): link/unlink and labor writes serialize on one lock, statement-first.
  it("P1-3: link/unlink hold the global link lock exclusively; every entry-writing statement takes it shared first", () => {
    expect(sql.match(/perform pg_advisory_xact_lock\(hashtextextended\('toast-link',0\)\);/g)).toHaveLength(2);
    expect(sql).not.toContain("'toast-link/'");
    expect(sql).toContain("perform pg_advisory_xact_lock_shared(hashtextextended('toast-link',0));");
    expect(sql).toContain("create trigger toast_time_entries_link_lock before insert or update on public.toast_time_entries\n  for each statement");
  });

  // r1 Astra P1-2 (BC-036): an unlinked pair is a rejection the machine can never re-link.
  it("P1-2: the RPC refuses an AUTO link for a pair that was unlinked (manual stays possible)", () => {
    const link = between(sql, "create function public.link_toast_employee", "$$;\n");
    expect(link).toContain("if p_source='auto' and exists(select 1 from public.toast_employee_links where location_id=p_location_id");
    expect(link).toContain("and employee_guid=p_employee_guid and user_id=p_user_id and not active) then\n    raise exception 'link_rejected';");
  });
});
