/**
 * W09/B164 — a v1 evaluation is written ONLY through save_pm_employee_eval (0309): the day-row lock, the
 * open / v1 / not-self checks and the supersede + insert in ONE transaction, so two concurrent saves can no
 * longer leave two live evaluations and a save can no longer land after submit. NO fallback (the 0278 / 0279
 * precedent): 0309 reaches prod before this merges; a missing function is a named 503, never a two-call write.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined), NOTIFICATION_TYPES: { SHIFT_FEEDBACK: "shift_feedback" } }));
vi.mock("@/lib/people/settings", () => ({ PM_V2_SWITCH_AVAILABLE: false, loadPeopleShopSettings: vi.fn(async () => ({ pmV2: false, prepPositionId: null })) }));
const { saveEmployeeEval } = await import("@/lib/pm-report");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GM = "00000000-0000-4000-8000-000000000001", EMP = "00000000-0000-4000-8000-000000000003", DAY = "00000000-0000-4000-8000-000000000010";
const gm = { userId: GM, role: "gm" as const, level: 7 };
const tables = (): Tables => ({
  pm_reports: [{ id: DAY, location_id: A, report_date: "2026-11-14", status: "open", format: "v1", superseded_at: null }],
  pm_employee_evals: [],
});
let db: ReturnType<typeof createFakeDb>;
const rpc = vi.fn();
const service = () => ({ from: db.client.from.bind(db.client), rpc }) as never;
const args = { pmReportId: DAY, locationId: A, employeeId: EMP, actor: gm, arrivedReady: "great", attitude: "good", production: "good", teamPlayer: "needs_work", areaToImprove: "pace", note: "steady" } as const;

beforeEach(() => { db = createFakeDb(tables()); rpc.mockReset(); });

describe("B164 — saveEmployeeEval writes only through save_pm_employee_eval", () => {
  it("one RPC call with the whole evaluation; no direct table write", async () => {
    rpc.mockResolvedValue({ data: { id: "ev-new", superseded: 1 }, error: null });
    expect(await saveEmployeeEval(service(), args)).toEqual({ id: "ev-new" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_pm_employee_eval", {
      p_actor: GM, p_report: DAY, p_location: A, p_employee: EMP, p_arrived_ready: "great", p_attitude: "good",
      p_production: "good", p_team_player: "needs_work", p_area: "pace", p_note: "steady",
    });
    expect(db.writes.filter((w) => w.table === "pm_employee_evals")).toHaveLength(0);
  });
  it("the source keeps no direct pm_employee_evals write in lib/pm-report.ts", () => {
    const src = readFileSync("lib/pm-report.ts", "utf8");
    expect(src).not.toMatch(/from\("pm_employee_evals"\)\s*\.(update|insert)\(/);
    expect(src).toContain('service.rpc("save_pm_employee_eval"');
  });
  it.each([
    ["not_found", 404], ["report_already_submitted", 409], ["format_mismatch", 409], ["self_evaluation", 403],
    ["forbidden", 403], ["invalid_target", 400], ["invalid_payload", 400],
  ] as const)("the RPC refusal %s maps by name to %i", async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { message: code, code: "P0001" } });
    await expect(saveEmployeeEval(service(), args)).rejects.toMatchObject({ status, code });
  });
  it("0309 not applied: a named 503, never a fallback write", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function public.save_pm_employee_eval", code: "PGRST202" } });
    await expect(saveEmployeeEval(service(), args)).rejects.toMatchObject({ status: 503, code: "pm_eval_unavailable" });
    expect(db.writes).toHaveLength(0);
  });
  it("any other database error is a plain error (a 500 at the route)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } });
    await expect(saveEmployeeEval(service(), args)).rejects.toThrow(/saveEmployeeEval/);
  });
});
