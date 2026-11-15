/**
 * W09/B164 — the SIM two-session proof for 0309 (scripts/sim/pm-0309-lock-check-management.mjs), checked
 * OFFLINE only: its fixture is fresh and tagged, it never loads .env / pg / a direct DB URL, it races the real
 * writer against itself and against the v1 submit flip, it retires only its own configuration (never an
 * evaluation or a day), and the CLI refuses any project but the SIM. CC runs it on SIM; nothing here connects.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture, fixtureSQL, retireSQL, saveSQL, submitSQL, lateSaveSQL, runProof } from "../scripts/sim/pm-0309-lock-check-management.mjs";
import { PROD_REF, SIM_REF, projectRef } from "../scripts/supabase-management-query.mjs";

type F = Record<"shop" | "gm" | "kh" | "emp" | "day1" | "day2" | "tag", string>;

describe("0309 Management API proof (offline only)", () => {
  it("allocates a fresh tagged fixture and writes only new rows", () => {
    const f = fixture() as F;
    expect(f.tag).toBe(`SIM-0309-${f.shop}`);
    expect(new Set([f.shop, f.gm, f.kh, f.emp, f.day1, f.day2]).size).toBe(6);
    const sql = fixtureSQL(f);
    expect(sql).not.toMatch(/\b(update|delete|truncate)\b/i);
    expect(sql).toContain("date '2099-03-01','open'");
    expect(sql).toContain("'SIM-NO-VALID-CREDENTIAL'");
  });
  it("retires only its own configuration, never an evaluation or a day", () => {
    const f = fixture() as F;
    const retire = retireSQL(f);
    expect(retire.match(/set active=false/g)).toHaveLength(3);
    expect(retire).not.toMatch(/delete|truncate|pm_employee_evals|pm_reports/i);
  });
  it("races the real writer and the v1 submit flip; a late save must refuse by name", () => {
    const f = fixture() as F;
    expect(saveSQL(f, f.gm, f.day1, "great")).toContain("public.save_pm_employee_eval(");
    expect(submitSQL(f, f.day2)).toMatch(/update public\.pm_reports set status='submitted'[\s\S]*status='open'/);
    expect(lateSaveSQL(f, f.day2)).toContain("sqlerrm <> 'report_already_submitted'");
    const source = readFileSync("scripts/sim/pm-0309-lock-check-management.mjs", "utf8");
    expect(source).toContain("await proveRace(query, saveSQL(f, f.gm, f.day1, 'needs_work'), saveSQL(f, f.kh, f.day1, 'great')");
    expect(source).toContain("await proveRace(query, saveSQL(f, f.gm, f.day2, 'good'), submitSQL(f, f.day2)");
    expect(source).not.toMatch(/import.*dotenv|process\.env\.SIM_DATABASE_URL|import\(['"]pg['"]\)/);
  });
  it("the CLI target is the SIM only", () => {
    expect(() => projectRef([`--ref=${PROD_REF}`], true)).toThrow();
    expect(projectRef([`--ref=${SIM_REF}`], true)).toBe(SIM_REF);
  });
  it("refuses before any write when 0309 is missing", async () => {
    const seen: string[] = [];
    const query = async (sql: string) => { seen.push(sql); return [{ signature: "x", present: false, executable: false }]; };
    await expect(runProof(query, () => undefined)).rejects.toThrow(/0309/);
    expect(seen.some((s) => /insert into/i.test(s))).toBe(false);
  });
});
