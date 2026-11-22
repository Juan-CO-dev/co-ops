/**
 * The Dashboard's waiting logic (nav PR 7, plan r2 2.6, 2.10; Astra F1; lead ruling r2 G1). Server-only.
 *
 * ONE absolute page deadline bounds every OPTIONAL page read: the board, the bell, retrain, and the Receiving / Counts
 * bodies (the loader's own lanes, the own-assignment lane included, run inside its own 6 s deadline, started in the same
 * tick). A read never gets a fresh 6 s: it gets the time LEFT to the page deadline, and a read with no time left does not
 * start. `settleBy` never rejects, aborts its read at the deadline AND on rejection (nav PR 8, E5: a cell that runs
 * several reads under one signal cancels its surviving siblings the moment one rejects), and clears its timer on every
 * outcome. The loader's separate 7 s safety fallback (`loadDayFactsSafe`) stays as it is.
 *
 * Nav PR 8 adds the role blocks' reads (the numbers strip, "Needs you", the catering block's extras): each goes through
 * the page's `settle` (`Settle` below, bound to the SAME deadline) and fails only its own cell.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShiftBoard } from "@/lib/assignments-shared";
import type { CountsTileState } from "@/lib/counts";
import { DAY_FACT_DEADLINE_MS, loadDayFacts, type DayFactsArgs } from "@/lib/day-plan";
import type { DayPlanInput, SmmFacts } from "@/lib/day-plan-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { operationalNow } from "@/lib/midshift-shared";
import type { DeliveryView } from "@/lib/receiving";

// Nav PR 9: settleBy / settleWithin / Settled live in lib/settle-by.ts (the top bar must not import this module);
// re-exported so the Dashboard law names them here.
import { settleBy, settleWithin, type Settled } from "@/lib/settle-by";
export { settleBy, settleWithin, type Settled };

/** The page's per-cell bounded read (nav PR 8): `settleBy(run, deadlineAt, area)` with the page's one deadline. */
export type Settle = <T>(area: string, run: (signal: AbortSignal) => Promise<T>) => Promise<Settled<T>>;

/** The page's ONE absolute deadline, taken when the optional reads begin (the instant the board promise starts). */
export function startPageDeadline(): number {
  return Date.now() + DAY_FACT_DEADLINE_MS;
}

/** For the loader's board lane: the value, or a rejection (the loader then fails its three board facts). */
export function unwrapSettled<T>(r: Settled<T>): T {
  if (r.kind === "ok") return r.value;
  throw new Error(`board ${r.kind}`);
}

/** The social media manager's two notes, and (through planDay's ALL_FAILED_SHOP) every item unknown for anyone else. */
const FAILED_SMM_FACTS: SmmFacts = { kind: "smm", ownTasks: { kind: "failed" }, ownStation: { kind: "failed" } };

/**
 * The loader, behind a 7 s belt (the loader never throws and every lane is bounded, so this is a programming-error net):
 * on failure or overrun, the plan date and minutes from the same instant with FAILED_SMM_FACTS, which planDay renders as
 * "every fact failed" for a shop viewer (no phase line, no Next up claim) and as both notes for the social media manager.
 */
export async function loadDayFactsSafe(sb: SupabaseClient, args: DayFactsArgs): Promise<DayPlanInput> {
  const r = await settleWithin(() => loadDayFacts(sb, args), DAY_FACT_DEADLINE_MS + 1_000, "dayFacts");
  if (r.kind === "ok") return r.value;
  const { date: planDate, minutesOfDay: nowMin } = operationalNow(args.now);
  return { planDate, nowMin, viewer: args.viewer, facts: FAILED_SMM_FACTS };
}

/** The page's bounded optional read: the value, or null with its label added to the "couldn't load" lines. */
export type Widget = <T>(label: TranslationKey, run: (signal: AbortSignal) => Promise<T>) => Promise<T | null>;

export interface RichBodies {
  /** The viewer holds an available Receiving / Counts assignment today (the engine's "mine" rule). */
  readonly ownReceiving: boolean;
  readonly ownCounts: boolean;
  /** null = not read, or the read failed / timed out (the tile then shows its own "couldn't load"). */
  readonly deliveries: DeliveryView[] | null;
  readonly counts: CountsTileState | null;
}

/**
 * The own Receiving / Counts bodies (plan 2.6.1; G1). Waits for the page's ONE board promise; if the board is not `ok`, it
 * starts NOTHING (no read depends on a board that failed or timed out) and returns null. With an `ok` board it starts the
 * reads for the viewer's own available tasks only, in parallel, each through the page's `widget` (bounded by what is LEFT
 * of the page deadline; with nothing left, the read does not start).
 */
export async function richBodies(
  boardSettled: Promise<Settled<ShiftBoard>>,
  own: { readonly userId: string; readonly receiving: (signal: AbortSignal) => Promise<DeliveryView[]>; readonly counts: (signal: AbortSignal) => Promise<CountsTileState> },
  widget: Widget,
): Promise<RichBodies | null> {
  const b = await boardSettled;
  if (b.kind !== "ok") return null;
  const mine = new Set(b.value.tasks.filter((t) => t.assigneeId === own.userId && t.available !== false).map((t) => t.task));
  const ownReceiving = mine.has("receiving");
  const ownCounts = mine.has("counts");
  const [deliveries, counts] = await Promise.all([
    ownReceiving ? widget("receiving.page.title", (signal) => own.receiving(signal)) : Promise.resolve(null),
    ownCounts ? widget("counts.page.title", (signal) => own.counts(signal)) : Promise.resolve(null),
  ]);
  return { ownReceiving, ownCounts, deliveries, counts };
}
