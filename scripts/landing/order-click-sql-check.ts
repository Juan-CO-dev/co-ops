/** Isolated PostgreSQL WASM harness: never reads env or connects to any database. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

async function main() {
  const db = new PGlite();
  let checks = 0;
  async function expectError(sql: string, code: string) {
    await assert.rejects(db.exec(sql), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === code);
    checks++;
  }
  async function scalar(sql: string) {
    return (await db.query<{ value: string | number | boolean }>(sql)).rows[0]?.value;
  }
  function equal(actual: unknown, expected: unknown) { assert.deepEqual(actual, expected); checks++; }
  try {
    // Non-superuser/non-BYPASSRLS owner proves ENABLE (not FORCE) RLS permits definer resolution.
    await db.exec("CREATE ROLE migration_owner; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO migration_owner, anon, authenticated, service_role; GRANT CREATE ON SCHEMA public TO migration_owner; SET ROLE migration_owner;");
    // Supabase explicit default ACLs, including broad table defaults.
    await db.exec("ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;");
    await db.exec(readFileSync("supabase/migrations/0273_landing_order_click_counts.sql", "utf8"));
    await db.exec("RESET ROLE");
    equal((await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'landing_order_click_counts' ORDER BY ordinal_position")).rows.map(row => row.column_name), ["day_utc", "store_key", "ad_code", "click_count"]);
    equal((await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'landing_ad_codes' ORDER BY ordinal_position")).rows.map(row => row.column_name), ["code", "slot", "active"]);
    equal(await scalar("SELECT count(*)::integer AS value FROM public.landing_ad_codes WHERE (code = 'unattributed' AND slot = 1 OR code = 'subsim-photo' AND slot = 2) AND active"), 2);
    for (const table of ["landing_ad_codes", "landing_order_click_counts"]) {
      equal((await db.query("SELECT cmd, qual, with_check FROM pg_policies WHERE tablename = $1 ORDER BY cmd", [table])).rows, [
        { cmd: "DELETE", qual: "false", with_check: null }, { cmd: "INSERT", qual: null, with_check: "false" },
        { cmd: "SELECT", qual: "false", with_check: null }, { cmd: "UPDATE", qual: "false", with_check: "false" },
      ]);
      equal(await scalar(`SELECT relrowsecurity AND NOT relforcerowsecurity AS value FROM pg_class WHERE oid = 'public.${table}'::regclass`), true);
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          const expected = role === "service_role" && (privilege === "SELECT" || (table === "landing_ad_codes" && privilege === "INSERT"));
          equal(await scalar(`SELECT has_table_privilege('${role}', 'public.${table}', '${privilege}') AS value`), expected);
        }
        for (const column of table === "landing_ad_codes" ? ["code", "slot", "active"] : ["day_utc", "store_key", "ad_code", "click_count"]) {
          equal(await scalar(`SELECT has_column_privilege('${role}', 'public.${table}', '${column}', 'UPDATE') AS value`), role === "service_role" && table === "landing_ad_codes" && column === "active");
        }
      }
      equal(await scalar(`SELECT count(*)::integer AS value FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid = 'public.${table}'::regclass AND a.grantee = 0`), 0);
    }
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      for (const table of ["landing_ad_codes", "landing_order_click_counts"]) {
        await expectError(`SELECT * FROM public.${table}`, "42501");
        await expectError(`DELETE FROM public.${table}`, "42501");
        await expectError(`TRUNCATE public.${table}`, "42501");
      }
      await expectError("SELECT public.increment_landing_order_click('dupont', 'subsim-photo')", "42501");
      await expectError("INSERT INTO public.landing_ad_codes (code, slot) VALUES ('denied', 3)", "42501");
      await expectError("UPDATE public.landing_ad_codes SET active = false", "42501");
      await expectError("INSERT INTO public.landing_order_click_counts VALUES (current_date, 'dupont', 'unattributed', 1)", "42501");
      await expectError("UPDATE public.landing_order_click_counts SET click_count = 0", "42501");
      await db.exec("RESET ROLE");
    }
    equal((await db.query("SELECT prosecdef, proconfig, pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = 'public.increment_landing_order_click(text,text)'::regprocedure")).rows, [{ prosecdef: true, proconfig: ["search_path=pg_catalog, public"], owner: "migration_owner" }]);
    equal(await scalar("SELECT rolsuper OR rolbypassrls AS value FROM pg_roles WHERE rolname = 'migration_owner'"), false);
    equal(await scalar("SELECT count(*)::integer AS value FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid = 'public.increment_landing_order_click(text,text)'::regprocedure AND a.grantee = 0"), 0);
    await db.exec("SET ROLE service_role");
    await expectError("INSERT INTO public.landing_order_click_counts VALUES (current_date, 'dupont', 'unattributed', 1)", "42501");
    await expectError("UPDATE public.landing_order_click_counts SET click_count = 0", "42501");
    for (const table of ["landing_ad_codes", "landing_order_click_counts"]) {
      await expectError(`DELETE FROM public.${table}`, "42501");
      await expectError(`TRUNCATE public.${table}`, "42501");
    }
    await expectError("UPDATE public.landing_ad_codes SET code = 'renamed' WHERE code = 'subsim-photo'", "42501");
    await expectError("UPDATE public.landing_ad_codes SET slot = 100 WHERE code = 'subsim-photo'", "42501");
    await expectError("UPDATE public.landing_ad_codes SET active = false WHERE code = 'unattributed'", "23514");
    equal(await scalar("SELECT active AS value FROM public.landing_ad_codes WHERE code = 'unattributed'"), true);
    for (const code of ["", "CAPS", "bad space", "send@example.test", "-bad", "code\n", "code\r", "code\r\n", "a".repeat(65)]) {
      await expectError(`INSERT INTO public.landing_ad_codes (code, slot) VALUES ('${code}', 3)`, "23514");
    }
    for (const slot of [0, 1025]) await expectError(`INSERT INTO public.landing_ad_codes (code, slot) VALUES ('outside', ${slot})`, "23514");
    // New family/campaign/send codes added after migration without application rebuilds.
    await db.exec("INSERT INTO public.landing_ad_codes (code, slot) SELECT 'family-' || n, n + 2 FROM generate_series(1,12) n; INSERT INTO public.landing_ad_codes (code, slot) VALUES ('campaign-fall',15), ('send-oct18',16), ('a',17), (repeat('z',64),18);");
    for (const code of [...Array.from({ length: 12 }, (_, i) => `family-${i + 1}`), "campaign-fall", "send-oct18", "a", "z".repeat(64)]) {
      await db.query("SELECT public.increment_landing_order_click('dupont', $1)", [code]);
      equal((await db.query<{ value: number }>("SELECT click_count::integer AS value FROM public.landing_order_click_counts WHERE ad_code = $1", [code])).rows[0]?.value, 1);
    }
    await db.exec("SET TIME ZONE 'Pacific/Honolulu'");
    // Queued on ONE connection: not independent-session contention evidence.
    await Promise.all(Array.from({ length: 100 }, () => db.query("SELECT public.increment_landing_order_click('dupont', 'subsim-photo')")));
    equal(await scalar("SELECT click_count::integer AS value FROM public.landing_order_click_counts WHERE ad_code = 'subsim-photo'"), 100);
    equal(await scalar("SELECT bool_and(day_utc = (clock_timestamp() AT TIME ZONE 'UTC')::date) AS value FROM public.landing_order_click_counts"), true);
    await db.exec("UPDATE public.landing_ad_codes SET active = false WHERE code = 'subsim-photo'; SELECT public.increment_landing_order_click('dupont', 'subsim-photo');");
    equal(await scalar("SELECT click_count::integer AS value FROM public.landing_order_click_counts WHERE ad_code = 'subsim-photo'"), 100);
    equal(await scalar("SELECT click_count::integer AS value FROM public.landing_order_click_counts WHERE ad_code = 'unattributed'"), 1);
    await db.exec("UPDATE public.landing_ad_codes SET active = true WHERE code = 'subsim-photo'; SELECT public.increment_landing_order_click('dupont', 'subsim-photo');");
    equal(await scalar("SELECT click_count::integer AS value FROM public.landing_order_click_counts WHERE ad_code = 'subsim-photo'"), 101);
    for (const code of ["", "UNKNOWN", "bad@code", "-bad", ...Array.from({ length: 100 }, (_, i) => `unknown-${i}`)]) {
      await db.query("SELECT public.increment_landing_order_click('capitol-hill', $1)", [code]);
    }
    equal((await db.query("SELECT ad_code, click_count::integer FROM public.landing_order_click_counts WHERE store_key = 'capitol-hill'")).rows, [{ ad_code: "unattributed", click_count: 104 }]);
    equal(await scalar("SELECT count(*)::integer AS value FROM public.landing_ad_codes"), 18);
    for (const sql of ["SELECT public.increment_landing_order_click('unknown', 'subsim-photo')", "SELECT public.increment_landing_order_click(NULL, 'subsim-photo')", "SELECT public.increment_landing_order_click('dupont', repeat('x',65))", "SELECT public.increment_landing_order_click('dupont', NULL)"]) await expectError(sql, "22023");
    // Queued collision proves unique-slot enforcement, not simultaneous sessions.
    const claims = await Promise.allSettled(["claim-a", "claim-b"].map(code => db.query("INSERT INTO public.landing_ad_codes (code, slot) VALUES ($1, 19)", [code])));
    equal(claims.filter(result => result.status === "fulfilled").length, 1);
    const rejected = claims.find(result => result.status === "rejected");
    equal(rejected?.status === "rejected" ? (rejected.reason as { code: string }).code : undefined, "23505");
    await db.exec("INSERT INTO public.landing_ad_codes (code, slot) SELECT 'capacity-' || n, n FROM generate_series(20,1024) n; UPDATE public.landing_ad_codes SET active = false WHERE code <> 'unattributed';");
    equal(await scalar("SELECT count(*)::integer AS value FROM public.landing_ad_codes"), 1024);
    await expectError("INSERT INTO public.landing_ad_codes (code, slot) VALUES ('reuse-retired', 2)", "23505");
    await expectError("INSERT INTO public.landing_ad_codes (code, slot) VALUES ('over-capacity', 1025)", "23514");
    await db.exec("RESET ROLE");
    await expectError("INSERT INTO public.landing_order_click_counts VALUES (current_date, 'dupont', 'not-registered', 1)", "23503");
    await expectError("INSERT INTO public.landing_order_click_counts VALUES (current_date, 'bad-store', 'unattributed', 1)", "23514");
    await expectError("UPDATE public.landing_order_click_counts SET click_count = 0", "23514");
    // Overflow is atomic: a preceding update in the transaction also rolls back.
    await db.exec("UPDATE public.landing_order_click_counts SET click_count = 9223372036854775807 WHERE store_key = 'dupont' AND ad_code = 'unattributed'; SET ROLE service_role;");
    await db.exec("BEGIN; UPDATE public.landing_ad_codes SET active = true WHERE code = 'family-1';");
    await expectError("SELECT public.increment_landing_order_click('dupont', 'unattributed')", "22003");
    await db.exec("ROLLBACK");
    equal(await scalar("SELECT click_count::text AS value FROM public.landing_order_click_counts WHERE store_key = 'dupont' AND ad_code = 'unattributed'"), "9223372036854775807");
    equal(await scalar("SELECT active AS value FROM public.landing_ad_codes WHERE code = 'family-1'"), false);
    await db.exec("RESET ROLE");
    // Exercise policies independently from ACL denials; roll back temporary grants.
    for (const table of ["landing_ad_codes", "landing_order_click_counts"]) {
      await db.exec(`BEGIN; GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated; SET ROLE authenticated;`);
      equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 0);
      equal((await db.query(`DELETE FROM public.${table} RETURNING *`)).rows.length, 0);
      equal((await db.query(`UPDATE public.${table} SET ${table === "landing_ad_codes" ? "active = false" : "click_count = 5"} RETURNING *`)).rows.length, 0);
      await db.exec("RESET ROLE; ROLLBACK;");
      await db.exec(`BEGIN; GRANT INSERT ON public.${table} TO authenticated; SET ROLE authenticated;`);
      await expectError(table === "landing_ad_codes" ? "INSERT INTO public.landing_ad_codes (code, slot) VALUES ('rls-denied', 1024)" : "INSERT INTO public.landing_order_click_counts VALUES (current_date, 'dupont', 'family-2', 1)", "42501");
      await db.exec("ROLLBACK; RESET ROLE;");
    }
    console.log(`Landing SQL harness: ${checks} checks passed; 100 queued atomic increments; 1024 lifetime slots including retired codes; isolated PGlite only. Independent-session slot, increment, and retirement contention remain CC sim/apply gates.`);
  } finally { await db.close(); }
}
main().catch((error: unknown) => { console.error("Landing SQL harness FAILED (isolated synthetic database only)", error); process.exitCode = 1; });
