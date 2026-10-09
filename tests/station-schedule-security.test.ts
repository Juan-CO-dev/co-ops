import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../supabase/migrations/0238_station_schedules.sql", import.meta.url), "utf8");
const harness = readFileSync(new URL("../scripts/test-station-schedules.sql", import.meta.url), "utf8");

describe("station schedule security regression harness", () => {
  it.each([migration, harness])("checks inherited table and column ACLs and deny-all RLS", (sql) => {
    expect(sql).toContain("relrowsecurity");
    expect(sql).toContain("pg_policy where polrelid='public.stations'::regclass");
    expect(sql).toContain("array['anon','authenticated']");
    expect(sql).toContain("has_table_privilege(role_name,'public.stations',privilege_name)");
    expect(sql).toContain("has_any_column_privilege(role_name,'public.stations',privilege_name)");
    expect(sql).toContain("array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']");
    expect(sql).toContain("array['SELECT','INSERT','UPDATE','REFERENCES']");
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(sql).toContain(`has_table_privilege('service_role','public.stations','${privilege}')`);
    }
  });
  it("executes denied schedule operations under the staff role and rolls back", () => {
    const staff = harness.split("set local role authenticated;")[1]!.split("reset role;")[0]!;
    for (const operation of ["perform trims from public.stations", "update public.stations set trims", "insert into public.stations(trims)", "delete from public.stations"]) {
      expect(staff).toContain(operation);
    }
    expect(staff.match(/exception when insufficient_privilege then null/g)).toHaveLength(5);
    expect(harness.trim()).toMatch(/rollback;$/);
  });
});
