/** Item 2 PR 2c: THE labor week builder, pure (no I/O, no clock, no env). Labor plan r6 (§3 P1 #2) on
 * r3's P1 #3 / #4 / #5. Input = one company payroll week (Sunday 00:00 ET, BOTH shops) as read by
 * lib/facts/labor-facts.ts; output = the rows 0338's fact_replace_labor_week writes.
 *
 *  - Punch -> minutes. A 7shifts punch maps to a shop through its LIVE location link; its break minutes
 *    are unpaid and come out of the middle of the punch (0268 keeps only the total, not where it fell).
 *    Instants round to the minute. An open punch adds no minutes and is counted, for its own source only
 *    (fix r1 P1), on EVERY day its possible span touches (fix r2 P1: LABOR_OPEN_PUNCH_SPAN_HOURS from
 *    clock-in, across the week boundary too): its hours are UNKNOWN, so a week holding one is never `assessed`.
 *  - The FRAME (fact_labor_week_days) is the only list of shop-days: each day is
 *    covered (7shifts ledger evidence) | pending_settle (inside the settle window) | fallback_unverified
 *    (Toast, when 7shifts is not covered and Toast has minutes) | incomplete. ONE source per shop-day, so
 *    7shifts and Toast are never summed.
 *  - The person: the CO-OPS user through a manual link (7shifts per shop, 0301; Toast per shop, 0233),
 *    else the account itself (`ss:<id>` / `toast:<guid>`): never matched by name.
 *  - Overtime is assigned per MINUTE, in instant order, company-wide, over hourly minutes only, BEFORE
 *    grouping, so a boundary inside a quarter lands on the right role. Salaried minutes are presence.
 *  - Rows: one per (shop, quarter, person, source, role), each with exactly one rate pick.
 * Money is never computed here. */
import { factQuarter } from "./order-facts-shared";
import { LABOR_OPEN_PUNCH_SPAN_HOURS, LABOR_OT_MULTIPLIER, LABOR_OT_THRESHOLD_MINUTES } from "./labor-config-shared";
import { pickWage, toWageVersion, type PayClass, type RateBasis, type WageVersion } from "./labor-wages-shared";

export interface FrameDay { location_id: string; business_date: string; linked: boolean; evidence_run_id: string | null; settled: boolean }
export interface SourcePunch {
  id: string; user_id: string; location_id: string | null; role_id: string | null; clocked_in: string; clocked_out: string | null;
  break_minutes: number | null; deleted: boolean;
}
export interface SourceToastEntry {
  location_id: string; time_entry_guid: string; employee_guid: string; user_id: string | null; in_at: string; out_at: string | null; deleted: boolean;
}
export interface LaborWeekSource {
  weekStart: string;
  /** the last day built (yesterday ET at most); null = nothing to build */
  builtThrough: string | null;
  floorDay: string;
  days: FrameDay[];
  locationLinks: { location_id: string; sevenshifts_location_id: string }[];
  userLinks: { sevenshifts_user_id: string; user_id: string; linked_at_location_id: string }[];
  toastLinks: { location_id: string; employee_guid: string; user_id: string }[];
  punches: SourcePunch[];
  toastEntries: SourceToastEntry[];
  wages: WageVersion[];
  laborSettings: { daily_ot_threshold: number | null; premium_ot_threshold: number | null; consecutive_days_threshold: number | null }[];
}
export type DayState = "covered" | "pending_settle" | "fallback_unverified" | "incomplete";
export type LaborSource = "7shifts" | "toast";
export interface LaborQuarterRow {
  location_id: string; quarter_start_at: string; person_key: string; source: LaborSource; role_key: string;
  wall_quarter: number; fold: number; business_date: string; week_start: string; user_id: string | null;
  minutes: number; ot_minutes: number; pay_class: PayClass; rate_cents: number | null; rate_basis: RateBasis; carry_back_rate_cents: number | null;
}
export interface LaborDayRow {
  location_id: string; business_date: string; week_start: string; state: DayState; source: LaborSource | null; evidence_run_id: string | null;
  ss_minutes: number; ss_people: number; toast_minutes: number; toast_people: number; open_punches: number;
}
export type OtState = "assessed" | "lower_bound" | "week_open";
export interface LaborWeekRow {
  week_start: string; built_through: string | null; ot_threshold_minutes: number; ot_multiplier: number; ot_state: OtState;
  ot_identity_partial: number; ot_settings_disagree: boolean;
}
export interface LaborSalariedRow { location_id: string; salaried_cents: number | null; salaried_people: number }
export interface LaborWeekPayload { quarters: LaborQuarterRow[]; days: LaborDayRow[]; week: LaborWeekRow; salaried: LaborSalariedRow[] }

const MINUTE = 60_000;
interface Minute { t: number; loc: string; date: string; source: LaborSource; person: string; ssUser: string | null; role: string }

/** The minutes of [in, out) minus a centred block of unpaid break minutes. */
function minutesOf(inIso: string, outIso: string, breakMinutes: number): number[] {
  const start = Math.round(Date.parse(inIso) / MINUTE) * MINUTE, end = Math.round(Date.parse(outIso) / MINUTE) * MINUTE;
  const n = Math.max(0, (end - start) / MINUTE);
  const b = Math.min(n, Math.max(0, breakMinutes));
  const cut = Math.floor((n - b) / 2);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (i < cut || i >= cut + b) out.push(start + i * MINUTE);
  return out;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildLaborWeek(src: LaborWeekSource): LaborWeekPayload {
  const builtFrom = src.weekStart > src.floorDay ? src.weekStart : src.floorDay;
  const inRange = (d: string) => src.builtThrough !== null && d >= builtFrom && d <= src.builtThrough;
  const frame = new Map(src.days.filter((d) => inRange(d.business_date)).map((d) => [`${d.location_id}|${d.business_date}`, d]));

  const shopOf7 = new Map(src.locationLinks.map((l) => [String(l.sevenshifts_location_id), l.location_id]));
  const personOf7 = new Map<string, string>();
  for (const l of [...src.userLinks].sort((a, b) => cmp(a.user_id, b.user_id))) if (!personOf7.has(String(l.sevenshifts_user_id))) personOf7.set(String(l.sevenshifts_user_id), l.user_id);
  const accountAt = new Map(src.userLinks.map((l) => [`${l.user_id}|${l.linked_at_location_id}`, String(l.sevenshifts_user_id)]));
  const toastPerson = new Map(src.toastLinks.map((l) => [`${l.location_id}|${l.employee_guid}`, l.user_id]));
  const wagesBy = new Map<string, WageVersion[]>();
  for (const w of src.wages) { const k = String(w.user_id); (wagesBy.get(k) ?? wagesBy.set(k, []).get(k)!).push(w); }

  // Quarter labels are computed once per quarter (Intl is the slow part).
  const quarterCache = new Map<number, ReturnType<typeof factQuarter>>();
  const quarterOf = (t: number) => {
    const q = Math.floor(t / (15 * MINUTE)) * 15 * MINUTE;
    let v = quarterCache.get(q);
    if (!v) { v = factQuarter(new Date(q).toISOString()); quarterCache.set(q, v); }
    return v;
  };

  const minutes: Minute[] = [];
  const open = { "7shifts": new Map<string, number>(), toast: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
  // Fix r2 P1: an open punch counts on EVERY frame day its possible span touches (LABOR_OPEN_PUNCH_SPAN_HOURS
  // from clock-in), not only its clock-in day: a Monday 23:00 open punch leaves Tuesday unknown too.
  const markOpen = (m: Map<string, number>, loc: string, inIso: string) => {
    const t0 = Date.parse(inIso);
    const last = quarterOf(t0 + LABOR_OPEN_PUNCH_SPAN_HOURS * 60 * MINUTE - MINUTE).et_date!;
    for (let d = quarterOf(t0).et_date!; d <= last; d = addDays(d, 1)) if (frame.has(`${loc}|${d}`)) bump(m, `${loc}|${d}`);
  };
  for (const p of src.punches) {
    if (p.deleted || p.location_id === null) continue;
    const loc = shopOf7.get(String(p.location_id));
    if (!loc) continue;
    if (p.clocked_out === null) { markOpen(open["7shifts"], loc, p.clocked_in); continue; }
    const ssUser = String(p.user_id);
    const linked = personOf7.get(ssUser);
    const person = linked ? `u:${linked}` : `ss:${ssUser}`;
    for (const t of minutesOf(p.clocked_in, p.clocked_out, p.break_minutes ?? 0)) {
      const date = quarterOf(t).et_date!;
      if (!frame.has(`${loc}|${date}`)) continue;
      minutes.push({ t, loc, date, source: "7shifts", person, ssUser, role: p.role_id === null ? "0" : String(p.role_id) });
    }
  }
  for (const e of src.toastEntries) {
    if (e.deleted) continue;
    if (e.out_at === null) { markOpen(open.toast, e.location_id, e.in_at); continue; }
    const user = toastPerson.get(`${e.location_id}|${e.employee_guid}`) ?? e.user_id;
    const person = user ? `u:${user}` : `toast:${e.employee_guid}`;
    const ssUser = user ? accountAt.get(`${user}|${e.location_id}`) ?? null : null;
    // Toast jobs have no 7shifts role mapping: role 0 (the pick falls to a null-role wage, then any).
    for (const t of minutesOf(e.in_at, e.out_at, 0)) {
      const date = quarterOf(t).et_date!;
      if (!frame.has(`${e.location_id}|${date}`)) continue;
      minutes.push({ t, loc: e.location_id, date, source: "toast", person, ssUser, role: "0" });
    }
  }

  // Day stats over BOTH sources, then the one source per shop-day.
  const stat = new Map<string, { ss: number; ssP: Set<string>; to: number; toP: Set<string> }>();
  for (const m of minutes) {
    const k = `${m.loc}|${m.date}`;
    const s = stat.get(k) ?? stat.set(k, { ss: 0, ssP: new Set(), to: 0, toP: new Set() }).get(k)!;
    if (m.source === "7shifts") { s.ss++; s.ssP.add(m.person); } else { s.to++; s.toP.add(m.person); }
  }
  const days: LaborDayRow[] = [];
  const chosen = new Map<string, LaborSource | null>();
  for (const [k, f] of [...frame.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const s = stat.get(k);
    const toast = (s?.to ?? 0) > 0;
    let state: DayState; let source: LaborSource | null;
    if (f.linked && f.evidence_run_id) { state = "covered"; source = "7shifts"; }
    else if (f.linked && !f.settled) { state = "pending_settle"; source = "7shifts"; }
    else if (toast) { state = "fallback_unverified"; source = "toast"; }
    else { state = "incomplete"; source = f.linked ? "7shifts" : null; }
    chosen.set(k, source);
    days.push({ location_id: f.location_id, business_date: f.business_date, week_start: src.weekStart, state, source,
      evidence_run_id: state === "covered" ? f.evidence_run_id : null, ss_minutes: s?.ss ?? 0, ss_people: s?.ssP.size ?? 0,
      toast_minutes: s?.to ?? 0, toast_people: s?.toP.size ?? 0,
      // The open punches of the day's ONE source (no source: both, its hours are unknown either way).
      open_punches: source === null ? (open["7shifts"].get(k) ?? 0) + (open.toast.get(k) ?? 0) : open[source].get(k) ?? 0 });
  }

  // The rate pick per (account, role, day), cached.
  const pickCache = new Map<string, ReturnType<typeof pickWage>>();
  const pickFor = (m: Minute) => {
    const k = `${m.ssUser ?? "-"}|${m.role}|${m.date}`;
    let v = pickCache.get(k);
    if (!v) { v = pickWage(m.ssUser ? wagesBy.get(m.ssUser) ?? [] : [], m.role, m.date); pickCache.set(k, v); }
    return v;
  };

  // Overtime per minute, in instant order, company-wide, hourly minutes only.
  const used = minutes.filter((m) => chosen.get(`${m.loc}|${m.date}`) === m.source)
    .sort((a, b) => a.t - b.t || cmp(a.person, b.person) || cmp(a.loc, b.loc) || cmp(a.role, b.role) || cmp(a.source, b.source));
  const worked = new Map<string, number>();
  const rows = new Map<string, LaborQuarterRow>();
  for (const m of used) {
    const pick = pickFor(m);
    let ot = 0;
    if (pick.payClass === "hourly") {
      const n = worked.get(m.person) ?? 0;
      worked.set(m.person, n + 1);
      if (n >= LABOR_OT_THRESHOLD_MINUTES) ot = 1;
    }
    const q = quarterOf(m.t);
    const key = `${m.loc}|${q.quarter_start_at}|${m.person}|${m.source}|${m.role}`;
    const rate_cents = pick.payClass === "hourly" && pick.rate ? pick.rate.wage_cents : null;
    const carry_back_rate_cents = pick.payClass === "hourly" && pick.carryBack ? pick.carryBack.wage_cents : null;
    const row = rows.get(key);
    if (row) {
      if (row.rate_cents !== rate_cents || row.rate_basis !== pick.basis || row.pay_class !== pick.payClass || row.carry_back_rate_cents !== carry_back_rate_cents) {
        throw new Error("labor_row_rate_conflict");
      }
      row.minutes++; row.ot_minutes += ot;
    } else {
      rows.set(key, { location_id: m.loc, quarter_start_at: q.quarter_start_at!, person_key: m.person, source: m.source, role_key: m.role,
        wall_quarter: q.wall_quarter!, fold: q.fold!, business_date: m.date, week_start: src.weekStart,
        user_id: m.person.startsWith("u:") ? m.person.slice(2) : null, minutes: 1, ot_minutes: ot, pay_class: pick.payClass,
        rate_cents, rate_basis: pick.basis, carry_back_rate_cents });
    }
  }
  const quarters = [...rows.values()].sort((a, b) => cmp(a.location_id, b.location_id) || cmp(a.quarter_start_at, b.quarter_start_at)
    || cmp(a.person_key, b.person_key) || cmp(a.source, b.source) || cmp(a.role_key, b.role_key));

  const weekEnd = addDays(src.weekStart, 6);
  const unlinked = new Set(used.filter((m) => !m.person.startsWith("u:")).map((m) => m.person));
  const ot_state: OtState = src.builtThrough === null || src.builtThrough < weekEnd ? "week_open"
    : src.weekStart < src.floorDay || days.some((d) => d.state !== "covered" || d.open_punches > 0) ? "lower_bound" : "assessed";
  const week: LaborWeekRow = {
    week_start: src.weekStart, built_through: src.builtThrough, ot_threshold_minutes: LABOR_OT_THRESHOLD_MINUTES, ot_multiplier: LABOR_OT_MULTIPLIER,
    ot_state, ot_identity_partial: unlinked.size,
    ot_settings_disagree: src.laborSettings.some((s) => [s.daily_ot_threshold, s.premium_ot_threshold, s.consecutive_days_threshold].some((v) => v !== null && Number(v) > 0)),
  };

  // Salaried weekly cost from 7shifts wages, per linked shop, as of the week start. One account linked
  // at both shops (the owner / ops case) is split equally; two accounts are two LLC payrolls.
  const linkedShops = [...new Set(src.days.filter((d) => d.linked).map((d) => d.location_id))].sort(cmp);
  const shopsOfAccount = new Map<string, number>();
  for (const l of src.userLinks) if (linkedShops.includes(l.linked_at_location_id)) bump(shopsOfAccount, String(l.sevenshifts_user_id));
  const salaried = linkedShops.map((loc) => {
    let cents = 0; let people = 0;
    for (const l of src.userLinks.filter((x) => x.linked_at_location_id === loc)) {
      const pick = pickWage(wagesBy.get(String(l.sevenshifts_user_id)) ?? [], "0", src.weekStart);
      const w = pick.rate ?? pick.carryBack;
      if (!w || pick.payClass !== "salaried") continue;
      const weekly = w.wage_type === "weekly_salary" ? w.wage_cents : Math.round(w.wage_cents / 52);
      cents += Math.round(weekly / (shopsOfAccount.get(String(l.sevenshifts_user_id)) ?? 1));
      people++;
    }
    return { location_id: loc, salaried_cents: people > 0 ? cents : null, salaried_people: people };
  });

  return { quarters, days, week, salaried };
}

/** 0338 fact_labor_week_source's JSON as a LaborWeekSource (ids as digit strings, instants as ISO), with
 * the fingerprint read in the same statement. */
export function laborWeekSourceFromJson(j: Record<string, unknown>): { source: LaborWeekSource; fingerprint: string } {
  const arr = (k: string) => (Array.isArray(j[k]) ? (j[k] as Record<string, unknown>[]) : []);
  const id = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const iso = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)).toISOString());
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  if (typeof j.fingerprint !== "string" || typeof j.week_start !== "string" || typeof j.floor_day !== "string") throw new Error("fact_source_read_failed");
  const source: LaborWeekSource = {
    weekStart: j.week_start, builtThrough: (j.built_through as string | null) ?? null, floorDay: j.floor_day,
    days: arr("days").map((d) => ({ location_id: String(d.location_id), business_date: String(d.business_date), linked: d.linked === true,
      evidence_run_id: id(d.evidence_run_id), settled: d.settled === true })),
    locationLinks: arr("location_links").map((l) => ({ location_id: String(l.location_id), sevenshifts_location_id: String(l.sevenshifts_location_id) })),
    userLinks: arr("user_links").map((l) => ({ sevenshifts_user_id: String(l.sevenshifts_user_id), user_id: String(l.user_id), linked_at_location_id: String(l.linked_at_location_id) })),
    toastLinks: arr("toast_links").map((l) => ({ location_id: String(l.location_id), employee_guid: String(l.employee_guid), user_id: String(l.user_id) })),
    punches: arr("punches").map((p) => ({ id: String(p.id), user_id: String(p.user_id), location_id: id(p.location_id), role_id: id(p.role_id),
      clocked_in: iso(p.clocked_in)!, clocked_out: iso(p.clocked_out), break_minutes: num(p.break_minutes), deleted: p.deleted === true })),
    toastEntries: arr("toast_entries").map((t) => ({ location_id: String(t.location_id), time_entry_guid: String(t.time_entry_guid),
      employee_guid: String(t.employee_guid), user_id: id(t.user_id), in_at: iso(t.in_at)!, out_at: iso(t.out_at), deleted: t.deleted === true })),
    wages: arr("wages").map(toWageVersion),
    laborSettings: arr("labor_settings").map((s) => ({ daily_ot_threshold: num(s.daily_ot_threshold), premium_ot_threshold: num(s.premium_ot_threshold),
      consecutive_days_threshold: num(s.consecutive_days_threshold) })),
  };
  return { source, fingerprint: j.fingerprint };
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
