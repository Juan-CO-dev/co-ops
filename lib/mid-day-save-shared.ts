import { isDuplicateInFlight } from "@/lib/made-the-need-shared";
import { saveStatusStep, type SavePhase } from "@/lib/save-status-shared";

export interface MidDaySaveState {
  phase: SavePhase;
  revision: number;
  inFlightRevision: number | null;
  inFlightSignature: string | undefined;
}
export const initialMidDaySave: MidDaySaveState = {
  phase: "idle", revision: 0, inFlightRevision: null, inFlightSignature: undefined,
};
export type MidDaySaveEvent =
  | { type: "edit" }
  | { type: "start"; signature: string }
  | { type: "ack" | "fail"; revision: number };

/** The caller stores this in a ref synchronously, before the POST. */
export function nextSaveStep(prev: MidDaySaveState, event: MidDaySaveEvent): { state: MidDaySaveState; post: boolean } {
  if (event.type === "edit") {
    const status = saveStatusStep(prev, event);
    return { state: { ...prev, ...status }, post: false };
  }
  if (event.type === "start") {
    if (isDuplicateInFlight(prev.inFlightSignature, event.signature) || prev.inFlightRevision !== null) {
      return { state: prev, post: false };
    }
    const status = saveStatusStep(prev, { type: "start" });
    return { state: { ...status, inFlightRevision: status.revision, inFlightSignature: event.signature }, post: true };
  }
  if (prev.inFlightRevision !== event.revision) return { state: prev, post: false };
  const status = saveStatusStep(prev, event);
  return {
    state: {
      phase: prev.revision === event.revision ? status.phase : "idle",
      revision: status.revision,
      inFlightRevision: null,
      inFlightSignature: undefined,
    },
    post: false,
  };
}
