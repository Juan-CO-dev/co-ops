export type ReceivingSubmitOutcome =
  | { type: "ok" }
  | { type: "refused" | "thrown"; message: string };
export interface ReceivingSubmitState {
  busy: boolean;
}
export function submitOutcome(outcome: ReceivingSubmitOutcome, prev: ReceivingSubmitState) {
  return {
    busy: false,
    retryable: outcome.type !== "ok",
    error: outcome.type === "ok" ? null : outcome.message,
  };
}
