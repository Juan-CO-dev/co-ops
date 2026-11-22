/**
 * The Dashboard's waiting logic (nav PR 7, plan r2 2.6, 2.10; Astra F1; lead ruling r2 G1). Server-only.
 *
 * ONE absolute page deadline bounds every OPTIONAL page read: the board, the bell, retrain, and the Receiving / Counts
 * bodies (the loader's own lanes, the own-assignment lane included, run inside its own 6 s deadline, started in the same
 * tick). A read never gets a fresh 6 s: it gets the time LEFT to the page deadline, and a read with no time left does not
 * start. `settleBy` never rejects, aborts its read at the deadline, and clears its timer on every outcome. The loader's
 * separate 7 s safety fallback (`loadDayFactsSafe`) stays as it is.
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

export type Settled<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "failed" } | { readonly kind: "timed_out" };

function logOutcome(area: string, kind: "failed" | "timed_out"): void {
  // The area and the outcome kind only: never row content (as lib/day-plan.ts logs a lane).
  console.error(`dashboard: ${area} ${kind}`);
}

/** The page's ONE absolute deadline, taken when the optional reads begin (the instant the board promise starts). */
export function startPageDeadline(): number {
  return Date.now() + DAY_FACT_DEADLINE_MS;
}

/**
 * Run `run` bounded by the ABSOLUTE deadline `deadlineAt` (epoch ms). Never rejects: `ok`, `failed` (it rejected or threw)
 * or `timed_out` (the deadline came first, or no time was left to start it, in which case `run` is never called). At the
 * deadline the read's signal is aborted. The timer is cleared on success and on rejection; a timeout's timer has fired;
 * a read that settles late after a timeout changes nothing and leaves nothing behind.
 */
export function settleBy<T>(run: (signal: AbortSignal) => Promise<T>, deadlineAt: number, area: string): Promise<Settled<T>> {
  const left = deadlineAt - Date.now();
  if (left <= 0) {
    logOutcome(area, "timed_out");
    return Promise.resolve({ kind: "timed_out" });
  }
  const controller = new AbortController();
  return new Promise<Settled<T>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      logOutcome(area, "timed_out");
      resolve({ kind: "timed_out" });
    }, left);
    let p: Promise<T>;
    try { p = Promise.resolve(run(controller.signal)); } catch (e) { p = Promise.reject(e); }
    p.then(
      (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ kind: "ok", value }); },
      () => { if (settled) return; settled = true; clearTimeout(timer); logOutcome(area, "failed"); resolve({ kind: "failed" }); },
    );
  });
}

/** `settleBy` with a deadline `ms` from now (the loader's separate safety bound). */
export function settleWithin<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, area: string): Promise<Settled<T>> {
  return settleBy(run, Date.now() + ms, area);
}

/** For the loader's board lane: the value, or a rejection (the loader then fails its three board facts). */
export function unwrapSettled<T>(r: Settled<T>): T {
  if (r.kind === "ok") return r.value;
  throw new Error(`board ${r.kind}`);
}

/** The social media manager's two notes, and (through planDay's ALL_FAILED_SHOP) every item unknown for anyone else. */
export const FAILED_SMM_FACTS: SmmFacts = { kind: "smm", ownTasks: { kind: "failed" }, ownStation: { kind: "failed" } };

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
  own: { readonly userId: string; readonly receiving: () => Promise<DeliveryView[]>; readonly counts: () => Promise<CountsTileState> },
  widget: Widget,
): Promise<RichBodies | null> {
  const b = await boardSettled;
  if (b.kind !== "ok") return null;
  const mine = new Set(b.value.tasks.filter((t) => t.assigneeId === own.userId && t.available !== false).map((t) => t.task));
  const ownReceiving = mine.has("receiving");
  const ownCounts = mine.has("counts");
  const [deliveries, counts] = await Promise.all([
    ownReceiving ? widget("receiving.page.title", () => own.receiving()) : Promise.resolve(null),
    ownCounts ? widget("counts.page.title", () => own.counts()) : Promise.resolve(null),
  ]);
  return { ownReceiving, ownCounts, deliveries, counts };
}
