/**
 * Item 21 PR 5: Migration 0350 (the settings writer). File only; CC applies sim then prod on Juan's word.
 * Pins the file's shape, holds the app's dependency rule (`settingsRefusal`) to the writer's refusals in the writer's
 * order, and runs the offline PGlite proof (scripts/sql-harness-0350.mjs, the REAL 0344 file). Pinned BY NAME.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTINGS_DEPENDENCY_REFUSALS, SETTINGS_ERRORS, toSettingsRow, DEFAULT_CATERING_TOAST_SETTINGS, CATERING_TOAST_SETTINGS_ROLES } from "@/lib/catering/catering-toast-settings-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const sql = readFileSync("supabase/migrations/0350_catering_toast_settings_writer.sql", "utf8").replace(/\r\n/g, "\n");
const code = sql.replace(/--[^\n]*/g, "");
const writer = code.match(/create function public\.set_catering_toast_settings\([\s\S]*?\nend \$\$;/)![0];

describe("0350 header and shape", () => {
  it("gate header, one transaction, file only, the number explained", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0350_catering_toast_settings_writer");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-19 .*NOT YET APPLIED -- GATE CC\/JUAN/);
    expect(sql).toMatch(/0348 \(item 21 PR 4\) and 0349 \(unit br-access\) are claimed/);
    expect(code.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().split("\n").filter((l) => l.trim() && !l.startsWith("--")).pop()).toBe("commit;");
    for (const refusal of ["0350: apply 0344 first", "0350: apply 0347 first", "0350: set_catering_toast_settings already exists", "0350: catering_toast_settings is not the 0344 shape"]) {
      expect(code).toContain(`raise exception '${refusal}'`);
    }
  });

  it("adds two functions and nothing else: no table, no policy, no grant on a table, no ezCater object", () => {
    expect([...code.matchAll(/create (?:or replace )?function public\.(\w+)/g)].map((m) => m[1])).toEqual(["set_catering_toast_settings", "catering_toast_settings_ready"]);
    expect(code).not.toMatch(/create\s+(table|policy|view|trigger|index)|alter\s+table|drop\s+/i);
    expect(code).not.toMatch(/grant\s+(select|insert|update|delete|all)\b/i);
    expect(code).not.toMatch(/ezcater_toast_links|publish_ezcater_shadow|reconcile_ezcater_toast\b|plan_ezcater_toast/);
    expect([...code.matchAll(/grant execute on function public\.(\w+)\(/g)].map((m) => m[1]).sort()).toEqual(["catering_toast_settings_ready", "set_catering_toast_settings"]);
    for (const name of ["set_catering_toast_settings", "catering_toast_settings_ready"]) {
      expect(code).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`));
    }
    expect(code.match(/security definer set search_path = pg_catalog, public as \$\$/g)).toHaveLength(2);
  });

  it("the writer: who, the lock first, the row the person saw, ONE destructive audit row", () => {
    const lock = writer.indexOf("perform pg_advisory_xact_lock(hashtext('ezcater-toast-reconcile'));");
    const role = writer.indexOf("from public.users u where u.id = p_actor_id and u.active for share;");
    const row = writer.indexOf("from public.catering_toast_settings s where s.location_id = p_location_id for update;");
    const insert = writer.indexOf("insert into public.catering_toast_settings(");
    expect(lock).toBeGreaterThan(0);
    expect(role).toBeGreaterThan(lock);
    expect(row).toBeGreaterThan(role);
    expect(insert).toBeGreaterThan(row);
    expect(writer).toContain(`if v_role is null or v_role not in (${CATERING_TOAST_SETTINGS_ROLES.map((r) => `'${r}'`).join(", ")}) then raise exception 'forbidden'`);
    expect(writer).toContain("if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'settings_moved'");
    expect(writer.match(/insert into public\.audit_log/g)).toHaveLength(1);
    expect(writer).toMatch(/'catering\.toast_settings_update', 'catering_toast_settings', p_location_id,\s+jsonb_build_object\('location_id', p_location_id, 'before', v_before, 'after', v_after\), true\);/);
    expect(code.match(/(insert into|update)\s+public\.catering_toast_settings\b/g)).toHaveLength(1);
  });

  it("the eight settings the writer accepts are the eight the app sends", () => {
    const keys = writer.match(/c_keys constant text\[\] := array\[([^\]]+)\]/)![1]!.split(",").map((k) => k.trim().replace(/'/g, ""));
    expect(keys.sort()).toEqual(Object.keys(toSettingsRow(DEFAULT_CATERING_TOAST_SETTINGS)).sort());
    expect(writer).toContain("(select count(*) from jsonb_object_keys(p_settings)) <> 8");
  });

  it("the app's dependency rule is the writer's: the same refusals in the same order", () => {
    const named = [...writer.matchAll(/raise exception '(\w+)' using errcode = 'P0001'/g)].map((m) => m[1]!);
    const dependencies = named.filter((n) => (SETTINGS_DEPENDENCY_REFUSALS as readonly string[]).includes(n));
    expect(dependencies).toEqual([...SETTINGS_DEPENDENCY_REFUSALS]);
    // ... and they come after the row comparison and before the unchanged-save test.
    expect(named.indexOf("settings_moved")).toBeLessThan(named.indexOf(SETTINGS_DEPENDENCY_REFUSALS[0]));
    expect(named.indexOf("no_change")).toBeGreaterThan(named.indexOf(SETTINGS_DEPENDENCY_REFUSALS[SETTINGS_DEPENDENCY_REFUSALS.length - 1]!));
    // Every name the writer can raise has an en + es message; nothing is left to a generic fallback.
    for (const name of new Set(named)) {
      expect([name, (SETTINGS_ERRORS as readonly string[]).includes(name)]).toEqual([name, true]);
      for (const dict of [en, es] as Array<Record<string, string>>) expect([name, typeof dict[`admin.catering.toast.error.${name}`]]).toEqual([name, "string"]);
    }
  });
});

describe("0350 behaviour (PGlite, the real 0344 file)", () => {
  it("scripts/sql-harness-0350.mjs passes", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0350.mjs"], { encoding: "utf8" });
    expect(Number(out.match(/sql-harness-0350: (\d+) checks passed/)![1])).toBeGreaterThanOrEqual(64);
  }, 300_000);
});
