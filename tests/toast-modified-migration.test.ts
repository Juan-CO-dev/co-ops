import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0237_toast_modified_capture.sql", "utf8");
const prior = readFileSync("supabase/migrations/0222_toast_cutover_depletion.sql", "utf8");
function claim(text: string) {
  return text.slice(text.indexOf("function public.toast_capture_claim("), text.indexOf("end $$;", text.indexOf("function public.toast_capture_claim(")) + 7);
}
describe("0237 modified discovery SQL contracts", () => {
  it("preserves the reviewed 0222 claim apart from discovery exclusion", () => {
    expect(claim(sql).replace(/\r/g, "").replace("   and status<>'modified_completed'\n", "")).toBe(claim(prior).replace(/\r/g, ""));
  });
  it("centralizes snapshot publication and marks discovery in the same transaction", () => {
    const body = sql.slice(sql.indexOf("create function public.toast_modified_save"), sql.indexOf("-- 0222 claim"));
    expect(body).toContain("perform public.toast_capture_page(run_id,p_location_id,day,1,jsonb_build_array(entry))");
    expect(body).toContain("perform public.toast_capture_finish(run_id,p_location_id,day,1)");
    expect(body).toContain("set status='modified_completed'");
    expect(body).not.toMatch(/insert into public\.toast_orders|update public\.toast_order_latest_pointers/);
  });
  it("ships a rollback harness exercising real writers and refusing production fixtures", () => {
    const harness = readFileSync("scripts/test-toast-modified-capture.sql", "utf8");
    expect(harness).toContain("raise exception 'SIM ONLY'");
    expect(harness.trim()).toMatch(/rollback;$/);
    for (const assertion of ["late refund not captured", "retry duplicated capture", "older payment state accepted", "discovery inflated full-day coverage", "discovery blocked daily capture", "stale CAS advanced"]) {
      expect(harness).toContain(assertion);
    }
  });
});
