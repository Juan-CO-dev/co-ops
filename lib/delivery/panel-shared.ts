/**
 * Catering delivery (D2) — the Delivery panel's view-model. Zero I/O, no clock. Client-safe.
 *
 * The panel (components/catering/pipeline/DeliveryPanel.tsx) decides NOTHING about who may do what: the server's
 * response is the authority. `detail` is present only for a person who may write (the detail gate IS the write gate,
 * lib/delivery/access-shared.ts); `cost` only for a person who may read money. These helpers turn that response into
 * what is on the screen, so the rules can be tested without a browser:
 *
 *  - `panelShown`: the panel renders NOTHING unless the response is the lead view AND delivery is on for the lead's
 *    shop — and then only when there is something to say or to do (a job, a state, or a delivery to record).
 *  - `recordOffer`: when "Record a delivery" is offered, and in which mode. An ezCater order is only ever
 *    `provider_native` (CO-OPS never books an ezCater delivery — it records the courier ezCater sent).
 *  - `statusTaps`: the manual moves of an OPEN job (the one table, lib/delivery/status-shared.ts).
 *  - `jobCostLines`: a job's current cost figures (the chain heads) and which figures can still be added.
 *  - `dollarsToCents`: judged on what was TYPED, never on a float product.
 *  - `deliveryErrorKey`: every refusal has its own en + es message (`delivery.error.<code>`).
 */
import type { PipelineStage } from "@/lib/catering/pipeline-shared";
import { costHeads, jobCost, type JobCost } from "./cost-shared";
import { DELIVERY_ERROR_CODES } from "./errors";
import type { LeadDeliveryView } from "./jobs";
import { latestJob, MANUAL_MOVES, type ManualDeliveryStatus } from "./status-shared";
import { DELIVERY_COST_COMPONENTS, type DeliveryCostComponent, type DeliveryCostRow, type DeliveryJob, type DeliveryState } from "./types-shared";

export type DeliveryLeadView = Extract<LeadDeliveryView, { view: "lead" }>;
export type DeliveryHistoryView = Extract<LeadDeliveryView, { view: "history" }>;

/** The stages a delivery can be recorded in (0356 `lead_not_confirmed` otherwise). */
const BOOKABLE_STAGES: readonly PipelineStage[] = ["confirmed", "out", "completed"];

/** May this person write? The server sends `detail` only to a person who passes the write gate. */
export function canWriteDelivery(view: DeliveryLeadView): boolean {
  return view.detail !== undefined;
}

export type RecordOffer =
  | { kind: "form"; mode: "manual" | "provider_native"; providers: readonly string[] }
  /** Two quotes are accepted: a person settles which stands before a delivery is recorded. */
  | { kind: "blocked"; reason: "quote_ambiguous" }
  | null;

/** "Record a delivery": offered to a writer, on a confirmed order that is not rejected, with no delivery open. */
export function recordOffer(view: DeliveryLeadView, stage: PipelineStage): RecordOffer {
  if (!view.enabled || !view.detail) return null;
  if (!BOOKABLE_STAGES.includes(stage) || view.orderQuote.kind === "rejected") return null;
  if (view.detail.jobs.some((j) => j.closedAt === null)) return null;
  if (view.orderQuote.kind === "ambiguous") return { kind: "blocked", reason: "quote_ambiguous" };
  if (view.isEzcater) return { kind: "form", mode: "provider_native", providers: [] };
  // A house order whose quote is a pickup takes no delivery. No quote at all (a Toast-rung order) may still take one.
  if (view.orderQuote.kind !== "none" && view.orderQuote.isDelivery !== true) return null;
  return { kind: "form", mode: "manual", providers: view.detail.manualProviders };
}

/** The panel renders nothing unless delivery is ON for the lead's shop, and there is something to say or to do. */
export function panelShown(view: LeadDeliveryView | null, stage: PipelineStage): view is DeliveryLeadView {
  if (!view || view.view !== "lead" || !view.enabled) return false;
  return view.status !== null || view.state !== "none" || recordOffer(view, stage) !== null;
}

export type ChipTone = "alert" | "warn" | "ok" | "muted";
export function deliveryChipTone(state: DeliveryState): ChipTone {
  if (state === "cancel_needed" || state === "pickup_mismatch" || state === "problem") return "alert";
  if (state === "to_book" || state === "to_book_soon") return "warn";
  if (state === "booked" || state === "on_the_way" || state === "delivered") return "ok";
  return "muted";
}

/** The manual moves of an open job; none once it is closed. */
export function statusTaps(job: Pick<DeliveryJob, "status" | "closedAt">): readonly ManualDeliveryStatus[] {
  return job.closedAt === null ? MANUAL_MOVES[job.status] ?? [] : [];
}

/** Newest first: the highest attempt (never a time). */
export function jobsNewestFirst<T extends { attemptNo: number }>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => b.attemptNo - a.attemptNo);
}

/** The open job a named alert is about (`cancel_needed`, `pickup_mismatch`), for a person who has the detail. */
export function alertJob(view: DeliveryLeadView): DeliveryJob | null {
  if (view.state !== "cancel_needed" && view.state !== "pickup_mismatch") return null;
  return latestJob((view.detail?.jobs ?? []).filter((j) => j.closedAt === null));
}

export interface JobCostLines {
  cost: JobCost;
  /** The CURRENT row of each figure (the chain heads), in the canonical component order: what "Correct" names. */
  heads: DeliveryCostRow[];
  /** Figures with no row yet: what "Add cost" may still record. */
  addable: DeliveryCostComponent[];
}
export function jobCostLines(jobId: string, costs: readonly DeliveryCostRow[]): JobCostLines {
  const mine = costs.filter((c) => c.jobId === jobId);
  const heads = costHeads(mine).sort((a, b) => DELIVERY_COST_COMPONENTS.indexOf(a.component) - DELIVERY_COST_COMPONENTS.indexOf(b.component));
  const have = new Set(heads.map((h) => h.component));
  return { cost: jobCost(mine), heads, addable: DELIVERY_COST_COMPONENTS.filter((c) => !have.has(c)) };
}

/** "$30", "30.5", "30.50" → cents; anything else (a comma, three decimals, a sign) → null. */
export function dollarsToCents(typed: string): number | null {
  const m = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
/** A credit is recorded as a negative figure; every other component as typed. */
export function signedCents(component: DeliveryCostComponent, cents: number): number {
  return component === "credit" && cents !== 0 ? -Math.abs(cents) : cents;
}
/** "37.5" percent → 3750 basis points; null unless 0 to 100 with at most two decimals. */
export function percentToBps(typed: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(typed.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}
export function bpsToPercent(bps: number): string {
  return String(bps / 100);
}

/** Client-side outcomes that are not the server's codes. */
export const DELIVERY_CLIENT_CODES = ["network", "step_up_required", "step_up_stale"] as const;
/** Every code a delivery screen can show, each with its own en + es message. */
export const DELIVERY_MESSAGE_CODES = [...DELIVERY_ERROR_CODES, ...DELIVERY_CLIENT_CODES] as const;
export function deliveryErrorKey(code: string | null | undefined): string {
  return `delivery.error.${(DELIVERY_MESSAGE_CODES as readonly string[]).includes(code ?? "") ? code : "generic"}`;
}
