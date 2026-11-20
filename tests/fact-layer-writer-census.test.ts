// Item 2 gate G1 (plan r3 §1 item 7): the fact fingerprint (0337) is complete only while every writer
// of the relations a fact day depends on is known. This census scans every migration and every
// lib/ + app/ module for a statement that writes one of them and compares against a CLOSED list.
// A new writer, a removed one, or a moved one fails here until it is classified: an in-place UPDATE
// of a column the facts read (or any DELETE) must be added to fact_order_day_fingerprint first.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const SOURCES = ["toast_order_latest_pointers", "toast_capture_runs", "toast_capture_run_orders", "toast_orders",
  "toast_order_checks", "toast_payments", "toast_check_discounts"];
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

/** file → "op table" → count. Classification of each entry is in the 0337 header. */
const CENSUS: Record<string, Record<string, number>> = {
  // 0221: page writer (immutable snapshot + children, run membership, run counters) and finish (pointer precedence, completion).
  "supabase/migrations/0221_toast_order_capture.sql": { "insert toast_orders": 1, "insert toast_order_checks": 1,
    "insert toast_check_discounts": 1, "insert toast_payments": 1, "insert toast_capture_run_orders": 1,
    "update toast_capture_runs": 2, "insert toast_order_latest_pointers": 1 },
  // 0222: the claim (stale running -> failed; a new running run). Never touches a completed run's id/orders.
  "supabase/migrations/0222_toast_cutover_depletion.sql": { "update toast_capture_runs": 1, "insert toast_capture_runs": 1 },
  // 0237: modified discovery: a run that ends 'modified_completed' (never coverage) and the claim re-emit.
  "supabase/migrations/0237_toast_modified_capture.sql": { "insert toast_capture_runs": 2, "update toast_capture_runs": 2 },
  // 0239: the page writer re-emitted with additive child fields (same immutability).
  "supabase/migrations/0239_sales_true_net.sql": { "insert toast_orders": 1, "insert toast_order_checks": 1,
    "insert toast_check_discounts": 1, "insert toast_payments": 1, "insert toast_capture_run_orders": 1, "update toast_capture_runs": 1 },
  // 0351: toast_snapshot_dedup_apply, the duplicate-snapshot cleanup (G1 re-opened and classified here). It deletes the
  // payload of EXACT duplicate snapshots only, never a latest-pointer target (refused by name, candidate_now_target, with
  // the pointer FK as the backstop), and never writes a run, a membership or a pointer. A fact day's fingerprint is its
  // pointer set + its latest completed run (id, orders) + the builder version, so no fingerprint input can change and
  // the fingerprint needs no new term. tests/toast-snapshot-dedup-migration.test.ts proves pointers and memberships
  // byte-identical across an apply.
  "supabase/migrations/0351_toast_snapshot_dedup.sql": { "delete toast_check_discounts": 1, "delete toast_payments": 1,
    "delete toast_order_checks": 1, "delete toast_orders": 1 },
  // lib/toast/capture.ts: run lifecycle (running/failed) and catering_status on a completed run; no fingerprint column.
  "lib/toast/capture.ts": { "insert toast_capture_runs": 1, "update toast_capture_runs": 3 },
};

it("every writer of a fact-day source relation is in the census (G1)", () => {
  const found: Record<string, Record<string, number>> = {};
  const add = (file: string, key: string) => { (found[file] ??= {})[key] = (found[file][key] ?? 0) + 1; };
  for (const name of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql"))) {
    const file = `supabase/migrations/${name}`;
    for (const m of readFileSync(file, "utf8").matchAll(SQL)) {
      const op = m[1]!.toLowerCase().split(/\s+/)[0]!;
      add(file, `${op} ${m[2]!.toLowerCase()}`);
    }
  }
  for (const file of [...walk("lib"), ...walk("app")]) {
    const rel = file.replace(/\\/g, "/");
    for (const m of readFileSync(file, "utf8").matchAll(JS)) add(rel, `${m[2] === "upsert" ? "insert" : m[2]} ${m[1]}`);
  }
  expect(found).toEqual(CENSUS);
});

it("the only DELETEs of a source relation are 0351's duplicate cleanup; no TRUNCATE, no other deleter (a new one must re-open G1)", () => {
  const deleters = Object.entries(CENSUS).filter(([, ops]) => Object.keys(ops).some((k) => /^(delete|truncate)/.test(k)));
  expect(deleters.map(([file]) => file)).toEqual(["supabase/migrations/0351_toast_snapshot_dedup.sql"]);
  expect(Object.keys(deleters[0]![1]).sort()).toEqual(["delete toast_check_discounts", "delete toast_order_checks", "delete toast_orders", "delete toast_payments"]);
  // Never a run, a membership or a pointer: the fingerprint's inputs.
  const all = Object.values(CENSUS).flatMap((ops) => Object.keys(ops));
  expect(all.filter((k) => /^(delete|truncate) (toast_order_latest_pointers|toast_capture_runs|toast_capture_run_orders)$/.test(k))).toEqual([]);
  expect(all.filter((k) => /^truncate/.test(k))).toEqual([]);
});
