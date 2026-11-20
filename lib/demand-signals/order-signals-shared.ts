/**
 * Demand signals (item 4 PR 6, first half): SIGNALS ON THE ORDER WALK, pure. No I/O, no clock.
 *
 * WHAT THE WALK SHOWS: the signals for the days this order looks ahead to, BY NAME (an event, the forecast of a
 * day that has one), each with the direction a person entered, and ONE sentence about a number: there is none,
 * and why. A SIGNAL ADJUSTS THAT DAY'S ORDER ONLY: the person reads it and changes a line by hand, on this walk.
 * Nothing here prefills a line, and NOTHING HERE CAN CHANGE A STANDING PAR (the signal layer has no par writer;
 * a standing-par mechanism is its own later PR on Dynamic Pars, see the notes).
 *
 * THE GATE A NUMBER MUST PASS (`orderNudgeFor`), written now so the number cannot arrive by a side door:
 *   1. an APPROVAL exists for exactly this model, target (par ounces), lead and shop (MoO+, a later PR's writer);
 *   2. its evidence is E2 (`evidenceAllows(..., "actionable")`): E0 hindsight and E1 retrospective unlock nothing;
 *   3. the qualification it names AUTHORIZES this exact use (`authorizes`);
 *   4. every source behind the signal is verified NOW (`usableNow`, the register read for this render);
 *   5. a persisted TERM of that model exists for the date, and its multiplier is inside the composition bounds
 *      (`composeSignals` clamps; a multiplier that clamps to 1 is no nudge).
 * Any miss is `named_only` with its reason. TODAY EVERY CALL IS `no_approved_signal`: no approval writer and no
 * term producer exist yet, and this module is not given a way to make one up. The walk renders the reason.
 */
import { composeSignals } from "./candidates-shared";
import type { SignalUseRefusal } from "./contracts-shared";
import { evidenceAllows, type EvidenceClass } from "./evidence-shared";
import { authorizes, type DemandTarget, type QualifiedScope } from "./scoring-shared";
import { usableNow, type SourceState } from "./sources-shared";
import type { EventIn, SignalsDay } from "./signals-view-shared";

/** The walk's own look-ahead for named events (lib/ordering.ts EVENT_ADVISORY_HORIZON_DAYS): days AFTER the walk date. */
export const ORDER_SIGNALS_HORIZON_DAYS = 14;
/** The one target an order nudge may speak for. */
export const ORDER_NUDGE_TARGET: DemandTarget = "par_product_day_oz";

export interface ApprovedSignal {
  modelHash: string; target: DemandTarget; leadDays: number; shopId: string;
  evidenceClass: EvidenceClass; qualified: QualifiedScope | null; sourceIds: ReadonlyArray<string>;
}
export interface SignalTerm { modelHash: string; validDate: string; multiplier: number; sourceIds: ReadonlyArray<string> }

export type OrderNudgeRefusal = "no_approved_signal" | "wrong_target" | "evidence_not_point_in_time" | "not_authorized_for_scope"
  | SignalUseRefusal | "no_term_for_date" | "no_effect";
export type OrderNudge =
  | { kind: "named_only"; reason: OrderNudgeRefusal }
  | { kind: "number"; multiplier: number; modelHash: string; sourceIds: string[] };

const refuse = (reason: OrderNudgeRefusal): OrderNudge => ({ kind: "named_only", reason });

/** May the walk show a NUMBER for this shop and date, and which? Every miss is a named refusal. */
export function orderNudgeFor(args: {
  approved: ApprovedSignal | null; term: SignalTerm | null; shopId: string; validDate: string; leadDays: number;
  states: ReadonlyArray<SourceState>; velocityRatio: number;
}): OrderNudge {
  const { approved, term } = args;
  if (approved === null) return refuse("no_approved_signal");
  if (approved.target !== ORDER_NUDGE_TARGET) return refuse("wrong_target");
  if (!evidenceAllows(approved.evidenceClass, "actionable")) return refuse("evidence_not_point_in_time");
  if (approved.shopId !== args.shopId || approved.leadDays !== args.leadDays
    || !authorizes(approved.qualified, { modelHash: approved.modelHash, target: approved.target, leadDays: args.leadDays, shopId: args.shopId })) {
    return refuse("not_authorized_for_scope");
  }
  const sourceIds = [...new Set([...approved.sourceIds, ...(term?.sourceIds ?? [])])].sort();
  const use = usableNow(args.states, sourceIds, "render");
  if (!use.ok) return refuse(use.code);
  if (term === null || term.modelHash !== approved.modelHash || term.validDate !== args.validDate) return refuse("no_term_for_date");
  const multiplier = composeSignals([term.multiplier], args.velocityRatio);
  if (multiplier === 1) return refuse("no_effect");
  return { kind: "number", multiplier, modelHash: approved.modelHash, sourceIds };
}

export interface OrderSignalDay {
  date: string;
  /** Events in force that day (ids into `events`). */
  eventIds: string[];
  /** The forecast line for the day, when one is held; null says nothing about the weather. */
  weather: SignalsDay["weather"];
  nudge: OrderNudge;
}
export interface OrderSignalsView {
  /** Only the days that carry at least one event: a day with nothing named is not listed. */
  days: OrderSignalDay[];
  events: EventIn[];
}

/**
 * The walk's view: of the look-ahead days, the ones with an event, each with its forecast line (if held) and
 * the nudge decision. `nudgeFor` is asked per date so the gate above is the only way a number gets here.
 * The caller passes days whose events were read WHOLE (`eventIds` non-null); a failed read is the caller's
 * "unreadable" state and never reaches this function.
 */
export function buildOrderSignals(args: { days: ReadonlyArray<SignalsDay>; events: ReadonlyArray<EventIn>; nudgeFor: (date: string) => OrderNudge }): OrderSignalsView {
  const days: OrderSignalDay[] = [];
  const used = new Set<string>();
  for (const day of args.days) {
    if (day.eventIds === null) throw new Error("events_not_read");
    if (day.eventIds.length === 0) continue;
    for (const id of day.eventIds) used.add(id);
    days.push({ date: day.date, eventIds: [...day.eventIds], weather: day.weather, nudge: args.nudgeFor(day.date) });
  }
  return { days, events: args.events.filter((e) => used.has(e.id)) };
}
