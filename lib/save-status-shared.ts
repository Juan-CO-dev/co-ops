/** Client-safe save acknowledgement state. Revisions are local to one row. */
export type SavePhase = "idle" | "saving" | "saved" | "failed";
export interface SaveStatusState {
  phase: SavePhase;
  revision: number;
}
export type SaveStatusEvent =
  | { type: "edit" | "start" | "retry" }
  | { type: "ack" | "fail"; revision: number };

export const initialSaveStatus: SaveStatusState = { phase: "idle", revision: 0 };

export function saveStatusStep(state: SaveStatusState, event: SaveStatusEvent): SaveStatusState {
  switch (event.type) {
    case "edit":
      return { phase: "idle", revision: state.revision + 1 };
    case "start":
    case "retry":
      return { phase: "saving", revision: state.revision + 1 };
    case "ack":
    case "fail":
      if (event.revision !== state.revision) return state;
      return { ...state, phase: event.type === "ack" ? "saved" : "failed" };
  }
}
