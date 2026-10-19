import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_STORE_KEYS } from "@/lib/landing/tracking-schema-shared";
const sql = readFileSync("supabase/migrations/0273_landing_order_click_counts.sql", "utf8");
describe("file-only landing counter migration contract", () => {
  it('wraps the file atomically and asserts both table owners, with expected FK lint', () => {
    expect(sql.replace(/^--.*$/gm, '').trim()).toMatch(/^begin;/);
    expect(sql.trim()).toMatch(/commit;$/);
    expect(sql).toContain('Re-application is intentionally an error');
    expect(sql).toContain('c.relowner <> (select p.proowner');
    expect(sql).toContain("raise exception '0273:");
    expect(sql).toContain('unindexed_foreign_keys');
    expect(sql).not.toMatch(/CREATE\s+INDEX/i);
  });
  it("keeps bounded vocabulary aligned and stores only aggregates", () => {
    for (const key of ["unattributed", "subsim-photo", ...LANDING_STORE_KEYS]) expect(sql).toContain(`'${key}'`);
    expect(sql).toContain("PRIMARY KEY (day_utc, store_key, ad_code)");
    expect(sql).toContain("click_count bigint NOT NULL CHECK (click_count > 0)");
    expect(sql).not.toMatch(/\b(ip_address|user_agent|event_id|fbclid|cookie|customer_id)\b/i);
  });
  it("pins privileged increment-only RPC and UTC server date", () => {
    expect(sql).toContain("NOT APPLIED");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.increment_landing_order_click(text, text) TO service_role");
    expect(sql).toContain("AT TIME ZONE 'UTC'");
    expect(sql).toContain("landing_order_click_counts.click_count + 1");
    // Deliberate relaxation: the registry is managed by service_role; the counter
    // itself retains its original SELECT-only grant ceiling.
    expect(sql).not.toMatch(/GRANT\s+[^;]*\b(?:UPDATE|DELETE|INSERT|ALL)\b[^;]*ON\s+(?:TABLE\s+)?public\.landing_order_click_counts\b/i);
  });
  it("pins the finite lifetime registry and narrow management grants", () => {
    expect(sql).toContain("slot smallint NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 1024)");
    expect(sql).toContain("CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$')");
    expect(sql).toContain("CHECK (code <> 'unattributed' OR active)");
    expect(sql).toContain("GRANT SELECT, INSERT ON TABLE public.landing_ad_codes TO service_role");
    expect(sql).toContain("GRANT UPDATE (active) ON TABLE public.landing_ad_codes TO service_role");
    expect(sql).toContain("REFERENCES public.landing_ad_codes(code)");
    expect(sql).not.toMatch(/FOR ALL|FORCE ROW LEVEL SECURITY|ON DELETE CASCADE/i);
    expect(sql).not.toMatch(/ad_code text NOT NULL CHECK/);
    for (const operation of ["read", "no_user_insert", "no_user_update", "no_user_delete"]) {
      expect(sql).toContain(`CREATE POLICY landing_ad_codes_${operation}`);
    }
  });
  it("locks active eligibility against retirement and never learns request codes", () => {
    expect(sql).toMatch(/FROM public\.landing_ad_codes[\s\S]*?active[\s\S]*?FOR SHARE/);
    expect(sql).not.toContain("FOR KEY SHARE");
    const functionBody = sql.split("CREATE FUNCTION public.increment_landing_order_click")[1]!;
    expect(functionBody).not.toMatch(/INSERT INTO public\.landing_ad_codes/);
    expect(functionBody).toContain("COALESCE(v_ad, 'unattributed')");
  });
});
