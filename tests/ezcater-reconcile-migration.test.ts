import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/0229_ezcater_toast_reconcile.sql");
const planner = read("scripts/ezcater-reconcile-plan.sql");
const dryRun = read("scripts/ezcater-toast-reconcile-dry-run.sql");
const cte = (s: string) => s.slice(s.indexOf("with eligible as ("), s.indexOf("\nselect * from planned"));
describe("0229 deployment artifacts", () => {
  it("the pre-apply dry run uses the exact production planner", () => {
    expect(cte(planner)).toBe(cte(migration));
    expect(dryRun).toContain(cte(migration));
    expect(dryRun).toContain("begin read only;");
    expect(dryRun).not.toMatch(/\b(insert into|update public|delete from|create |alter )/i);
  });
  it("preserves pass 2 map, review and shadow publication verbatim", () => {
    const previous = read("supabase/migrations/0225_ezcater_pass2.sql");
    const start = " for r in select value from jsonb_array_elements(p_payload->'maps') order by value->>'identity_key' loop";
    const body = (s: string) => {
      const a = s.indexOf(start);
      expect(a).toBeGreaterThan(0);
      return s.slice(a, s.indexOf("end $$;", a));
    };
    expect(body(migration)).toBe(body(previous));
  });
});
