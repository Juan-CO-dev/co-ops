/**
 * W09/B062 — a past PM v2 day in the reports hub shows its evaluations.
 *
 * A v2 day writes manager copies (pm_copy_grades / pm_copy_notes), never pm_employee_evals, so the hub's
 * detail showed the header and MVP with an empty list. Now, on a v2 day:
 * - an L4+ reader gets the day's results through `loadDayResults` (the SAME J9 gate as /pm-report, with the
 *   B016/B058 fixes), and a refusal (`forbidden`) is the header with no results, never an error;
 * - a viewer below KH gets their OWN bands for that day (owner decision W09-5 b), never another person's,
 *   or nothing when they were not graded;
 * - a v1 day is unchanged and never calls the v2 reader.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

const v2 = vi.hoisted(() => ({ loadDayResults: vi.fn(), loadMyFeedbackV2: vi.fn() }));
vi.mock("@/lib/pm-report-v2", () => v2);
vi.mock("@/lib/midshift", () => ({ loadReportStatuses: vi.fn(async () => ({ rows: [] })) }));
vi.mock("@/lib/pm-report", async (orig) => ({ ...(await orig<typeof import("@/lib/pm-report")>()), loadShiftWrapUp: vi.fn(async () => []) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
const { loadReportDetail } = await import("@/lib/reports-hub");
const { PmReportError } = await import("@/lib/pm-report");
import type { PeopleActor } from "@/lib/people/access-shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const { PmReportDetailView } = await import("@/components/reports-hub/PmReportDetail");

const SHOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GM = "00000000-0000-4000-8000-000000000001", KH = "00000000-0000-4000-8000-000000000002", EMP = "00000000-0000-4000-8000-000000000003";
const DAY_V2 = "00000000-0000-4000-8000-000000000010", DAY_V1 = "00000000-0000-4000-8000-000000000011";
const DATE = "2026-11-10";

function tables(): Tables {
  return {
    users: [{ id: GM, name: "Alex" }, { id: KH, name: "Kim" }, { id: EMP, name: "Eli" }],
    pm_reports: [
      { id: DAY_V2, location_id: SHOP, report_date: DATE, status: "submitted", format: "v2", mvp_user_id: null, mvp_note: null, submitted_at: "2026-11-11T03:00:00Z", submitted_by: GM, superseded_at: null },
      { id: DAY_V1, location_id: SHOP, report_date: "2026-11-09", status: "submitted", format: "v1", mvp_user_id: null, mvp_note: null, submitted_at: "2026-11-10T03:00:00Z", submitted_by: GM, superseded_at: null },
    ],
    pm_employee_evals: [
      { id: "ev1", pm_report_id: DAY_V1, location_id: SHOP, employee_id: EMP, arrived_ready: "good", attitude: "good", production: "good", team_player: "good", area_to_improve: null, note: "v1 note", superseded_at: null },
    ],
  };
}
let db: ReturnType<typeof createFakeDb>;
const sb = () => db.client as never;
const gmViewer = { userId: GM, level: 7, locations: [SHOP] };
const gmActor: PeopleActor = { userId: GM, role: "gm", level: 7, locations: [SHOP] };
const RESULTS = { reportId: DAY_V2, date: DATE, locationId: SHOP, submittedByName: "Alex", submittedAt: null, copies: [], people: [] };

beforeEach(() => {
  db = createFakeDb(tables());
  v2.loadDayResults.mockReset().mockResolvedValue(RESULTS);
  v2.loadMyFeedbackV2.mockReset().mockResolvedValue([]);
});

describe("B062 — past PM v2 days in the reports hub", () => {
  it("a submitted v2 PM day loads the day's results for a reader", async () => {
    const d = await loadReportDetail(sb(), { viewer: gmViewer, pmActor: gmActor, type: "pm", id: DAY_V2, locationId: SHOP });
    if (d?.kind !== "pm") throw new Error("not pm");
    expect(v2.loadDayResults).toHaveBeenCalledWith(expect.anything(), { actor: gmActor, locationId: SHOP, date: DATE });
    expect(d.format).toBe("v2");
    expect(d.v2Results).toBe(RESULTS);
    expect(d.evals).toEqual([]);
  });
  it("a non-author KH gets the header and no results", async () => {
    v2.loadDayResults.mockRejectedValue(new PmReportError(403, "forbidden"));
    const kh = { userId: KH, level: 4, locations: [SHOP] };
    const d = await loadReportDetail(sb(), { viewer: kh, pmActor: { ...kh, role: "key_holder" }, type: "pm", id: DAY_V2, locationId: SHOP });
    if (d?.kind !== "pm") throw new Error("not pm");
    expect(d.v2Results).toBeNull();
    expect(d.evals).toEqual([]);
    expect(d.submittedByName).toBe("Alex");
  });
  it("without a trusted actor a v2 day never guesses a role: no results", async () => {
    const d = await loadReportDetail(sb(), { viewer: gmViewer, type: "pm", id: DAY_V2, locationId: SHOP });
    if (d?.kind !== "pm") throw new Error("not pm");
    expect(d.v2Results).toBeNull();
    expect(v2.loadDayResults).not.toHaveBeenCalled();
  });
  it("a level-3 viewer gets only their own bands for that day (W09-5 b), never the day's results", async () => {
    const band = { date: DATE, locationId: SHOP, positions: [{ positionId: null, name: null, nameEs: null, criteria: [{ criterionId: "c", label: "Arrived ready", labelEs: null, band: "good" }] }] };
    v2.loadMyFeedbackV2.mockResolvedValue([band]);
    const emp = { userId: EMP, level: 3, locations: [SHOP] };
    const d = await loadReportDetail(sb(), { viewer: emp, pmActor: { ...emp, role: "employee" }, type: "pm", id: DAY_V2, locationId: SHOP });
    if (d?.kind !== "pm") throw new Error("not pm");
    expect(v2.loadMyFeedbackV2).toHaveBeenCalledWith(expect.anything(), { userId: EMP, only: { locationId: SHOP, date: DATE } });
    expect(v2.loadDayResults).not.toHaveBeenCalled();
    expect(d.v2OwnBands).toEqual(band);
    expect(d.v2Results).toBeNull();
  });
  it("a level-3 viewer who was not graded that day gets nothing", async () => {
    const emp = { userId: EMP, level: 3, locations: [SHOP] };
    expect(await loadReportDetail(sb(), { viewer: emp, type: "pm", id: DAY_V2, locationId: SHOP })).toBeNull();
  });
  it("a v1 day is unchanged", async () => {
    const d = await loadReportDetail(sb(), { viewer: gmViewer, pmActor: gmActor, type: "pm", id: DAY_V1, locationId: SHOP });
    if (d?.kind !== "pm") throw new Error("not pm");
    expect(d.format).toBe("v1");
    expect(d.evals.map((e) => e.note)).toEqual(["v1 note"]);
    expect(d.v2Results).toBeNull();
    expect(v2.loadDayResults).not.toHaveBeenCalled();
  });
  it("the detail view shows the plain no-access line for a v2 day without results, and no v1 tally", async () => {
    v2.loadDayResults.mockRejectedValue(new PmReportError(403, "forbidden"));
    const d = await loadReportDetail(sb(), { viewer: gmViewer, pmActor: gmActor, type: "pm", id: DAY_V2, locationId: SHOP });
    if (d?.kind !== "pm") throw new Error("not pm");
    const html = renderToStaticMarkup(createElement(PmReportDetailView, { detail: d, language: "en" }));
    expect(html).toContain("Its results are for the day");
  });
});
