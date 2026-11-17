// Item 2 PR 2c, gate G1 for LABOR: 0338's week fingerprint is complete only while every writer of the
// relations a labor week depends on is known. Scans every migration and every lib/ + app/ module for a
// statement that writes one of them and compares against a CLOSED list. A new writer, a removed one or a
// moved one fails here until it is classified: an in-place update of a column the builder reads (or any
// DELETE) must be in fact_labor_week_fingerprint first. The 7shifts mirror's generic writer (sync.ts,
// `db.from(spec.table)`) is grep-invisible, so its spec entries are pinned separately below.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MIRROR_WRITE_SPEC } from "@/lib/sevenshifts/mirror-spec-shared";

const SOURCES = ["sevenshifts_time_punches", "sevenshifts_wages", "sevenshifts_sync_runs", "sevenshifts_user_links", "sevenshifts_location_links",
  "toast_employee_links", "toast_time_entries", "sevenshifts_labor_settings", "fact_wage_observations", "labor_burden_settings",
  "labor_quarter", "labor_day_coverage", "labor_week_coverage", "labor_week_salaried"];
const SQL = new RegExp(`\\b(insert\\s+into|update|delete\\s+from|truncate(?:\\s+table)?)\\s+(?:only\\s+)?(?:public\\.)?(${SOURCES.join("|")})\\b`, "gi");
const JS = new RegExp(`\\.from\\(\\s*["'\`](${SOURCES.join("|")})["'\`]\\s*\\)\\s*\\.(insert|update|upsert|delete)\\(`, "g");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

/** file -> "op table" -> count. */
const CENSUS: Record<string, Record<string, number>> = {
  // 0233: link_toast_employee / unlink_toast_employee; each also rewrites toast_time_entries.user_id
  // (a column the builder reads: in the fingerprint's Toast hash).
  "supabase/migrations/0233_whos_here.sql": { "insert toast_employee_links": 1, "update toast_employee_links": 1, "update toast_time_entries": 2 },
  // 0268: THE wage reconciler (refresh / correct in place, insert, retire): every value change is observed by 0338's triggers.
  "supabase/migrations/0268_sevenshifts_sync.sql": { "update sevenshifts_wages": 2, "insert sevenshifts_wages": 1 },
  // 0269 / 0301: the four link writers (unlink = active false; every link row's id + active is hashed).
  "supabase/migrations/0269_sevenshifts_links.sql": { "insert sevenshifts_location_links": 1, "update sevenshifts_location_links": 1,
    "insert sevenshifts_user_links": 1, "update sevenshifts_user_links": 1 },
  "supabase/migrations/0301_sevenshifts_per_shop_links.sql": { "insert sevenshifts_user_links": 1 },
  // 0338: the observation trigger + cutover seed, the one week writer, the one burden writer.
  "supabase/migrations/0338_fact_layer_labor.sql": { "insert fact_wage_observations": 2, "delete labor_quarter": 1, "delete labor_day_coverage": 1,
    "delete labor_week_salaried": 1, "insert labor_quarter": 1, "insert labor_day_coverage": 1, "insert labor_week_salaried": 1,
    "insert labor_week_coverage": 1, "insert labor_burden_settings": 1 },
  // 0339 (overtime per shop): THE week writer re-emitted (same statements), and the one-time ot_scope backfill
  // of labor_week_coverage (a derived table; the label of the scope each existing week was built with).
  "supabase/migrations/0339_fact_labor_ot_per_shop.sql": { "delete labor_quarter": 1, "delete labor_day_coverage": 1,
    "delete labor_week_salaried": 1, "insert labor_quarter": 1, "insert labor_day_coverage": 1, "insert labor_week_salaried": 1,
    "insert labor_week_coverage": 1, "update labor_week_coverage": 1 },
  // The ledger row (append-only, one per finished run) and the Toast labor pull (upsert by entry guid).
  "lib/sevenshifts/sync.ts": { "insert sevenshifts_sync_runs": 1 },
  "lib/toast/labor.ts": { "insert toast_time_entries": 1 },
};

it("every writer of a labor-week source relation is in the census (G1)", () => {
  const found: Record<string, Record<string, number>> = {};
  const add = (file: string, key: string) => { (found[file] ??= {})[key] = (found[file][key] ?? 0) + 1; };
  for (const name of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql"))) {
    const file = `supabase/migrations/${name}`;
    for (const m of readFileSync(file, "utf8").matchAll(SQL)) add(file, `${m[1]!.toLowerCase().split(/\s+/)[0]!} ${m[2]!.toLowerCase()}`);
  }
  for (const file of [...walk("lib"), ...walk("app")]) {
    const rel = file.replace(/\\/g, "/");
    for (const m of readFileSync(file, "utf8").matchAll(JS)) add(rel, `${m[2] === "upsert" ? "insert" : m[2]} ${m[1]}`);
  }
  expect(found).toEqual(CENSUS);
});

it("the 7shifts mirror's generic writer upserts punches and labor settings by id only (never deletes)", () => {
  expect(MIRROR_WRITE_SPEC.time_punches).toMatchObject({ mode: "upsert", table: "sevenshifts_time_punches", onConflict: ["id"] });
  expect(MIRROR_WRITE_SPEC.labor_settings).toMatchObject({ mode: "upsert", table: "sevenshifts_labor_settings", onConflict: ["company_id"] });
  // Wages are never upserted: the spec routes them to THE reconciler (0268), whose writes the triggers observe.
  expect(MIRROR_WRITE_SPEC.wages).toMatchObject({ mode: "reconcile", table: "sevenshifts_wages", reconcileKind: "wages" });
  const upserted = Object.values(MIRROR_WRITE_SPEC).filter((s) => (s as { mode: string }).mode === "upsert").map((s) => (s as { table: string }).table);
  expect(upserted.filter((t) => ["sevenshifts_wages", "sevenshifts_sync_runs", "sevenshifts_user_links", "sevenshifts_location_links"].includes(t))).toEqual([]);
});

it("no DELETE or TRUNCATE of a labor SOURCE relation exists (only 0338's own derived rows are replaced)", () => {
  const derived = /labor_(quarter|day_coverage|week_salaried)$/;
  const all = Object.values(CENSUS).flatMap((ops) => Object.keys(ops));
  expect(all.filter((k) => /^(delete|truncate)/.test(k) && !derived.test(k))).toEqual([]);
});
