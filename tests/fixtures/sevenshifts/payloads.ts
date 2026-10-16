/**
 * Realistic 7shifts payload rows, one per resource, in the shapes the docs show (re-read 2026-10-15
 * where noted in lib/sevenshifts/endpoints-shared.ts; the rest per the plan's API facts). Used by the
 * real-upsert test (Task 5 Step 6b) and the sync tests (Task 7). PII is planted on purpose: the
 * normalizer must drop it.
 */
import docExample from "./assignments-doc-example.json";

export const ASSIGNMENTS_DOC_EXAMPLE = docExample;

export const PAYLOAD = {
  locations: { id: 4569, company_id: 1234, name: "Restaurant", timezone: "America/New_York", active: true, address: "1 Planted St" },
  departments: { id: 7890, company_id: 1234, location_id: 4569, name: "FOH" },
  roles: { id: 2583, company_id: 1234, location_id: 4569, department_id: 7890, name: "Host", active: true, sort: 0 },
  users: {
    id: 501, company_id: 1234, first_name: "Ana", last_name: "Ruiz", preferred_first_name: "Anita", employee_id: "EMP-12",
    email: "planted@example.test", mobile_number: "+12025550199", birth_date: "1990-01-31", punch_id: "4471",
    type: "employee", active: true, hire_date: "2026-09-01", skill_level: 3, hourly_wage: 1999, modified: "2026-10-14T15:00:00+00:00",
  },
  availabilities: {
    id: 3001, user_id: 501, company_id: 1234, week: "2026-10-12", week_to: null, repeat: true, status: 1,
    mon: 1, mon_from: "00:00:00", mon_to: "00:00:00", mon_comments: "planted", tue: 2, tue_from: "09:00:00", tue_to: "15:00:00",
    wed: 0, wed_from: null, wed_to: null, thu: 0, thu_from: null, thu_to: null, fri: 0, fri_from: null, fri_to: null,
    sat: 0, sat_from: null, sat_to: null, sun: 0, sun_from: null, sun_to: null, modified: "2026-10-02T00:00:00Z",
  },
  time_off: {
    id: 4001, user_id: 501, company_id: 1234, from_date: "2026-10-20", to_date: "2026-10-21", partial: true,
    partial_from: "09:00:00", partial_to: "13:00:00", comments: "planted", status: 1, status_action_user_id: null,
    status_action_message: "planted", category: "paid", created: "2026-10-01T00:00:00Z", amount_of_hours: 4,
    hours: [{ date: "2026-10-20", hours: 4 }],
  },
  shifts: {
    id: 9001, user_id: 501, location_id: 4569, department_id: 7890, role_id: 2583, station_id: 77, station_name: "Grill",
    start: "2026-10-14T14:00:00-04:00", end: "2026-10-14T20:00:00-04:00", draft: false, open: false, deleted: false,
    notes: "planted", hourly_wage: 1999, modified: "2026-10-13T12:00:00Z",
  },
  time_punches: {
    id: 7001, company_id: 1234, user_id: 501, location_id: 4569, department_id: 7890, role_id: 2583, shift_id: 9001,
    clocked_in: "2026-10-14T13:58:00+00:00", clocked_out: "2026-10-14T20:03:00+00:00", approved: true, auto_clocked_out: false,
    deleted: false, hourly_wage: 1999, tips: 777, notes: "planted", modified: "2026-10-14T20:05:00+00:00",
    breaks: [{ id: 1, user_id: 501, custom_break_id: 0, in: "2026-10-14T17:00:00Z", out: "2026-10-14T17:30:00Z", paid: false, deleted: false }],
  },
  labor_settings: {
    company_id: 1234, consecutive_days_threshold: 7, consecutive_days_multiplier: 1.5, overtime_enabled: true,
    daily_overtime_threshold: 8, daily_overtime_multiplier: 1.5, weekly_overtime_threshold: 40, weekly_overtime_multiplier: 1.5,
    premium_overtime_threshold: 12, premium_overtime_multiplier: 2, overtime_by_location_enabled: false, jurisdiction: "california",
  },
  wages: {
    data: {
      current_wages: [{ id: 61, effective_date: "2026-09-01", role_id: 2583, wage_type: "hourly", wage_cents: 1650 }],
      upcoming_wages: [{ id: 62, effective_date: "2026-11-01", role_id: null, wage_type: "hourly", wage_cents: 1700 }],
    },
  },
} as const;
