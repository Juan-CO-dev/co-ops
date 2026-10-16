/**
 * Scheduling Phase 1, Task 20 — the PM v2 lib over the in-memory PostgREST fake (+ an RPC spy).
 *
 * - getOrCreatePmReport stamps `format` for a NEW day only (and reads nothing new while the switch is
 *   unavailable); an existing day keeps its format;
 * - v1 writers (eval, MVP, submit) refuse a v2 day `format_mismatch`;
 * - openMyCopy / loadMyCopy: the actor's OWN copy, other copies as COUNTS only; the roster, the criteria per
 *   position (the position's own first), only usable positions offered;
 * - the writers decide the lifecycle and the grade targets BEFORE the RPC, with the RPC's codes, and map every
 *   RPC refusal by name; audits carry no note text;
 * - loadDayResults: refused before submit and for a non-author KH; after submit the averages are weighted by
 *   observed minutes, write-ins attributed, themes pulled forward;
 * - loadMyFeedbackV2: bands from SUBMITTED v2 days, no author, no note text.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type Tables } from "./fixtures/counts-fake-db";

const state = vi.hoisted(() => ({ available: false, pmV2: false }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/assignments", () => ({ hasTaskAccess: vi.fn(async () => true), auditTaskOverride: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications", () => ({ enqueueNotification: vi.fn(async () => undefined), NOTIFICATION_TYPES: { SHIFT_FEEDBACK: "shift_feedback" } }));
vi.mock("@/lib/people/settings", () => ({
  get PM_V2_SWITCH_AVAILABLE() { return state.available; },
  loadPeopleShopSettings: vi.fn(async () => ({ pmV2: state.pmV2, prepPositionId: null })),
}));
const { audit } = await import("@/lib/audit");
const { loadPeopleShopSettings } = await import("@/lib/people/settings");
const { getOrCreatePmReport, saveEmployeeEval, setMvp, submitPmReport, PmReportError } = await import("@/lib/pm-report");
const v2 = await import("@/lib/pm-report-v2");
import { canReadPmDayResults, type PeopleActor } from "@/lib/people/access-shared";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KH = id(1), GM = id(2), SL = id(3), MOO = id(4), SMM = id(5), EMP = id(6), EMP2 = id(7), GM_B = id(8);
const ST = id(11), ST_OFF = id(12);
const P_EXPO = id(21), P_REG = id(22), P_OLD = id(23), P_OFF = id(24);
const C_SHARED = id(31), C_EXPO = id(32), C_REG = id(33);
const DAY = id(41), COPY_KH = id(42), COPY_GM = id(43), DAY_V1 = id(44);
const DATE = "2026-10-15";
const actor = (userId: string, role: PeopleActor["role"], level: number, locations = [A]): PeopleActor => ({ userId, role, level, locations });
const kh = actor(KH, "key_holder", 4), gm = actor(GM, "gm", 7), sl = actor(SL, "shift_lead", 5), moo = actor(MOO, "moo", 8, []);
const smm = actor(SMM, "social_media_mgr", 6), gmB = actor(GM_B, "gm", 7, [B]);

function tables(dayStatus: "open" | "submitted" = "open"): Tables {
  return {
    users: [
      { id: KH, name: "Kim", role: "key_holder", active: true }, { id: GM, name: "Alex", role: "gm", active: true },
      { id: SL, name: "Sol", role: "shift_lead", active: true }, { id: MOO, name: "Cris", role: "moo", active: true },
      { id: EMP, name: "Eli", role: "employee", active: true }, { id: EMP2, name: "Zoe", role: "employee", active: true },
    ],
    pm_reports: [
      { id: DAY, location_id: A, report_date: DATE, status: dayStatus, format: "v2", created_by: GM, submitted_by: dayStatus === "open" ? null : GM, submitted_at: dayStatus === "open" ? null : "2026-10-16T03:00:00Z", mvp_user_id: null, superseded_at: null },
      { id: DAY_V1, location_id: B, report_date: DATE, status: "open", format: "v1", created_by: GM_B, submitted_by: null, submitted_at: null, mvp_user_id: null, superseded_at: null },
    ],
    pm_report_copies: [
      { id: COPY_KH, pm_report_id: DAY, location_id: A, author_id: KH, status: dayStatus === "open" ? "open" : "sealed", observed_from: "2026-10-15T20:00:00Z", observed_to: "2026-10-15T21:00:00Z", created_at: "2026-10-15T20:00:00Z", sealed_at: null },
      { id: COPY_GM, pm_report_id: DAY, location_id: A, author_id: GM, status: dayStatus === "open" ? "done" : "sealed", observed_from: "2026-10-15T18:00:00Z", observed_to: "2026-10-15T21:00:00Z", created_at: "2026-10-15T18:00:00Z", sealed_at: null },
    ],
    stations: [{ id: ST, location_id: A, active: true, sort: 1 }, { id: ST_OFF, location_id: A, active: false, sort: 2 }],
    station_positions: [
      { id: P_EXPO, station_id: ST, location_id: A, name: "Expeditor", name_es: "Expedidor", sort: 1, active: true },
      { id: P_REG, station_id: ST, location_id: A, name: "Register & Delivery", name_es: "Caja y entregas", sort: 2, active: true },
      { id: P_OLD, station_id: ST, location_id: A, name: "Old", name_es: null, sort: 3, active: false },
      { id: P_OFF, station_id: ST_OFF, location_id: A, name: "Prep", name_es: "Prep", sort: 1, active: true },
    ],
    pm_criteria: [
      { id: C_SHARED, location_id: A, position_id: null, label: "Arrived ready", label_es: "Llegó listo", sort: 1, active: true },
      { id: C_EXPO, location_id: A, position_id: P_EXPO, label: "Ticket accuracy", label_es: "Precisión de tickets", sort: 1, active: true },
      { id: C_REG, location_id: A, position_id: P_REG, label: "Cash handling", label_es: "Manejo de efectivo", sort: 1, active: true },
    ],
    station_events: [
      { id: "e1", sequence: 1, location_id: A, business_date: DATE, user_id: EMP, station_id: ST, position_id: P_EXPO, kind: "claim", at: "2026-10-15T18:00:00Z", source: "claimed", effective_at: null, reason_code: null },
      { id: "e2", sequence: 2, location_id: A, business_date: DATE, user_id: EMP, station_id: null, position_id: null, kind: "release", at: "2026-10-15T22:00:00Z", source: null, effective_at: null, reason_code: null },
    ],
    pm_copy_grades: [
      { id: "g-kh", copy_id: COPY_KH, location_id: A, subject_id: EMP, position_id: P_EXPO, criterion_id: C_EXPO, grade: "great", superseded_at: null },
      { id: "g-gm", copy_id: COPY_GM, location_id: A, subject_id: EMP, position_id: P_EXPO, criterion_id: C_EXPO, grade: "good", superseded_at: null },
      { id: "g-gm-old", copy_id: COPY_GM, location_id: A, subject_id: EMP, position_id: P_EXPO, criterion_id: C_EXPO, grade: "needs_work", superseded_at: "2026-10-15T20:00:00Z" },
    ],
    pm_copy_notes: [
      { id: "n-kh", copy_id: COPY_KH, location_id: A, subject_id: EMP, position_id: P_EXPO, note: "slow on the slicer", superseded_at: null },
      { id: "n-gm", copy_id: COPY_GM, location_id: A, subject_id: EMP, position_id: P_EXPO, note: "PRIVATE-GM-NOTE slicer slow again", superseded_at: null },
    ],
    pm_copy_positions: [],
    pm_employee_evals: [],
    people_shop_settings: [],
  };
}

let db: ReturnType<typeof createFakeDb>;
const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({ data: { id: "rpc-id", created: true, changed: true, sealed: 2 } as unknown, error: null as null | { message: string } }));
function service() {
  return {
    from: (t: string) => { const q = db.client.from(t) as unknown as Record<string, unknown> & { maybeSingle: () => unknown }; q.single = () => q.maybeSingle(); return q; },
    rpc,
  } as never;
}
beforeEach(() => {
  db = createFakeDb(tables());
  rpc.mockClear();
  vi.mocked(audit).mockClear();
  state.available = false; state.pmV2 = false;
});

describe("getOrCreatePmReport stamps the format of a NEW day only", () => {
  it("switch unavailable: a new day is v1, inserted WITHOUT naming format, and people_shop_settings is never read", async () => {
    state.pmV2 = true;
    const r = await getOrCreatePmReport(service(), { locationId: A, date: "2026-10-16", actor: kh });
    expect(r.format).toBe("v1");
    expect(db.writes.find((w) => w.table === "pm_reports")!.rows[0]).not.toHaveProperty("format");
    expect(loadPeopleShopSettings).not.toHaveBeenCalled();
  });
  it("switch available and the shop on: a new day is v2", async () => {
    state.available = true; state.pmV2 = true;
    const r = await getOrCreatePmReport(service(), { locationId: A, date: "2026-10-16", actor: kh });
    expect(r.format).toBe("v2");
    expect(db.writes.find((w) => w.table === "pm_reports")!.rows[0]).toMatchObject({ format: "v2" });
  });
  it("an EXISTING day keeps its format whatever the switch says (switching mid-day never converts a day)", async () => {
    state.available = true; state.pmV2 = false;
    expect((await getOrCreatePmReport(service(), { locationId: A, date: DATE, actor: kh })).format).toBe("v2");
    state.pmV2 = true;
    expect((await getOrCreatePmReport(service(), { locationId: B, date: DATE, actor: gmB })).format).toBe("v1");
  });
});

describe("v1 writers refuse a v2 day", () => {
  it("eval, MVP and submit → 409 format_mismatch; nothing written; nothing notified", async () => {
    const base = { pmReportId: DAY, locationId: A, actor: kh };
    await expect(saveEmployeeEval(service(), { ...base, employeeId: EMP, arrivedReady: "good", attitude: "good", production: "good", teamPlayer: "good", areaToImprove: null, note: null }))
      .rejects.toMatchObject({ status: 409, code: "format_mismatch" });
    await expect(setMvp(service(), { ...base, mvpUserId: EMP, mvpNote: null })).rejects.toMatchObject({ status: 409, code: "format_mismatch" });
    await expect(submitPmReport(service(), base)).rejects.toMatchObject({ status: 409, code: "format_mismatch" });
    expect(db.writes).toHaveLength(0);
  });
});

describe("the actor's copy", () => {
  it("openMyCopy: the SMM and another shop's GM are refused BEFORE any I/O; a v1 day is format_mismatch", async () => {
    await expect(v2.openMyCopy(service(), { actor: smm, locationId: A, date: DATE })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    await expect(v2.openMyCopy(service(), { actor: gmB, locationId: A, date: DATE })).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(db.log).toHaveLength(0);
    await expect(v2.openMyCopy(service(), { actor: gmB, locationId: B, date: DATE })).rejects.toMatchObject({ status: 409, code: "format_mismatch" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("openMyCopy on a v2 day calls open_pm_copy and audits a created copy", async () => {
    rpc.mockResolvedValueOnce({ data: { id: COPY_KH, created: true }, error: null });
    expect(await v2.openMyCopy(service(), { actor: kh, locationId: A, date: DATE })).toEqual({ copyId: COPY_KH, reportId: DAY });
    expect(rpc).toHaveBeenCalledWith("open_pm_copy", { p_actor: KH, p_report: DAY });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "pm_report.copy_open", resourceId: COPY_KH });
  });
  it("loadMyCopy: the actor's own grades and notes; the other copy is a COUNT only (its grade and note never appear)", async () => {
    const view = await v2.loadMyCopy(service(), { actor: kh, locationId: A, date: DATE, presenceRoster: [{ id: EMP, name: "Eli" }, { id: EMP2, name: "Zoe" }], now: new Date("2026-10-16T03:00:00Z") });
    expect(view!.copy.id).toBe(COPY_KH);
    expect(view!.others).toEqual({ started: 1, done: 1 });
    const json = JSON.stringify(view);
    expect(json).not.toContain("PRIVATE-GM-NOTE");
    expect(json).not.toContain("g-gm");
    const eli = view!.people.find((p) => p.subjectId === EMP)!;
    expect(eli.positions.map((p) => [p.name, p.minutes])).toEqual([["Expeditor", 240]]);
    expect(eli.positions[0]!.criteria.map((c) => c.id)).toEqual([C_EXPO, C_SHARED]);
    expect(eli.positions[0]!.answers).toEqual([{ criterionId: C_EXPO, grade: "great" }]);
    expect(eli.positions[0]!.note).toBe("slow on the slicer");
    expect(view!.people.find((p) => p.subjectId === EMP2)!.positions).toEqual([expect.objectContaining({ positionId: null, criteria: [{ id: C_SHARED, label: "Arrived ready", labelEs: "Llegó listo" }] })]);
    expect(view!.availablePositions.map((p) => p.positionId)).toEqual([P_EXPO, P_REG]);
    expect(view!.summary).toEqual({ people: 2, rated: 1 });
    expect(view!.formState).toBe("editable");
  });
});

describe("the writers decide before the RPC, with the RPC's codes", () => {
  const grade = { locationId: A, subjectId: EMP, positionId: P_EXPO, criterionId: C_EXPO, grade: "good" };
  it("a done copy is read-only (copy_done); a non-author is not_copy_author; neither reaches the RPC", async () => {
    await expect(v2.saveGrade(service(), { ...grade, actor: gm, copyId: COPY_GM })).rejects.toMatchObject({ status: 409, code: "copy_done" });
    await expect(v2.saveGrade(service(), { ...grade, actor: gm, copyId: COPY_KH })).rejects.toMatchObject({ status: 403, code: "not_copy_author" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("r1 P1-1 in the lib: not worked → position_not_worked; a retired position → position_retired; an inactive station → position_retired; a foreign criterion → criterion_mismatch", async () => {
    await expect(v2.saveGrade(service(), { ...grade, actor: kh, copyId: COPY_KH, positionId: P_REG, criterionId: C_REG })).rejects.toMatchObject({ status: 422, code: "position_not_worked" });
    await expect(v2.saveGrade(service(), { ...grade, actor: kh, copyId: COPY_KH, positionId: P_OLD, criterionId: C_SHARED })).rejects.toMatchObject({ status: 422, code: "position_retired" });
    await expect(v2.saveGrade(service(), { ...grade, actor: kh, copyId: COPY_KH, positionId: P_OFF, criterionId: C_SHARED })).rejects.toMatchObject({ status: 422, code: "position_retired" });
    await expect(v2.saveGrade(service(), { ...grade, actor: kh, copyId: COPY_KH, criterionId: C_REG })).rejects.toMatchObject({ status: 422, code: "criterion_mismatch" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a valid grade reaches save_pm_copy_grade; an RPC refusal maps by name (the same code the lib would give)", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "g1" }, error: null });
    await v2.saveGrade(service(), { ...grade, actor: kh, copyId: COPY_KH });
    expect(rpc).toHaveBeenCalledWith("save_pm_copy_grade", { p_actor: KH, p_copy: COPY_KH, p_subject: EMP, p_position: P_EXPO, p_criterion: C_EXPO, p_grade: "good" });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "pm_report.copy_grade" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "position_retired" } });
    await expect(v2.saveGrade(service(), { ...grade, actor: kh, copyId: COPY_KH })).rejects.toMatchObject({ status: 422, code: "position_retired" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(v2.saveGrade(service(), { ...grade, actor: kh, copyId: COPY_KH })).rejects.toMatchObject({ status: 500, code: "write_failed" });
  });
  it("a note is audited WITHOUT its text; > 500 is invalid_note before the RPC", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "n1" }, error: null });
    await v2.saveNote(service(), { actor: kh, locationId: A, copyId: COPY_KH, subjectId: EMP, positionId: P_EXPO, note: "very private words" });
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("very private words");
    await expect(v2.saveNote(service(), { actor: kh, locationId: A, copyId: COPY_KH, subjectId: EMP, positionId: P_EXPO, note: "x".repeat(501) })).rejects.toMatchObject({ code: "invalid_note" });
  });
  it("addPosition: checks 5–6 only (a position not worked IS addable); an inactive station is refused; a reason is required", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "a1" }, error: null });
    await v2.addPosition(service(), { actor: kh, locationId: A, copyId: COPY_KH, subjectId: EMP, positionId: P_REG, reason: "covered lunch" });
    expect(rpc).toHaveBeenCalledWith("add_pm_copy_position", expect.objectContaining({ p_position: P_REG, p_reason: "covered lunch" }));
    await expect(v2.addPosition(service(), { actor: kh, locationId: A, copyId: COPY_KH, subjectId: EMP, positionId: P_OFF, reason: "x" })).rejects.toMatchObject({ code: "position_retired" });
    await expect(v2.addPosition(service(), { actor: kh, locationId: A, copyId: COPY_KH, subjectId: EMP, positionId: P_REG, reason: "  " })).rejects.toMatchObject({ code: "invalid_reason" });
  });
  it("markDone / reopen follow the ONE lifecycle; reopen on an open copy is copy_not_done", async () => {
    await expect(v2.reopenCopy(service(), { actor: kh, locationId: A, copyId: COPY_KH })).rejects.toMatchObject({ status: 409, code: "copy_not_done" });
    rpc.mockResolvedValueOnce({ data: { id: COPY_GM }, error: null });
    await v2.reopenCopy(service(), { actor: gm, locationId: A, copyId: COPY_GM });
    expect(rpc).toHaveBeenCalledWith("reopen_pm_copy", { p_actor: GM, p_copy: COPY_GM });
    rpc.mockResolvedValueOnce({ data: { id: COPY_KH }, error: null });
    await v2.markDone(service(), { actor: kh, locationId: A, copyId: COPY_KH });
    expect(rpc).toHaveBeenLastCalledWith("mark_pm_copy_done", { p_actor: KH, p_copy: COPY_KH });
  });
  it("submitDay: one RPC, audited submit_v2; a losing submit changes nothing and audits nothing", async () => {
    rpc.mockResolvedValueOnce({ data: { changed: true, sealed: 2 }, error: null });
    expect(await v2.submitDay(service(), { actor: sl, locationId: A, date: DATE })).toEqual({ changed: true, sealed: 2 });
    expect(vi.mocked(audit).mock.calls[0]![0]).toMatchObject({ action: "pm_report.submit_v2", resourceId: DAY });
    vi.mocked(audit).mockClear();
    rpc.mockResolvedValueOnce({ data: { changed: false }, error: null });
    expect(await v2.submitDay(service(), { actor: kh, locationId: A, date: DATE })).toEqual({ changed: false, sealed: 0 });
    expect(audit).not.toHaveBeenCalled();
    await expect(v2.submitDay(service(), { actor: smm, locationId: A, date: DATE })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("setMvpV2 is the guarded UPDATE bound to v2 (a submitted day refuses)", async () => {
    await v2.setMvpV2(service(), { actor: kh, locationId: A, date: DATE, mvpUserId: EMP, mvpNote: null });
    expect(db.client).toBeTruthy();
    db = createFakeDb(tables("submitted"));
    await expect(v2.setMvpV2(service(), { actor: kh, locationId: A, date: DATE, mvpUserId: EMP, mvpNote: null })).rejects.toMatchObject({ code: "report_already_submitted" });
  });
});

describe("after submit: the day's results", () => {
  it("refused while the day is open (blind), even for the GM and the MoO", async () => {
    await expect(v2.loadDayResults(service(), { actor: gm, locationId: A, date: DATE })).rejects.toMatchObject({ code: "forbidden" });
    await expect(v2.loadDayResults(service(), { actor: moo, locationId: A, date: DATE })).rejects.toMatchObject({ code: "forbidden" });
  });
  it("after submit: a non-author SL is refused (J9); the author KH and the GM read it", async () => {
    db = createFakeDb(tables("submitted"));
    await expect(v2.loadDayResults(service(), { actor: sl, locationId: A, date: DATE })).rejects.toMatchObject({ code: "forbidden" });
    expect(await v2.loadDayResults(service(), { actor: kh, locationId: A, date: DATE })).not.toBeNull();
  });
  it("the average is weighted by observed minutes; each manager's grade and minutes; write-ins attributed; themes pulled forward", async () => {
    db = createFakeDb(tables("submitted"));
    const r = await v2.loadDayResults(service(), { actor: gm, locationId: A, date: DATE });
    const expo = r!.people[0]!.positions.find((p) => p.positionId === P_EXPO)!;
    const cell = expo.cells.find((c) => c.criterionId === C_EXPO)!;
    // KH watched Eli 60 min (Great = 3), the GM 180 min (Good = 2): (60·3 + 180·2) / 240 = 2.25
    expect(cell.average).toBe(2.25);
    expect(cell.contributionsNamed).toEqual([{ authorName: "Kim", grade: "great", minutes: 60 }, { authorName: "Alex", grade: "good", minutes: 180 }]);
    expect(expo.summary).toEqual({ average: 2.25, managers: 2 });
    expect(expo.writeIns.map((w) => w.authorName).sort()).toEqual(["Alex", "Kim"]);
    expect(expo.themes.map((t) => t.term)).toEqual(["slicer", "slow"]);
    expect(r!.copies.map((c) => c.authorName)).toEqual(["Alex", "Kim"]);
    expect(r!.submittedByName).toBe("Alex");
  });
});

describe("loadMyFeedbackV2 — bands from submitted v2 days, no author, no note", () => {
  it("open days are hidden; a submitted day shows bands only", async () => {
    expect(await v2.loadMyFeedbackV2(service(), { userId: EMP })).toEqual([]);
    db = createFakeDb(tables("submitted"));
    const days = await v2.loadMyFeedbackV2(service(), { userId: EMP });
    expect(days).toEqual([{ date: DATE, locationId: A, positions: [{ positionId: P_EXPO, name: "Expeditor", nameEs: "Expedidor", criteria: [{ criterionId: C_EXPO, label: "Ticket accuracy", labelEs: "Precisión de tickets", band: "good" }] }] }]);
    const json = JSON.stringify(days);
    for (const leak of ["Kim", "Alex", "slicer", "PRIVATE", "2.25", "minutes"]) expect(json).not.toContain(leak);
  });
  it("before 0271 is applied (no pm_copy_grades table): []", async () => {
    const t = tables("submitted");
    delete t.pm_copy_grades;
    db = createFakeDb(t);
    expect(await v2.loadMyFeedbackV2(service(), { userId: EMP })).toEqual([]);
  });
});

describe("canReadPmDayResults", () => {
  const open = { locationId: A, status: "open" as const, authorIds: [KH] };
  const done = { ...open, status: "submitted" as const };
  it("blind until submit; then authors, GM / Op-6 of the shop, MoO+; never the SMM or a non-author SL", () => {
    expect([kh, gm, moo].map((a) => canReadPmDayResults(a, open))).toEqual([false, false, false]);
    expect([kh, gm, moo, actor(id(9), "agm", 6)].map((a) => canReadPmDayResults(a, done))).toEqual([true, true, true, true]);
    expect([sl, smm, gmB].map((a) => canReadPmDayResults(a, done))).toEqual([false, false, false]);
  });
});
void PmReportError;
