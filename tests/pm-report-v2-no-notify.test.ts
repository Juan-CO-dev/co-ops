/**
 * Scheduling Phase 1, Task 20 Step 2 — THE NO-NOTIFY PIN (house rule before launch: nothing in this phase
 * sends anything).
 *
 * 1. A full PM v2 flow — open a copy → grade → note → set the window → mark done → submit the day → the
 *    MVP — over the in-memory fake never calls `enqueueNotification` (v1's submit sends SHIFT_FEEDBACK; a v2
 *    day must not).
 * 2. A source scan: lib/pm-report-v2*.ts, lib/pm-criteria.ts, lib/people/** and lib/sevenshifts/** import
 *    neither `@/lib/notifications` nor `@/lib/email` (nor call either by name).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./fixtures/counts-fake-db";

vi.mock("@/lib/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined), NOTIFICATION_TYPES: { SHIFT_FEEDBACK: "shift_feedback" } }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => undefined) }));
const { enqueueNotification } = await import("@/lib/notifications");
const v2 = await import("@/lib/pm-report-v2");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KH = "00000000-0000-4000-8000-000000000001", EMP = "00000000-0000-4000-8000-000000000006";
const ST = "00000000-0000-4000-8000-000000000011", P = "00000000-0000-4000-8000-000000000021", C = "00000000-0000-4000-8000-000000000031";
const DAY = "00000000-0000-4000-8000-000000000041", COPY = "00000000-0000-4000-8000-000000000042";
const DATE = "2026-10-15";

describe("the no-notify pin", () => {
  it("open → grade → note → window → done → submit → MVP never enqueues a notification", async () => {
    const db = createFakeDb({
      users: [{ id: KH, name: "Kim", role: "key_holder", active: true }, { id: EMP, name: "Eli", role: "employee", active: true }],
      pm_reports: [{ id: DAY, location_id: A, report_date: DATE, status: "open", format: "v2", created_by: KH, submitted_by: null, submitted_at: null, mvp_user_id: null, superseded_at: null }],
      pm_report_copies: [{ id: COPY, pm_report_id: DAY, location_id: A, author_id: KH, status: "open", observed_from: "2026-10-15T20:00:00Z", observed_to: null, created_at: "2026-10-15T20:00:00Z", sealed_at: null }],
      stations: [{ id: ST, location_id: A, active: true, sort: 1 }],
      station_positions: [{ id: P, station_id: ST, location_id: A, name: "Expeditor", name_es: null, sort: 1, active: true }],
      pm_criteria: [{ id: C, location_id: A, position_id: null, label: "Arrived ready", label_es: null, sort: 1, active: true }],
      station_events: [{ id: "e1", sequence: 1, location_id: A, business_date: DATE, user_id: EMP, station_id: ST, position_id: P, kind: "claim", at: "2026-10-15T18:00:00Z", source: "claimed", effective_at: null, reason_code: null }],
      pm_copy_positions: [], pm_copy_grades: [], pm_copy_notes: [],
    });
    const rpc = vi.fn(async (fn: string) => ({ data: fn === "open_pm_copy" ? { id: COPY, created: true } : fn === "submit_pm_day_v2" ? { changed: true, sealed: 1 } : { id: "x" }, error: null }));
    const service = { from: (t: string) => { const q = db.client.from(t) as unknown as Record<string, unknown> & { maybeSingle: () => unknown }; q.single = () => q.maybeSingle(); return q; }, rpc } as never;
    const actor = { userId: KH, role: "key_holder" as const, level: 4, locations: [A] };
    await v2.openMyCopy(service, { actor, locationId: A, date: DATE });
    await v2.saveGrade(service, { actor, locationId: A, copyId: COPY, subjectId: EMP, positionId: P, criterionId: C, grade: "great" });
    await v2.saveNote(service, { actor, locationId: A, copyId: COPY, subjectId: EMP, positionId: P, note: "solid night" });
    await v2.setWindow(service, { actor, locationId: A, copyId: COPY, from: "2026-10-15T20:00:00Z", to: "2026-10-16T01:00:00Z" });
    await v2.markDone(service, { actor, locationId: A, copyId: COPY });
    await v2.setMvpV2(service, { actor, locationId: A, date: DATE, mvpUserId: EMP, mvpNote: null });
    await v2.submitDay(service, { actor, locationId: A, date: DATE });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["open_pm_copy", "save_pm_copy_grade", "save_pm_copy_note", "set_pm_copy_window", "mark_pm_copy_done", "submit_pm_day_v2"]);
    expect(enqueueNotification).not.toHaveBeenCalled();
  });

  it("source scan: the PM v2 lib, the criteria lib, lib/people/** and lib/sevenshifts/** never import notifications or email", () => {
    const files: string[] = ["lib/pm-report-v2.ts", "lib/pm-report-v2-shared.ts", "lib/pm-criteria.ts"].filter((f) => existsSync(f));
    for (const dir of ["lib/people", "lib/sevenshifts"]) {
      for (const f of readdirSync(dir, { recursive: true, encoding: "utf8" })) if (/\.tsx?$/.test(f)) files.push(join(dir, f).split("\\").join("/"));
    }
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["']@\/lib\/(notifications|email)["']/);
      expect(src, f).not.toMatch(/\b(enqueueNotification|sendEmail)\s*\(/);
    }
  });
});
