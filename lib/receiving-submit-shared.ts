export type ReceivingSubmitOutcome =
  | { type: "ok" }
  | { type: "refused" | "thrown"; message: string };
export interface ReceivingSubmitState {
  busy: boolean;
  retryable: boolean;
  error: string | null;
}
export const initialReceivingSubmit: ReceivingSubmitState = { busy: false, retryable: false, error: null };
export function submitStart(prev: ReceivingSubmitState): ReceivingSubmitState {
  return prev.busy ? prev : { busy: true, retryable: false, error: null };
}
export function submitOutcome(outcome: ReceivingSubmitOutcome, prev: ReceivingSubmitState): ReceivingSubmitState {
  if (!prev.busy) return prev;
  return {
    busy: false,
    retryable: outcome.type !== "ok",
    error: outcome.type === "ok" ? null : outcome.message,
  };
}
