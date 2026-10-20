import type { ChecklistWriteActor } from "@/lib/checklist-write-actor";

/** Unit fixtures only. Production callers must use resolveChecklistWriteActor. */
export function checklistActor(overrides: Partial<ChecklistWriteActor> = {}): ChecklistWriteActor {
  return { userId: "actor", role: "key_holder", level: 4, active: true,
    sessionId: "session", locations: ["shop"], ...overrides } as ChecklistWriteActor;
}
