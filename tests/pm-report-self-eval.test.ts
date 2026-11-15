/**
 * W09/B060 — PM v1: nobody evaluates themselves.
 *
 * - saveEmployeeEval refuses the actor's own id (403 self_evaluation) before any write, so a graded KH/SL can no
 *   longer supersede the manager's evaluation of them;
 * - setMvp refuses naming yourself;
 * - loadPmReportForEdit never returns the viewer's own eval (or the private note a manager wrote about them);
 * - the PM page drops the viewer from the presence roster and the add-picker.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined), NOTIFICATION_TYPES: { SHIFT_FEEDBACK: "shift_feedback" } }));
vi.mock("@/lib/people/settings", () => ({ PM_V2_SWITCH_AVAILABLE: false, loadPeopleShopSettings: vi.fn(async () => ({ pmV2: false, prepPositionId: null })) }));
const { saveEmployeeEval, setMvp, loadPmReportForEdit } = await import("@/lib/pm-report");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const GM = id(1), BO = id(2), EMP = id(3), DAY = id(10);
const DATE = "2026-11-14";
const gm = { userId: GM, role: "gm" as const, level: 7 };
const bo = { userId: BO, role: "key_holder" as const, level: 4 };

function tables(): Tables {
  return {
    users: [{ id: GM, name: "Ben", role: "gm", active: true }, { id: BO, name: "Bo", role: "key_holder", active: true }, { id: EMP, name: "Eli", role: "employee", active: true }],
    pm_reports: [{ id: DAY, location_id: A, report_date: DATE, status: "open", format: "v1", created_by: GM, submitted_by: null, submitted_at: null, mvp_user_id: null, mvp_note: null, superseded_at: null }],
    pm_employee_evals: [
      { id: "ev-gm-bo", pm_report_id: DAY, location_id: A, employee_id: BO, arrived_ready: "needs_work", attitude: "needs_work", production: "needs_work", team_player: "needs_work", area_to_improve: "punctuality", note: "late twice", author_id: GM, superseded_at: null },
      { id: "ev-gm-eli", pm_report_id: DAY, location_id: A, employee_id: EMP, arrived_ready: "good", attitude: "good", production: "good", team_player: "good", area_to_improve: null, note: "steady", author_id: GM, superseded_at: null },
    ],
    checklist_instances: [], checklist_completions: [],
  };
}

let db: ReturnType<typeof createFakeDb>;
let t: Tables;
const rpc = vi.fn(async () => ({ data: { id: "rpc-eval", superseded: 1 } as unknown, error: null as null | { message: string; code?: string } }));
function service() {
  return {
    from: (t: string) => { const q = db.client.from(t) as unknown as Record<string, unknown> & { maybeSingle: () => unknown }; q.single = () => q.maybeSingle(); return q; },
    rpc,
  } as never;
}
beforeEach(() => { t = tables(); db = createFakeDb(t); rpc.mockClear(); });

const grades = { arrivedReady: "great", attitude: "great", production: "great", teamPlayer: "great", areaToImprove: null, note: null } as const;

describe("B060 — no self-evaluation in v1", () => {
  it("saveEmployeeEval refuses the actor's own id with 403 self_evaluation and writes nothing", async () => {
    await expect(saveEmployeeEval(service(), { pmReportId: DAY, locationId: A, employeeId: BO, actor: bo, ...grades }))
      .rejects.toMatchObject({ status: 403, code: "self_evaluation" });
    expect(db.writes).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(t.pm_employee_evals!.find((e) => e.id === "ev-gm-bo")!.superseded_at).toBeNull();
  });
  it("setMvp refuses naming yourself; naming someone else still works", async () => {
    await expect(setMvp(service(), { pmReportId: DAY, locationId: A, mvpUserId: BO, mvpNote: null, actor: bo })).rejects.toMatchObject({ status: 403, code: "self_evaluation" });
    expect(db.writes).toHaveLength(0);
    await setMvp(service(), { pmReportId: DAY, locationId: A, mvpUserId: EMP, mvpNote: null, actor: bo });
    expect(t.pm_reports![0]!.mvp_user_id).toBe(EMP);
  });
  it("loadPmReportForEdit never returns the viewer's own eval or its note", async () => {
    const r = await loadPmReportForEdit(service(), { locationId: A, date: DATE, actor: bo });
    expect(r!.evals.some((e) => e.employeeId === BO)).toBe(false);
    expect(r!.evals.map((e) => e.employeeId)).toEqual([EMP]);
    expect(JSON.stringify(r)).not.toContain("late twice");
    expect(JSON.stringify(r)).not.toContain("punctuality");
    const asGm = await loadPmReportForEdit(service(), { locationId: A, date: DATE, actor: gm });
    expect(asGm!.evals.map((e) => e.employeeId).sort()).toEqual([BO, EMP].sort());
  });
  it("the PM page drops the viewer from the presence roster and the add-picker", () => {
    const page = readFileSync("app/(authed)/pm-report/page.tsx", "utf8");
    expect(page).toMatch(/locationUsers = \(\(candidates \?\? \[\]\) as \{ id: string; name: string \}\[\]\)\.filter\(\(u\) => u\.id !== auth\.user\.id\)/);
    expect(page).toMatch(/pmPresenceRoster\(board, new Set\(locationUsers\.map\(\(u\) => u\.id\)\)\)/);
  });
});
