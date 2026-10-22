import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { savePersonSettingsCall } from "@/lib/scheduling/rpc-args-shared";

const src = readFileSync("supabase/migrations/0280_schedule_person_works_as.sql", "utf8");
const previous = readFileSync("supabase/migrations/0278_schedule_person_settings_guarded.sql", "utf8");
function body(sql: string, name: string) {
  const declaration = new RegExp(`create (?:or replace )?function public\\.${name}\\(`).exec(sql)!;
  const start = sql.indexOf(`function public.${name}(`, declaration.index);
  return sql.slice(start, sql.indexOf("end $$;", start) + 7);
}

describe("0280_schedule_person_works_as", () => {
  it("executes the actual migrations and verifies writer behavior and grants", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0280.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toContain("PASS 0280:");
  }, 250_000);
  it("adds only nullable floor roles and refuses overrides on other account roles", () => {
    expect(src).toContain("-- Migration 0280_schedule_person_works_as\n-- AUTHORED 2026-10-21. NOT YET APPLIED");
    expect(src).toContain("add column works_as text null");
    expect(src).toContain("check (works_as in ('employee', 'trainer', 'key_holder', 'shift_lead'))");
    expect(src).toContain("if p_works_as is not null and v_role not in ('cgs', 'social_media_mgr', 'catering_mgr', 'prep_mgr') then\n    raise exception 'works_as_refused';");
    expect(src).toContain("if p_works_as is null and coalesce(p_roster_include, false)");
    expect(src).toContain("'roster_include', p_roster_include, 'works_as', p_works_as");
  });

  it("retains every prior writer body byte-for-byte except the documented works_as additions", () => {
    const restored = src
      .replaceAll(", p_works_as text default null", "")
      .replace("  if p_works_as is not null and v_role not in ('cgs', 'social_media_mgr', 'catering_mgr', 'prep_mgr') then\n    raise exception 'works_as_refused';\n  end if;\n", "")
      .replace("  if p_works_as is not null and p_works_as not in ('employee', 'trainer', 'key_holder', 'shift_lead') then\n    raise exception 'invalid_payload';\n  end if;\n", "")
      .replace("if p_works_as is null and coalesce", "if coalesce")
      .replace("created_by, works_as)", "created_by)")
      .replace(", 'works_as', p_works_as", "")
      .replaceAll(", p_works_as)", ")")
      .replace(", case when v_had and public.schedule_subject_at_shop(p_user, p_location) in ('cgs', 'social_media_mgr', 'catering_mgr', 'prep_mgr') then v_old.works_as else null end)", ")");
    for (const name of ["record_schedule_person_settings", "save_schedule_person_settings", "merge_schedule_person_positions"]) {
      expect(body(restored, name), name).toBe(body(previous, name));
    }
  });

  it("removes ambiguous old overloads and keeps service-role-only execution", () => {
    for (const sig of [
      "record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)",
      "save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean)",
    ]) {
      expect(src).toContain(`drop function public.${sig};`);
      const extended = sig.replace(/\)$/, ", text)");
      expect(src).toContain(`revoke all on function public.${extended} from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${extended} to service_role;`);
    }
    expect(src).not.toMatch(/grant execute[^;]*to (anon|authenticated|public)/i);
    expect(src.match(/security definer set search_path = pg_catalog, public/g)).toHaveLength(3);
    expect(src).toContain("case when v_had and public.schedule_subject_at_shop(p_user, p_location) in ('cgs', 'social_media_mgr', 'catering_mgr', 'prep_mgr') then v_old.works_as else null end");
  });

  it("the current full-row builder matches every new SQL parameter", () => {
    const call = savePersonSettingsCall({ actorId: "a", locationId: "l", userId: "u", expectedId: null,
      workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null,
      softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null, worksAs: "key_holder" });
    const signature = body(src, "save_schedule_person_settings").split("returns")[0]!;
    expect(Object.keys(call.args).filter((key) => key !== "p_availability")).toEqual([...signature.matchAll(/(p_\w+)/g)].map((match) => match[1]));
    expect(call.args.p_works_as).toBe("key_holder");
  });
});
