/**
 * Scheduling Phase 1, Task 5 Step 6b (r1 P2-4) — THE REAL UPSERT. For EVERY MIRROR_WRITE_SPEC entry, a
 * realistic 7shifts payload goes through the REAL normalizer, and the statement the spec implies runs in
 * PGlite against the REAL 0243 + 0268 schema: upsert mode builds `insert … on conflict (<spec key>) do
 * update` from the normalizer's own keys and runs it twice (insert, then update); reconcile mode calls
 * reconcile_sevenshifts_user_snapshot with the normalized rows. A missing column, a conflict key with no
 * unique index, or a type mismatch fails here — the test that would have caught r0's "on conflict (id)
 * everywhere".
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { MIRROR_WRITE_SPEC, MIRRORED_RESOURCES } from "@/lib/sevenshifts/mirror-spec-shared";
import * as N from "@/lib/sevenshifts/normalize-shared";
import { assignmentsSnapshot, wagesSnapshot } from "@/lib/sevenshifts/paginate-shared";
import { ASSIGNMENTS_DOC_EXAMPLE, PAYLOAD } from "./fixtures/sevenshifts/payloads";

let db: PGlite;
let runId: string;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(readFileSync("tests/fixtures/scheduling-pglite-stub.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0243_cron_route_leases.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/0268_sevenshifts_sync.sql", "utf8"));
  await db.exec("set role service_role");
  runId = (await db.query<{ id: string }>("insert into public.sevenshifts_sync_run_ids (trigger) values ('cron') returning id")).rows[0]!.id;
}, 120_000);
afterAll(async () => { await db?.close(); });

/** The normalized row for an upsert-mode resource, from its realistic payload. */
function normalizedUpsertRow(resource: string, variant: number): Record<string, unknown> {
  const p = PAYLOAD as unknown as Record<string, Record<string, unknown>>;
  const raw = { ...p[resource]! };
  // A changed value on the second pass, so the update path really updates.
  if (variant === 1) {
    if (resource === "labor_settings") raw.weekly_overtime_threshold = 44;
    else if ("name" in raw) raw.name = "Renamed";
    else if (resource === "users") raw.employee_id = "EMP-13";
    else if (resource === "shifts" || resource === "time_punches") raw.deleted = true;
    else raw.status = 2;
  }
  const out = resource === "labor_settings"
    ? N.normalizeLaborSettings(raw)
    : (N as unknown as Record<string, (xs: unknown[]) => N.Normalized<Record<string, unknown>>>)[MIRROR_WRITE_SPEC[resource as "users"].normalizer]!([raw]);
  expect(out.rejected, `${resource} payload rejected`).toEqual([]);
  return out.rows[0] as Record<string, unknown>;
}

const sqlValue = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);

describe("every upsert mirror: the spec's statement runs against the real 0268 schema", () => {
  for (const resource of MIRRORED_RESOURCES) {
    const spec = MIRROR_WRITE_SPEC[resource];
    if (spec.mode !== "upsert") continue;
    it(`${resource} → ${spec.table} on conflict (${spec.onConflict.join(", ")}), insert then update`, async () => {
      for (const variant of [0, 1]) {
        const row = normalizedUpsertRow(resource, variant);
        const cols = Object.keys(row);
        expect(cols.sort()).toEqual([...spec.columns].sort());
        const updates = cols.filter((c) => !spec.onConflict.includes(c)).map((c) => `${c} = excluded.${c}`).join(", ");
        const sql = `insert into public.${spec.table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})
          on conflict (${spec.onConflict.join(", ")}) do update set ${updates}`;
        await db.query(sql, cols.map((c) => sqlValue(row[c])));
      }
      const rows = (await db.query<Record<string, unknown>>(`select * from public.${spec.table}`)).rows;
      expect(rows).toHaveLength(1);
      const r = rows[0]!;
      if (resource === "labor_settings") expect(Number(r.weekly_ot_threshold)).toBe(44);
      else if ("name" in r) expect(r.name).toBe("Renamed");
      else if (resource === "users") expect(r.employee_id).toBe("EMP-13");
      else if (resource === "shifts" || resource === "time_punches") expect(r.deleted).toBe(true);
      else expect(r.status).toBe(2);
    });
  }
});

describe("the reconciled mirrors: normalized rows go through the real reconciler", () => {
  it("assignments: the documented example gives ONE live edge (4569, 7890, 2583)", async () => {
    const snap = assignmentsSnapshot(ASSIGNMENTS_DOC_EXAMPLE);
    if (!snap.ok) throw new Error("doc example refused");
    const out = N.normalizeAssignments("501", snap.value);
    expect(out.rejected).toEqual([]);
    expect(Object.keys(out.rows[0]!).sort()).toEqual([...MIRROR_WRITE_SPEC.assignments.columns].sort());
    const r = (await db.query<{ r: Record<string, number> }>("select public.reconcile_sevenshifts_user_snapshot($1, 501, 'assignments', true, $2::jsonb) as r",
      [runId, JSON.stringify(out.rows)])).rows[0]!.r;
    expect(r).toMatchObject({ seen: 1, inserted: 1, retired: 0 });
    const live = (await db.query<{ location_id: string; department_id: string; role_id: string }>(
      "select location_id::text, department_id::text, role_id::text from public.sevenshifts_user_assignments where active")).rows;
    expect(live).toEqual([{ location_id: "4569", department_id: "7890", role_id: "2583" }]);
  });

  it("wages: a current and an upcoming wage, both live", async () => {
    const snap = wagesSnapshot(PAYLOAD.wages);
    if (!snap.ok) throw new Error("wages refused");
    const out = N.normalizeWages("501", snap.value);
    expect(out.rejected).toEqual([]);
    expect(Object.keys(out.rows[0]!).sort()).toEqual([...MIRROR_WRITE_SPEC.wages.columns].sort());
    const r = (await db.query<{ r: Record<string, number> }>("select public.reconcile_sevenshifts_user_snapshot($1, 501, 'wages', true, $2::jsonb) as r",
      [runId, JSON.stringify(out.rows)])).rows[0]!.r;
    expect(r).toMatchObject({ seen: 2, inserted: 2, retired: 0 });
  });
});
