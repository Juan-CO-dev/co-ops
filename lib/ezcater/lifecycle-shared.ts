/**
 * ezCater order lifecycle — PURE decision table (zero I/O). Spec: catering-inbox design,
 * Amendment A1.1 (Juan, 2026-09-04): capture from `submitted`, move the lead along
 * automatically through every stage we can observe. The pipeline's own transition law
 * (`canTransition`) is the only authority on whether a move is allowed; this module never
 * forces one. `confirmed` is reached ONLY by `accepted` — the ezManage acceptance click, a
 * human act in a third-party tool — so the confirmation-is-human law holds.
 *
 * Event keys = the live Order `EventKey` enum introspected on api.ezcater.com 2026-09-03.
 */
import { canTransition, type PipelineStage } from "@/lib/catering/pipeline-shared";

export const EZCATER_ORDER_EVENT_KEYS = [
  "submitted", "accepted", "modified", "updated",
  "cancelled", "uncancelled", "rejected", "failed",
  "succeeded", "succeeded_with_warnings", "relish_finalized",
] as const;
export type EzcaterEventKey = (typeof EZCATER_ORDER_EVENT_KEYS)[number];

export type EzcaterAction =
  | { action: "create"; stage: "inquiry" | "confirmed" }
  | { action: "move"; stage: PipelineStage }
  | { action: "illegal_transition"; stage: PipelineStage }
  | { action: "refresh" }
  | { action: "note" }
  | { action: "duplicate" }
  | { action: "unmatched" }
  | { action: "ignore" };

const CREATE_STAGE: Partial<Record<EzcaterEventKey, "inquiry" | "confirmed">> = {
  submitted: "inquiry",
  modified: "inquiry",
  updated: "inquiry",
  accepted: "confirmed",
};
const LOST_KEYS: ReadonlySet<string> = new Set(["cancelled", "rejected", "failed"]);
const NOTE_KEYS: ReadonlySet<string> = new Set(["uncancelled", "succeeded", "succeeded_with_warnings", "relish_finalized"]);

function isKnown(key: string): key is EzcaterEventKey {
  return (EZCATER_ORDER_EVENT_KEYS as readonly string[]).includes(key);
}

/** One event + the lead's current stage (null = no lead yet) → exactly one action. */
export function planEzcaterEvent(key: string, existingStage: PipelineStage | null): EzcaterAction {
  if (!isKnown(key)) return { action: "ignore" };
  if (existingStage === null) {
    const stage = CREATE_STAGE[key];
    return stage ? { action: "create", stage } : { action: "unmatched" };
  }
  if (key === "submitted") return { action: "duplicate" };
  if (key === "modified" || key === "updated") return { action: "refresh" };
  if (NOTE_KEYS.has(key)) return { action: "note" };
  const target: PipelineStage = key === "accepted" ? "confirmed" : "lost";
  if (!LOST_KEYS.has(key) && key !== "accepted") return { action: "ignore" };
  if (existingStage === target) return { action: "duplicate" };
  return canTransition(existingStage, target) ? { action: "move", stage: target } : { action: "illegal_transition", stage: target };
}
