/** Isolated PostgreSQL WASM harness: never reads env or connects to any database. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

async function main() {
  const db = new PGlite();
  let checks = 0;
  async function expectDenied(sql: string) {
    await assert.rejects(db.exec(sql), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "42501");
    checks++;
  }
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;");
    // Simulate Supabase's explicit default function grants: migration must revoke both.
    await db.exec("ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;");
    await db.exec(readFileSync("supabase/migrations/0273_landing_order_click_counts.sql", "utf8"));
    const columns = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'landing_order_click_counts' ORDER BY ordinal_position");
    assert.deepEqual(columns.rows.map(row => row.column_name), ["day_utc", "store_key", "ad_code", "click_count"]); checks++;
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expectDenied("SELECT * FROM public.landing_order_click_counts");
      await expectDenied("SELECT public.increment_landing_order_click('dupont', 'subsim-photo')");
      await expectDenied("INSERT INTO public.landing_order_click_counts VALUES (current_date, 'dupont', 'unattributed', 1)");
      await expectDenied("UPDATE public.landing_order_click_counts SET click_count = 0");
      await expectDenied("DELETE FROM public.landing_order_click_counts");
      await db.exec("RESET ROLE");
    }
    await db.exec("SET ROLE service_role");
    await expectDenied("INSERT INTO public.landing_order_click_counts VALUES (current_date, 'dupont', 'unattributed', 1)");
    await expectDenied("UPDATE public.landing_order_click_counts SET click_count = 0");
    await expectDenied("DELETE FROM public.landing_order_click_counts");
    await expectDenied("TRUNCATE public.landing_order_click_counts");
    await db.exec("SET TIME ZONE 'Pacific/Honolulu'");
    // Submit concurrent promises against one isolated engine. PGlite serializes its connection;
    // this proves atomic queued increments, not a multi-connection deployment load test.
    await Promise.all(Array.from({ length: 100 }, () => db.query("SELECT public.increment_landing_order_click('dupont', 'subsim-photo')")));
    const result = await db.query<{ click_count: number; correct_day: boolean }>("SELECT click_count::integer, day_utc = (clock_timestamp() AT TIME ZONE 'UTC')::date AS correct_day FROM public.landing_order_click_counts");
    assert.equal(result.rows[0]?.click_count, 100); checks++;
    assert.equal(result.rows[0]?.correct_day, true); checks++;
    await db.exec("SELECT public.increment_landing_order_click('capitol-hill', 'unknown')");
    assert.equal((await db.query<{ ad_code: string }>("SELECT ad_code FROM public.landing_order_click_counts WHERE store_key = 'capitol-hill'")).rows[0]?.ad_code, "unattributed"); checks++;
    for (const sql of ["SELECT public.increment_landing_order_click('unknown', 'subsim-photo')", "SELECT public.increment_landing_order_click('dupont', repeat('x',65))", "SELECT public.increment_landing_order_click('dupont', NULL)"]) {
      await assert.rejects(db.exec(sql), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "22023"); checks++;
    }
    await db.exec("RESET ROLE");
    // Exercise RLS itself independent of grants in a transaction that is rolled back.
    await db.exec("BEGIN; GRANT SELECT ON public.landing_order_click_counts TO authenticated; SET ROLE authenticated;");
    assert.equal((await db.query("SELECT * FROM public.landing_order_click_counts")).rows.length, 0); checks++;
    await db.exec("RESET ROLE; ROLLBACK;");
    assert.equal((await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.landing_order_click_counts'::regclass")).rows[0]?.relrowsecurity, true); checks++;
    const fn = await db.query<{ prosecdef: boolean; proconfig: string[] }>("SELECT prosecdef, proconfig FROM pg_proc WHERE oid = 'public.increment_landing_order_click(text,text)'::regprocedure");
    assert.equal(fn.rows[0]?.prosecdef, true); checks++;
    assert.deepEqual(fn.rows[0]?.proconfig, ["search_path=pg_catalog, public"]); checks++;
    console.log(`Landing SQL harness: ${checks} checks passed; 100 concurrently submitted atomic increments; isolated PGlite only. Independent-session concurrency remains a deployment/sim gate.`);
  } finally { await db.close(); }
}
main().catch(() => { console.error("Landing SQL harness FAILED (isolated database only)"); process.exitCode = 1; });
