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
import { machineNotesMarkers, mergeMachineNotes, wrapMachineNotes } from "@/lib/catering/machine-notes-shared";

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
const NOTE_KEYS: ReadonlySet<string> = new Set(["uncancelled", "succeeded", "succeeded_with_warnings", "relish_finalized"]);
const LOSS_KEYS: ReadonlySet<string> = new Set(["cancelled", "rejected", "failed"]);

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
  // Safe default for any FUTURE key added to EZCATER_ORDER_EVENT_KEYS (the setup script subscribes
  // to all of them): a key that is not a create, note, accept, or loss is ignored — never a move.
  if (!LOSS_KEYS.has(key) && key !== "accepted") return { action: "ignore" };
  const target: PipelineStage = key === "accepted" ? "confirmed" : "lost";
  if (existingStage === target) return { action: "duplicate" };
  return canTransition(existingStage, target) ? { action: "move", stage: target } : { action: "illegal_transition", stage: target };
}

export const EZCATER_NOTES_BEGIN = machineNotesMarkers("ezCater order", "ezCater").begin;
export const EZCATER_NOTES_END = machineNotesMarkers("ezCater order", "ezCater").end;

/** Wrap the machine-written order block in markers so a refresh can replace it without touching human text. */
export function wrapEzcaterNotes(block: string): string {
  return wrapMachineNotes("ezCater order", block, "ezCater");
}

/** Replace the marked machine block inside existing notes (human text before/after is preserved);
 *  if no marked block exists, append one after the human text. Never drops a character a human wrote. */
export function mergeEzcaterNotes(existing: string | null | undefined, block: string): string {
  return mergeMachineNotes("ezCater order", existing, block, "ezCater");
}
