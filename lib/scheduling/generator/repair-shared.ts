/**
 * THE BOUNDED REPAIR SEARCH — deterministic, capped, before any non-proven gap is declared (Scheduling
 * Phase 2, Task 7; plan step 9a, r2 P1-1 widened in r3).
 *
 * For each remaining deficit (one head of one run), in canonical order (the closing window first, then
 * BOH, then the line, then the MoD lane, then the Closing Manager; then by slot):
 *   (0) PROVEN FIRST — `structure`, `eligibility` or `capacity` certifies it → declared at once, no search.
 *   (1) DIRECT INSERTION — any eligible free person (or an own-shift extension) for a ≥ minimum block
 *       touching the deficit, overtime allowed as the last resort.
 *   (2) REASSIGNMENT CHAINS (ejection chains) — move person P1 from their block B1 to the deficit, refill
 *       B1 with a free person, else with P2 from B2, … up to `maxChainDepth` = 3 links; donors in canonical
 *       order (lowest skill loss on the position they leave, then userId), ≤ `maxDonors` = 8 per link.
 *   (3) SEGMENT RELABEL — one segment of a person already on shift re-labelled onto the deficit's position
 *       where their own position does not need them (over-covered), when both are allowed.
 *   (4) ACCEPTANCE — a move is kept only when the day's uncovered total STRICTLY decreases, no
 *       error-class problem appears (the validator guard), and essential coverage (the closing window, MoD,
 *       the Closing Manager) is never reduced.
 *   (5) THE GLOBAL CAP — `REPAIR_MAX_STEPS` = 200 candidate moves (accepted or rejected) per week.
 * Exhausting the search is never a throw and never a proof: what is left is declared by `buildWeek` with
 * the first proven cause, else `unresolved_search` carrying these counters.
 */
import { REPAIR_LIMITS, SALARIED_FLEX_REASON, eligibleForPosition, isFlexSegment, proveGap, type GapCode, type GapSubject } from "../rules-shared";
import { isLineRole } from "../structure-shared";
import { reason } from "../reasons-shared";
import { skillOf } from "../people-input-shared";
import {
  allShifts, applyPlacement, budgetUsedHours, cmp, cloneShift, dayErrors, deficitAt, fillModHole, fillRun, guarded, modHoles, occupancy, planBlock, rankCandidates, uncoveredTotals,
  closingManagerAt, closingRequired, assignClosingManager, type BuildCtx, type GShift, type WeekState,
} from "./assign-shared";
import { templateOrder } from "./templates-shared";

export interface Deficit { code: GapCode; positionId: string | null; fromQ: number; toQ: number }

export interface RepairCounters {
  steps: number;
  donorsTried: number;
  chainDepth: number;
  accepted: number;
  /** Deficits proven without a search (structure / eligibility / capacity). */
  provenEarly: number;
}

export const newCounters = (): RepairCounters => ({ steps: 0, donorsTried: 0, chainDepth: 0, accepted: 0, provenEarly: 0 });

/** The day's open deficits in canonical order: closing-window coverage, BOH, line, MoD, Closing Manager; then by slot. */
export function deficitsOf(b: BuildCtx, date: string, shifts: readonly GShift[]): Deficit[] {
  const day = b.ctx.days[date]!;
  const s = day.structure;
  const { serviceCloseQ, prepStartQ } = s.shopDay;
  const out = day.scheduledOutQ;
  const runs = (positionId: string, test: (q: number) => boolean, lo = 0, hi = 96): Array<[number, number]> => {
    const r: Array<[number, number]> = [];
    for (let q = lo; q < hi; q++) {
      if (!test(q)) continue;
      const last = r[r.length - 1];
      if (last && last[1] === q) last[1] = q + 1;
      else r.push([q, q + 1]);
    }
    void positionId;
    return r;
  };
  const coverage: Array<Deficit & { group: number }> = [];
  for (const id of templateOrder(s)) {
    const pos = s.positions[id]!;
    for (const [fromQ, toQ] of runs(id, (q) => deficitAt(shifts, day, id, q) > 0)) {
      const closing = fromQ >= serviceCloseQ;
      const group = closing ? 0 : isLineRole(pos.role) ? 2 : 1;
      coverage.push({ code: "coverage_gap", positionId: id, fromQ, toQ, group });
    }
  }
  coverage.sort((x, y) => x.group - y.group || templateOrder(s).indexOf(x.positionId!) - templateOrder(s).indexOf(y.positionId!) || x.fromQ - y.fromQ);
  const list: Deficit[] = coverage.map(({ group, ...d }) => { void group; return d; });
  for (const [fromQ, toQ] of modHoles(b, date, shifts)) list.push({ code: "mod_missing", positionId: null, fromQ, toQ });
  if (closingRequired(day)) for (const [fromQ, toQ] of runs("", (q) => !closingManagerAt(b, shifts, q), serviceCloseQ, out)) list.push({ code: "closing_manager_missing", positionId: null, fromQ, toQ });
  void prepStartQ;
  return list;
}

function subjectOf(date: string, d: Deficit): GapSubject {
  return { code: d.code, date, positionId: d.positionId, fromQ: d.fromQ, toQ: d.toQ };
}

/** (0) The search-free proofs: structure, eligibility, capacity. */
export function provenEarly(b: BuildCtx, week: WeekState, date: string, d: Deficit): boolean {
  const s = { locationId: b.ctx.locationId, weekStart: b.ctx.weekStart, shifts: allShifts(week), gaps: [], days: [] };
  const proof = proveGap(subjectOf(date, d), s, b.ctx);
  return proof !== null && (proof.cause === "structure" || proof.cause === "eligibility" || proof.cause === "capacity");
}

interface SearchState { b: BuildCtx; week: WeekState; date: string; counters: RepairCounters }

const stepsLeft = (st: SearchState) => st.counters.steps < REPAIR_LIMITS.REPAIR_MAX_STEPS;
function step(st: SearchState): boolean {
  if (!stepsLeft(st)) return false;
  st.counters.steps++;
  return true;
}

/** (1) Direct insertion (one head), counted as one step per attempt kind. */
function tryInsert(st: SearchState, d: Deficit): boolean {
  if (!step(st)) return false;
  const { b, week, date } = st;
  if (d.code === "mod_missing") return fillModHole(b, week, date, d.fromQ, d.toQ);
  if (d.code === "closing_manager_missing") return tryClosingManager(st, d);
  const order = templateOrder(b.structure);
  const result = fillRun(b, week, date, d.positionId!, d.fromQ, d.toQ, { source: "shape", essential: d.fromQ >= b.structure.shopDay.serviceCloseQ, closingLead: false }, order, { allowCover: true, budgetStop: true });
  return result === "placed" || result === "covered";
}

/** A Closing Manager deficit: replace an ineligible closer on a line closing shift by an eligible free closer, or insert one. */
function tryClosingManager(st: SearchState, d: Deficit): boolean {
  const { b, week, date } = st;
  const day = b.ctx.days[date]!;
  const s = b.structure;
  const shifts = week.built[date]!;
  // Replace: an occupant of a line closing shift who cannot be the Closing Manager, by an eligible closer who fits that shift.
  const closingShifts = shifts.filter((sh) => !sh.pinned && sh.origin === "hourly" && sh.endQ >= day.scheduledOutQ && sh.startQ <= s.shopDay.serviceCloseQ
    && sh.segments.some((g) => { const pos = s.positions[g.positionId]; return !!pos && isLineRole(pos.role) && g.endQ > s.shopDay.serviceCloseQ; }));
  for (const sh of [...closingShifts].sort((x, y) => cmp(x.userId, y.userId))) {
    const occupant = b.people[sh.userId];
    if (!occupant) continue;
    const plan = { startQ: sh.startQ, endQ: sh.endQ, segments: sh.segments.map((g) => ({ positionId: g.positionId, startQ: g.startQ, endQ: g.endQ, kind: "core" as const })) };
    const without = shifts.filter((x) => x.userId !== sh.userId);
    for (const allowOvertime of [false, true]) {
      const ranked = rankCandidates(b, week, without, { date, plan, positionId: plan.segments[0]!.positionId, closingLead: true, allowOvertime, mod: false })
        .filter((c) => c.own === null);
      for (const c of ranked.slice(0, REPAIR_LIMITS.maxDonors)) {
        if (!step(st)) return false;
        st.counters.donorsTried = Math.max(st.counters.donorsTried, ranked.indexOf(c) + 1);
        const before = uncoveredTotals(b, date, week.built[date]!);
        const ok = guarded(b, week, date, (next) => {
          const idx = next.findIndex((x) => x.userId === sh.userId);
          if (idx < 0) return false;
          const old = next[idx]!;
          next.splice(idx, 1);
          applyPlacement(next, c, { date, plan, sourceReason: reason("repair_replaced", { userId: c.person.userId, replaced: sh.userId, fromQ: sh.startQ, toQ: sh.endQ }), closingLead: true }, b.people, plan.segments[0]!.positionId);
          const mine = next.find((x) => x.userId === c.person.userId)!;
          mine.closingManager = true;
          mine.segments = old.segments.map((g) => ({ ...g, reasons: [reason("repair_replaced", { userId: c.person.userId, replaced: sh.userId })] }));
          return true;
        }, (next) => { const after = uncoveredTotals(b, date, next); return after.total < before.total && after.essential <= before.essential; });
        if (ok) { st.counters.accepted++; return true; }
      }
    }
  }
  // Insert: an eligible closer on a line position needing heads in the closing window (the lead template).
  for (const id of templateOrder(s)) {
    const pos = s.positions[id];
    if (!pos || !isLineRole(pos.role)) continue;
    const need = day.need.positions[id];
    if (!need || !need.slice(s.shopDay.serviceCloseQ, day.scheduledOutQ).some((n) => n > 0)) continue;
    if (!step(st)) return false;
    const before = uncoveredTotals(b, date, week.built[date]!);
    const plan = planBlock(week.built[date]!, day, id, s.shopDay.serviceCloseQ, day.scheduledOutQ, s.limits.minimumShiftQ, templateOrder(s));
    if (!plan) continue;
    const ranked = rankCandidates(b, week, week.built[date]!, { date, plan, positionId: id, closingLead: true, allowOvertime: true, mod: false });
    for (const c of ranked.slice(0, 3)) {
      const ok = guarded(b, week, date, (next) => { applyPlacement(next, c, { date, plan, sourceReason: reason("closing_crew", { positionId: id, fromQ: plan.startQ, toQ: plan.endQ }), closingLead: true }, b.people, id); return true; },
        (next) => { assignClosingManagerOn(b, next, date); const after = uncoveredTotals(b, date, next); return after.total < before.total && after.essential <= before.essential; });
      if (ok) { assignClosingManager(b, week, date); st.counters.accepted++; return true; }
    }
  }
  return false;
}

/** Re-flag the Closing Manager on a candidate day (for an acceptance check). */
function assignClosingManagerOn(b: BuildCtx, shifts: GShift[], date: string): void {
  const saved = b.ctx; void saved;
  const temp: WeekState = { built: { [date]: shifts }, inherited: [] };
  const w = temp;
  // assignClosingManager mutates week.built[date] through the guard; mirror the result back.
  assignClosingManager(b, w, date);
  const result = w.built[date]!;
  for (let i = 0; i < shifts.length; i++) shifts[i]!.closingManager = result.find((x) => x.userId === shifts[i]!.userId)?.closingManager ?? false;
}

/** The deficits a removed shift leaves behind (runs where need now exceeds occupancy on its positions). */
function vacated(b: BuildCtx, date: string, shifts: readonly GShift[], removed: GShift): Deficit[] {
  const day = b.ctx.days[date]!;
  const out: Deficit[] = [];
  for (const g of removed.segments) {
    if (!b.structure.positions[g.positionId]) continue;
    let q = g.startQ;
    while (q < g.endQ) {
      if (deficitAt(shifts, day, g.positionId, q) <= 0) { q++; continue; }
      let stop = q + 1;
      while (stop < g.endQ && deficitAt(shifts, day, g.positionId, stop) > 0) stop++;
      out.push({ code: "coverage_gap", positionId: g.positionId, fromQ: q, toQ: stop });
      q = stop;
    }
  }
  return out;
}

/**
 * (2) One link of an ejection chain: donors are hourly people on shift that day whose shift could instead
 * cover the deficit; each donor is moved, the vacated runs are refilled by free people, and what remains
 * becomes the next link (depth + 1). Returns true when a chain closed the deficit and was accepted.
 */
function tryChain(st: SearchState, d: Deficit, depth: number, moved: ReadonlySet<string>): boolean {
  const { b, week, date } = st;
  if (depth > REPAIR_LIMITS.maxChainDepth) return false;
  st.counters.chainDepth = Math.max(st.counters.chainDepth, depth);
  const day = b.ctx.days[date]!;
  const s = b.structure;
  if (d.code !== "coverage_gap" || !d.positionId) return false;
  const pos = s.positions[d.positionId]!;
  const order = templateOrder(s);
  const baseline = uncoveredTotals(b, date, week.built[date]!);
  // Donors: hourly people on shift that day who could work the deficit's position (a flagged Closing Manager
  // may move too: the acceptance rule re-picks the Closing Manager and refuses any loss of essential coverage).
  const donors = week.built[date]!.filter((sh) => {
    const p = b.people[sh.userId];
    return !!p && !sh.pinned && sh.origin === "hourly" && !moved.has(sh.userId) && eligibleForPosition(p, pos);
  }).map((sh) => {
    const p = b.people[sh.userId]!;
    const leaving = sh.segments[0]!.positionId;
    return { sh, loss: skillOf(b.lookup, p, leaving, s.positions[leaving]).value };
  }).sort((x, y) => x.loss - y.loss || cmp(x.sh.userId, y.sh.userId)).slice(0, REPAIR_LIMITS.maxDonors);
  let tried = 0;
  for (const donor of donors) {
    if (!step(st)) return false;
    tried++;
    st.counters.donorsTried = Math.max(st.counters.donorsTried, tried);
    const snapshot = week.built[date]!.map(cloneShift);
    // Move the donor onto the deficit.
    const without = snapshot.filter((x) => x.userId !== donor.sh.userId);
    const plan = planBlock(without, day, d.positionId, d.fromQ, d.toQ, s.limits.minimumShiftQ, order);
    if (!plan) continue;
    // A donor move never creates overtime (overtime is an INSERTION's last resort, not a repair's).
    const ranked = rankCandidates(b, { built: { ...week.built, [date]: without }, inherited: week.inherited }, without, { date, plan, positionId: d.positionId, closingLead: false, allowOvertime: false, mod: false })
      .filter((c) => c.person.userId === donor.sh.userId && c.own === null);
    const c = ranked[0];
    if (!c) continue;
    const trial: WeekState = { built: { ...week.built, [date]: without }, inherited: week.inherited };
    // The donor move is UNGUARDED: a chain passes through transient states (a secondary without its primary until
    // the refill lands) and is judged atomically at the end against the day as it was before the chain.
    applyPlacement(trial.built[date]!, c, { date, plan, sourceReason: reason("repair_moved", { userId: c.person.userId, positionId: d.positionId, fromQ: d.fromQ, toQ: d.toQ, fromPositionId: donor.sh.segments[0]!.positionId }), closingLead: false }, b.people, d.positionId);
    // Refill what the donor left: a free insertion is itself a link (Tess → close, Sam → Tess's block, Leo → Sam's
    // block is a 3-link chain), so it is allowed only while depth + 1 fits the chain limit; then a deeper link.
    const sub: SearchState = { b, week: trial, date, counters: st.counters };
    let open = vacated(b, date, trial.built[date]!, donor.sh);
    if (depth + 1 <= REPAIR_LIMITS.maxChainDepth) {
      for (const v of open) {
        if (!stepsLeft(sub)) break;
        // The refill honours the budget stop like any insertion: a chain never spends what the budget refused.
        const r = fillRun(b, trial, date, v.positionId!, v.fromQ, v.toQ, { source: "shape", essential: v.fromQ >= s.shopDay.serviceCloseQ, closingLead: false }, order, { allowCover: true, budgetStop: true });
        st.counters.steps++;
        if (r === "placed" || r === "covered") st.counters.chainDepth = Math.max(st.counters.chainDepth, depth + 1);
      }
    }
    open = vacated(b, date, trial.built[date]!, donor.sh);
    if (open.length > 0 && depth < REPAIR_LIMITS.maxChainDepth) {
      for (const v of open) {
        if (!stepsLeft(sub)) break;
        tryChain(sub, v, depth + 1, new Set([...moved, donor.sh.userId]));
      }
    }
    // The Closing Manager is re-picked on the trial before essential coverage is judged; then the chain is accepted
    // only when the uncovered total strictly fell, essential coverage did not, and NO error-class problem is new
    // against the day as it was before the chain.
    assignClosingManager(b, trial, date);
    const after = uncoveredTotals(b, date, trial.built[date]!);
    // On a budgeted date the chain may not grow the non-essential hourly hours past the budget (a donor's new block can be longer).
    const budgetOk = !b.budgetedDates.includes(date) || budgetUsedHours(b, trial) <= Math.max(budgetUsedHours(b, week), b.budgetHours);
    if (after.total < baseline.total && after.essential <= baseline.essential && budgetOk) {
      const was = new Set(dayErrors(b, week, date, week.built[date]!));
      if (dayErrors(b, week, date, trial.built[date]!).every((k) => was.has(k))) {
        week.built[date] = trial.built[date]!;
        st.counters.accepted++;
        return true;
      }
    }
  }
  return false;
}

/**
 * (3) Relabel one segment of a person already on shift onto the deficit's position where their own
 * position is over-covered there (need ≤ occupancy − 1), when allowed; the uncovered total must fall.
 */
function tryRelabel(st: SearchState, d: Deficit): boolean {
  const { b, week, date } = st;
  if (d.code !== "coverage_gap" || !d.positionId) return false;
  const day = b.ctx.days[date]!;
  const s = b.structure;
  const pos = s.positions[d.positionId]!;
  const shifts = week.built[date]!;
  const baseline = uncoveredTotals(b, date, shifts);
  for (const sh of [...shifts].sort((x, y) => cmp(x.userId, y.userId))) {
    const p = b.people[sh.userId];
    if (!p || sh.pinned || !eligibleForPosition(p, pos)) continue;
    for (const g of sh.segments) {
      if (g.positionId === d.positionId || g.positionId === "mod") continue;
      const from = Math.max(g.startQ, d.fromQ);
      const to = Math.min(g.endQ, d.toQ);
      if (to <= from) continue;
      let spare = true;
      for (let q = from; q < to; q++) if (occupancy(shifts, g.positionId, q) - 1 < (day.need.positions[g.positionId]?.[q] ?? 0)) { spare = false; break; }
      if (!spare) continue;
      if (!step(st)) return false;
      const ok = guarded(b, week, date, (next) => {
        const mine = next.find((x) => x.userId === sh.userId)!;
        const parts: typeof mine.segments = [];
        for (const seg of mine.segments) {
          if (seg !== mine.segments.find((x) => x.startQ === g.startQ && x.positionId === g.positionId)) { parts.push(seg); continue; }
          if (seg.startQ < from) parts.push({ ...seg, endQ: from });
          // Astra chunk H P2-1: a relabel keeps the host's flex classification.
          parts.push({ positionId: d.positionId!, startQ: from, endQ: to, reasons: [reason("repair_relabelled", { positionId: d.positionId, fromPositionId: g.positionId, fromQ: from, toQ: to })], ...(isFlexSegment(seg) ? { reasonKey: SALARIED_FLEX_REASON } : {}) });
          if (to < seg.endQ) parts.push({ ...seg, startQ: to });
        }
        mine.segments = parts;
        return true;
      }, (next) => { const after = uncoveredTotals(b, date, next); return after.total < baseline.total && after.essential <= baseline.essential; });
      if (ok) { st.counters.accepted++; return true; }
    }
  }
  return false;
}

/**
 * The repair pass over one built day. Returns the deficits still open afterwards (each with whether it
 * was proven early). The counters are the week's.
 */
export function repairDay(b: BuildCtx, week: WeekState, date: string, counters: RepairCounters): void {
  const st: SearchState = { b, week, date, counters };
  const seen = new Set<string>();
  let guardLoops = 0;
  while (stepsLeft(st) && guardLoops++ < 64) {
    const open = deficitsOf(b, date, week.built[date]!).filter((d) => !seen.has(`${d.code}|${d.positionId}|${d.fromQ}|${d.toQ}`));
    const d = open[0];
    if (!d) break;
    const key = `${d.code}|${d.positionId}|${d.fromQ}|${d.toQ}`;
    if (provenEarly(b, week, date, d)) { counters.provenEarly++; seen.add(key); continue; }
    const before = uncoveredTotals(b, date, week.built[date]!).total;
    const done = tryInsert(st, d) || (stepsLeft(st) && tryChain(st, d, 1, new Set())) || (stepsLeft(st) && tryRelabel(st, d));
    const after = uncoveredTotals(b, date, week.built[date]!).total;
    if (!done || after >= before) seen.add(key);
  }
  assignClosingManager(b, week, date);
}
