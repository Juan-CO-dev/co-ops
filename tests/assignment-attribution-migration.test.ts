/** SQL contract checks complement (never replace) the rollback sim harness. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROLES } from "../lib/roles";
import { OVERRIDE_REASON_CODES } from "../lib/assignments-shared";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0228_assignment_attribution.sql");
const originalTask = read("0217_assignments_stations.sql").split("create or replace function public.write_task_assignment")[1]!;
const originalStation = read("0219_stations_staffing_positions.sql");
function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(to, start + from.length);
  expect(end, to).toBeGreaterThan(start);
  return source.slice(start, end);
}
const task = between(sql, "create function public.write_task_assignment", "create function public.write_station_event");
const station = between(sql, "create function public.write_station_event", "revoke all on function public.assignment_author_level");

describe("0228 assignment reason contracts", () => {
  it("retains the original task and station authority, scope, history, capacity and origin gates", () => {
    const retained: Array<[string, string, string, string]> = [
      [originalTask, task, "  v_actor := public.assignment_user_level(p_actor_id,p_location_id);", "    -- Retraction is not assigning up:"],
      [originalTask, task, "  if v_task is null", "  perform pg_advisory_xact_lock"],
      [originalStation, station, "  -- One shop/day lock", "  if p_position_id is not null and exists ("],
      [originalStation, station, "  if p_position_id is not null and exists (", "  insert into public.station_events"],
    ];
    // Compare the existing source lines as a subsequence: the new reason guards
    // may be inserted, but cannot remove/reorder any pre-existing auth gate.
    for (const [before, after, start, end] of retained) {
      const lines = between(before, start, end).split("\n").filter((line) => line.trim());
      let cursor = 0;
      for (const line of lines) {
        const index = after.indexOf(line, cursor);
        expect(index, `retained gate: ${line}`).toBeGreaterThanOrEqual(cursor);
        cursor = index + line.length;
      }
    }
  });

  it("uses the canonical full role map without disabling inactive or transferred authors", () => {
    const helper = between(sql, "create function public.assignment_author_level", "-- Retire old signatures");
    const roleMap = Object.fromEntries([...helper.matchAll(/when '([a-z_]+)' then (\d+)/g)]
      .map((match) => [match[1], Number(match[2])]));
    expect(roleMap).toEqual(Object.fromEntries(Object.values(ROLES).map(({ code, level }) => [code, level])));
    expect(helper).toContain("where id=p_user_id for share");
    expect(helper).not.toMatch(/\bactive\b|user_locations/);
  });

  it("keeps SQL reason vocabularies aligned with the public contract and rejects blank Other notes", () => {
    const enumerations = [...sql.matchAll(/(?:reason_code|p_reason_code) (?:not )?in \(([^)]+)\)/g)];
    expect(enumerations).toHaveLength(4);
    for (const enumeration of enumerations) {
      expect([...enumeration[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual([...OVERRIDE_REASON_CODES]);
    }
    expect(sql.match(/coalesce\(reason_note ~ '\[\^\[:space:\]\]',false\)/g)).toHaveLength(2);
    for (const body of [task, station]) {
      expect(body).toContain("length(coalesce(p_reason_note,''))>500");
      expect(body).toContain("p_reason_code='other' and not coalesce(p_reason_note ~ '[^[:space:]]',false)");
    }
  });

  it("checks current authors under serialization before changes and stores override evidence atomically", () => {
    expect(task.indexOf("for update;")).toBeLessThan(task.indexOf("assignment_author_level(v_row.assigner_id)>v_actor"));
    expect(task.indexOf("assignment_author_level(v_row.assigner_id)>v_actor")).toBeLessThan(task.indexOf("update public.report_assignments"));
    expect(station.indexOf("pg_advisory_xact_lock")).toBeLessThan(station.indexOf("select * into v_previous"));
    expect(station).toContain("v_previous.source='assigned'\n    and public.assignment_author_level(v_previous.actor_id)>v_actor");
    for (const body of [task, station]) {
      expect(body).toContain("if p_reason_code is null then raise exception 'override_reason_required'; end if;");
      expect(body).toContain("'overridden_assigner_id',v_overridden");
      expect(body).not.toMatch(/exception when/); // evidence failure cannot be swallowed
    }
    expect(task).toContain("insert into public.assignment_changes(assignment_id,location_id,operational_date,report_type,actor_id,kind,reason_code,reason_note,overridden_assigner_id)");
    expect(station).toContain("position_id,kind,actor_id,source,at,reason_code,reason_note,overridden_assigner_id)");
  });

  it("retires bypass signatures and makes the new task history append-only and service-readable", () => {
    expect(sql).toContain("drop function public.write_task_assignment(uuid,uuid,uuid,text,text,uuid);");
    expect(sql).toContain("drop function public.write_station_event(uuid,uuid,uuid,uuid,uuid,boolean);");
    expect(sql).toContain("alter table public.assignment_changes enable row level security;");
    expect(sql).toContain("revoke all on public.assignment_changes from public,anon,authenticated,service_role;");
    expect(sql).toContain("grant select on public.assignment_changes to service_role;");
    expect(sql).not.toMatch(/grant (?:insert|update|delete|all)[^;]*assignment_changes/i);
    for (const signature of ["assignment_author_level(uuid)", "write_task_assignment(uuid,uuid,uuid,text,text,uuid,text,text)", "write_station_event(uuid,uuid,uuid,uuid,uuid,boolean,text,text)"]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public,anon,authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
  });
});
