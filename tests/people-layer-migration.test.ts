/**
 * Scheduling Phase 1 — migration 0270 pinned: header, the executable PGlite proof (which runs the SHARED
 * tunables case file against the SQL CHECK), the SELECT ceilings, the definer writers, the step/clamp
 * CHECKs, the composite FKs, and the TS/SQL key lists agreeing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractFunction, normalize } from "../scripts/recipe-versions/reemit-mods";
import { SKILL_TUNABLE_KEYS } from "@/lib/people/tunables-shared";

const src = normalize(readFileSync("supabase/migrations/0270_people_layer.sql", "utf8"));
const WRITERS = [
  ["save_people_shop_settings", "uuid, uuid, boolean, uuid", "p_actor uuid, p_location uuid, p_pm_v2 boolean, p_prep_position uuid"],
  ["record_skill_adjustment", "uuid, uuid, uuid, uuid, numeric, text, text", "p_actor uuid, p_location uuid, p_user uuid, p_position uuid,\n  p_delta numeric, p_reason text, p_note text"],
  ["record_skill_rating", "uuid, uuid, uuid, uuid, numeric, text, text", "p_actor uuid, p_location uuid, p_user uuid, p_position uuid,\n  p_rating numeric, p_reason text, p_note text"],
  ["save_skill_tunables", "uuid, uuid, jsonb", "p_actor uuid, p_location uuid, p_tunables jsonb"],
] as const;
const TABLES = ["people_shop_settings", "people_skill_adjustments", "people_skill_ratings", "people_skill_tunables"];

describe("0270_people_layer", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0270_people_layer"
        && /^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word, AFTER 0269 and BEFORE 0271\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO PROD 2026-10-20 (schema_migrations version 20261020000003, name 'people_layer')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the REAL helpers + 0270, the shared tunables case file on the CHECK) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0270.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("P3 valid_skill_tunables agrees with the shared case file");
    expect(out).toContain("P3 the people_skill_tunables CHECK agrees with the shared case file");
    expect(out).toContain("PASS 0270:");
  }, 260_000);

  it("deny-all: every table RLS on and SELECT-only for service_role (the definer RPCs are the only writers)", () => {
    expect(src).toContain(`revoke all on public.${TABLES.join(", public.")}\n  from public, anon, authenticated, service_role;`);
    expect(src).toContain(`grant select on public.${TABLES.join(", public.")}\n  to service_role;`);
    for (const t of TABLES) expect(src).toContain(`alter table public.${t} enable row level security;`);
    expect(src).not.toMatch(/create policy/i);
  });

  it("every writer is SECURITY DEFINER with a pinned search_path and service_role only; the validator pins its search_path", () => {
    for (const [name, types, params] of WRITERS) {
      const fn = extractFunction(src, `create function public.${name}(${params})`, "end $$;");
      expect(fn, name).toContain("returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$");
      expect(src).toContain(`revoke all on function public.${name}(${types}) from public, anon, authenticated;`);
      expect(src).toContain(`grant execute on function public.${name}(${types}) to service_role;`);
    }
    expect(src).toContain("create function public.valid_skill_tunables(p jsonb) returns boolean\nlanguage plpgsql immutable set search_path = pg_catalog, public as $$");
    expect(src).toContain("tunables    jsonb       not null constraint people_skill_tunables_valid check (public.valid_skill_tunables(tunables)),");
  });

  it("adjustments and ratings: 0.05 steps on UNCONSTRAINED numeric (no silent rounding), the clamp, the closed reason list", () => {
    expect(src).toContain("delta       numeric     not null,");
    expect(src).toContain("constraint people_skill_adjustments_step check (delta between -0.30 and 0.30 and (delta * 100) % 5 = 0),");
    expect(src).toContain("rating      numeric     not null,");
    expect(src).toContain("constraint people_skill_ratings_step check (rating between 0 and 1 and (rating * 100) % 5 = 0),");
    expect(src).toContain("reason_code in ('observed_on_floor', 'training_completed', 'correction', 'other')");
    for (const t of ["people_skill_adjustments", "people_skill_ratings"]) {
      expect(src).toContain(`constraint ${t}_position_at_shop\n    foreign key (position_id, location_id) references public.station_positions (id, location_id)`);
    }
    expect(src).toContain("constraint people_shop_settings_prep_position_at_shop\n    foreign key (prep_position_id, location_id) references public.station_positions (id, location_id)");
    expect(src).toContain("create unique index if not exists station_positions_id_location on public.station_positions (id, location_id);");
  });

  it("the actor and subject rules REUSE the 0233 / 0217 / 0228 helpers; the subject is strictly outranked", () => {
    for (const name of ["record_skill_adjustment", "record_skill_rating"]) {
      const fn = extractFunction(src, `create function public.${name}(`, "end $$;");
      expect(fn).toContain("v_actor := public.toast_link_actor_level(p_actor, p_location);");
      expect(fn).toContain("v_subject := public.assignment_user_level(p_user, p_location);");
      expect(fn).toContain("if v_subject >= v_actor then raise exception 'role_insufficient'; end if;");
      expect(fn).toContain("perform public.people_position_at_shop(p_position, p_location);");
    }
    const tun = extractFunction(src, "create function public.save_skill_tunables(", "end $$;");
    expect(tun).toContain("if v_level is null or v_level < 8 then raise exception 'role_insufficient'; end if;");
    expect(tun).toContain("if not public.valid_skill_tunables(p_tunables) then raise exception 'invalid_tunables'; end if;");
    expect(src).not.toMatch(/create (or replace )?function public\.(toast_link_actor_level|assignment_user_level|assignment_author_level)/);
  });

  it("the SQL twin checks EXACTLY the TS key list, and a finite double sum (no per-weight cap)", () => {
    const fn = extractFunction(src, "create function public.valid_skill_tunables(", "end $$;");
    const keys = SKILL_TUNABLE_KEYS.map((k) => `'${k}'`).join(", ");
    expect(fn.replace(/\s+/g, " ")).toContain(`array[${keys}]`);
    expect(fn).toContain("(select count(*) from jsonb_object_keys(p)) <> 9");
    expect(SKILL_TUNABLE_KEYS).toHaveLength(9);
    expect(fn).toContain("v_sum := (v_pm + v_close) + v_prep;");
    expect(fn).toContain("exception when numeric_value_out_of_range then");
    expect(fn).not.toMatch(/v_(pm|close|prep) > 1\b/);
  });
});
