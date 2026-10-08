import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0222_toast_cutover_depletion.sql", "utf8");

describe("0222 capture depletion publication", () => {
  it("keeps capture aggregates separate from the legacy rollback ledger", () => {
    expect(sql).toContain("create table public.toast_capture_daily_depletion");
    const body = sql.slice(sql.indexOf("create function public.replace_toast_depletion_day"));
    expect(body).not.toContain("delete from public.toast_daily_depletion");
  });

  it("serializes a location/day and refuses incomplete, obsolete, or open days", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("toast_depletion_capture_incomplete");
    expect(sql).toContain("toast_depletion_obsolete_run");
    expect(sql).toContain("toast_depletion_open_day");
  });

  it("publishes explicit successful coverage even for empty row arrays", () => {
    expect(sql).toContain("jsonb_to_recordset(p_aggregates)");
    expect(sql).toContain("jsonb_to_recordset(p_attributions)");
    expect(sql).toContain("'success'");
    expect(sql).toContain("on conflict(location_id,business_date) do update");
  });

  it("clears default service write grants before exposing derived tables read-only", () => {
    expect(sql).toContain("revoke all on public.%I from public,anon,authenticated,service_role");
    expect(sql).toContain("grant select on public.%I to service_role");
    expect(sql).toMatch(/from public,anon,authenticated;\r?\ngrant execute on function public\.replace_toast_depletion_day/);
  });

  // Unresolved prep attribution is diagnostic-only; behavioral coverage lives in
  // toast-capture-materialization.test.ts (CC build-pass-2 ruling).
});
