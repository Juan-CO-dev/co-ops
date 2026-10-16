import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LANDING_AD_CODES, LANDING_STORE_KEYS } from "@/lib/landing/tracking-schema-shared";
const sql = readFileSync("supabase/migrations/0273_landing_order_click_counts.sql", "utf8");
describe("file-only landing counter migration contract", () => {
  it("keeps bounded vocabulary aligned and stores only aggregates", () => {
    for (const key of [...LANDING_AD_CODES, ...LANDING_STORE_KEYS]) expect(sql).toContain(`'${key}'`);
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
    expect(sql).not.toMatch(/GRANT\s+(?:UPDATE|DELETE|INSERT|ALL)\b/i);
  });
});
