import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { savePersonSettingsCall } from "@/lib/scheduling/rpc-args-shared";

const src = readFileSync("supabase/migrations/0281_schedule_person_availability.sql", "utf8").replaceAll("\r\n", "\n");
const previous = readFileSync("supabase/migrations/0280_schedule_person_works_as.sql", "utf8").replaceAll("\r\n", "\n");
function body(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  return sql.slice(start, sql.indexOf("end $$;", start) + 7);
}

describe("0281_schedule_person_availability", () => {
  it("executes the actual migration chain and validates round-trips, refusals, merges and grants", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0281.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toContain("PASS 0281:");
  }, 250_000);

  it("retains the prior writer bodies byte-for-byte except availability plumbing and validation", () => {
    const restored = src.replace("  if not public.valid_person_availability(p_availability) then raise exception 'invalid_payload'; end if;\n", "")
      .replaceAll(", p_availability jsonb default null", "")
      .replace("; v_day jsonb; v_key text;", ";")
      .replace("created_by, works_as, availability)", "created_by, works_as)")
      .replace(", 'availability', p_availability", "")
      .replaceAll(", p_availability)", ")")
      .replace(",\n    case when v_had then v_old.availability else null end)", ")");
    for (const name of ["record_schedule_person_settings", "save_schedule_person_settings", "merge_schedule_person_positions"]) {
      expect(body(restored, name), name).toBe(body(previous, name));
    }
  });

  it("documents rollout and adds a nullable column with no ambiguous writer overloads", () => {
    expect(src).toContain("-- ROLLOUT:");
    expect(src).toContain("-- VERIFY AFTER APPLY:");
    expect(src).toContain("0281: already applied");
    expect(src).toContain("add column availability jsonb null");
    expect(src).toContain("comment on column public.schedule_person_settings.availability");
    for (const sig of [
      "record_schedule_person_settings(uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean, text)",
      "save_schedule_person_settings(uuid, uuid, uuid, uuid, text, text[], text, uuid[], numeric, numeric, boolean, numeric, boolean, text)",
    ]) {
      expect(src).toContain(`drop function public.${sig};`);
      const extended = sig.replace(/\)$/, ", jsonb)");
      expect(src).toContain(`revoke all on function public.${extended} from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${extended} to service_role;`);
    }
  });

  it("the live RPC builder supplies the exact full-row SQL parameters", () => {
    const call = savePersonSettingsCall({ actorId: "a", locationId: "l", userId: "u", expectedId: null,
      workType: null, alsoAllowed: [], leaderSetting: null, coverPositions: [], softMinH: null,
      softMaxH: null, fullTime: false, fullTimeMinH: null, rosterInclude: null, availability: null });
    const signature = body(src, "save_schedule_person_settings").split("returns")[0]!;
    expect(Object.keys(call.args).filter((key) => key !== "p_usual_shift")).toEqual([...signature.matchAll(/(p_\w+)/g)].map((match) => match[1]));
    expect(call.args.p_availability).toBeNull();
  });
});
