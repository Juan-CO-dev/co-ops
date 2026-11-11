/**
 * The REAL-WORLD time-off and availability shapes (synthetic data, realistic 7shifts JSON), written
 * 2026-11-11 after the first prod sync rejected every row of both resources. Each entry is one row as
 * `GET /v2/time_off` / `GET /v2/company/{id}/availabilities` would list it, with PII planted on purpose:
 * comments, reasons, the approver and the status message must never reach the mirror.
 *
 * Shapes covered (the OAS types these fields as bare strings, so every spelling 7shifts' serializers
 * could use is here): bare `YYYY-MM-DD`, legacy `YYYY-MM-DD 00:00:00`, ISO midnight `…T00:00:00Z`,
 * wall times `H:MM` / `HH:MM` / `HH:MM:SS`, codes as integers and digit strings, flags as booleans and
 * 0 / 1, a zoneless UTC `modified`, a null day code.
 */
export const PLANTED = {
  comment: "PLANTED-TIME-OFF-COMMENT",
  reason: "PLANTED-DAY-REASON",
  statusMessage: "PLANTED-STATUS-MESSAGE",
  dayComment: "PLANTED-DAY-COMMENT",
} as const;

/** 0 pending · 1 approved · 2 declined (reference/listavailabilities `status`; time off uses the same codes). */
export const STATUS = { pending: 0, approved: 1, declined: 2 } as const;

const common = {
  company_id: 1234,
  comments: PLANTED.comment,
  status_action_user_id: null as number | null,
  status_action_message: PLANTED.statusMessage,
  category: "paid",
};

export const TIME_OFF_SHAPES = {
  /** One all-day day, dates spelled the legacy way, times `00:00:00`, approved. */
  allDayLegacy: {
    ...common, id: 5001, user_id: 501, from_date: "2026-11-20 00:00:00", to_date: "2026-11-20 00:00:00",
    partial: false, partial_from: "00:00:00", partial_to: "00:00:00", status: STATUS.approved, status_action_user_id: 9,
    created: "2026-11-01 14:02:11", amount_of_hours: 8, hours: [{ date: "2026-11-20", hours: 8 }],
  },
  /** Multi-day all-day, dates as ISO midnight instants, times null, pending. */
  multiDayIsoMidnight: {
    ...common, id: 5002, user_id: 502, from_date: "2026-12-24T00:00:00Z", to_date: "2026-12-27T00:00:00Z",
    partial: false, partial_from: null, partial_to: null, status: STATUS.pending, category: "unpaid",
    created: "2026-11-03T09:15:00Z", amount_of_hours: 0, hours: [
      { date: "2026-12-24", hours: 0 }, { date: "2026-12-25", hours: 0 }, { date: "2026-12-26", hours: 0 }, { date: "2026-12-27", hours: 0 },
    ],
  },
  /** Partial day, bare dates, `HH:MM:SS` times, declined; the total as a decimal STRING. */
  partialDay: {
    ...common, id: 5003, user_id: 503, from_date: "2026-11-22", to_date: "2026-11-22",
    partial: true, partial_from: "09:00:00", partial_to: "13:30:00", status: STATUS.declined, status_action_user_id: 9,
    created: "2026-11-02T18:40:00+00:00", amount_of_hours: "4.50", hours: [{ date: "2026-11-22", hours: 4.5 }],
  },
  /** Partial day with short wall times and 0/1 flags, status as a digit string, paid sick. */
  partialDayShortTimes: {
    ...common, id: 5004, user_id: 504, from_date: "2026-11-23", to_date: "2026-11-23",
    partial: 1, partial_from: "9:00", partial_to: "17:00", status: "1", category: "paid_sick",
    created: "2026-11-02 08:00:00", amount_of_hours: 8, hours: [{ date: "2026-11-23", hours: 8 }],
    // Undocumented on this resource; zoneless here, so it is NOT an instant and must land as null.
    modified: "2026-11-04 10:00:00",
  },
  /** Multi-day, partial flag 0, zoneless dates WITH a wall clock (the wall date is the date). */
  multiDayWallClock: {
    ...common, id: 5005, user_id: 505, from_date: "2026-11-28 09:00:00", to_date: "2026-11-29 17:00:00",
    partial: 0, partial_from: "00:00:00", partial_to: "00:00:00", status: STATUS.approved, status_action_user_id: 9,
    created: "2026-11-05 11:11:11", amount_of_hours: 16, hours: [{ date: "2026-11-28", hours: 8 }, { date: "2026-11-29", hours: 8 }],
    modified: "2026-11-06T12:00:00Z",
  },
} as const;

const day = (code: number | string | null, from: string | null, to: string | null, d: string) => ({
  [d]: code, [`${d}_from`]: from, [`${d}_to`]: to, [`${d}_comments`]: PLANTED.dayComment, [`${d}_reason`]: PLANTED.reason,
});
const week = (codes: Array<[number | string | null, string | null, string | null]>) =>
  Object.assign({}, ...(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d, i) => day(codes[i]![0], codes[i]![1], codes[i]![2], d)));

export const AVAILABILITY_SHAPES = {
  /** A repeating weekly set: `week` the start week (legacy spelling), `week_to` null, approved, UTC `modified` zoneless. */
  repeatingWeekly: {
    id: 6001, user_id: 501, company_id: 1234, week: "2026-01-05 00:00:00", week_to: null, repeat: true, status: STATUS.approved,
    status_action_user_id: 9, status_action_message: PLANTED.statusMessage,
    ...week([[1, "00:00:00", "00:00:00"], [2, "09:00:00", "15:00:00"], [0, "00:00:00", "00:00:00"], [2, "16:00:00", "23:00:00"], [1, "00:00:00", "00:00:00"], [0, "00:00:00", "00:00:00"], [0, "00:00:00", "00:00:00"]]),
    created: "2026-01-02 10:00:00", modified: "2026-10-30 16:45:12",
    old_approved_data: { mon_comments: PLANTED.dayComment, mon_reason: PLANTED.reason },
  },
  /** A one-off week: bare dates, `repeat` false, pending, ISO `modified`. */
  oneOffWeek: {
    id: 6002, user_id: 502, company_id: 1234, week: "2026-11-16", week_to: "2026-11-22", repeat: false, status: STATUS.pending,
    status_action_user_id: null, status_action_message: null,
    ...week([[0, "00:00:00", "00:00:00"], [2, "10:00:00", "14:00:00"], [1, "00:00:00", "00:00:00"], [0, "00:00:00", "00:00:00"], [0, "00:00:00", "00:00:00"], [1, "00:00:00", "00:00:00"], [2, "11:00:00", "16:00:00"]]),
    created: "2026-11-10T20:10:33.254Z", modified: "2026-11-10T20:10:33.254Z", old_approved_data: null,
  },
  /** A one-off week, ISO-midnight dates, flags as 0 / 1, short wall times, codes as digit strings, declined. */
  oneOffShortTimes: {
    id: 6003, user_id: 503, company_id: 1234, week: "2026-11-23T00:00:00Z", week_to: "2026-11-29T00:00:00Z", repeat: 0, status: "2",
    status_action_user_id: 9, status_action_message: PLANTED.statusMessage,
    ...week([["1", "0:00", "0:00"], ["2", "9:00", "15:00"], ["2", "09:30", "17:45"], ["0", "0:00", "0:00"], ["0", null, null], ["1", "", ""], ["2", "8:00:00", "12:00:00"]]),
    created: "2026-11-11 00:00:00", modified: null,
  },
  /** A repeating set with a day left unspecified (null code, null times) and `24:00:00` as an end. */
  repeatingSparse: {
    id: 6004, user_id: 504, company_id: 1234, week: "2025-06-02", week_to: null, repeat: 1, status: STATUS.approved,
    status_action_user_id: 9, status_action_message: PLANTED.statusMessage,
    ...week([[null, null, null], [2, "18:00:00", "24:00:00"], [1, "00:00:00", "00:00:00"], [1, "00:00:00", "00:00:00"], [2, "17:00:00", "23:59:59"], [0, "00:00:00", "00:00:00"], [0, "00:00:00", "00:00:00"]]),
    created: "2025-05-30 09:00:00", modified: "2025-05-30 09:00:00",
  },
} as const;
