/**
 * PM report — PURE rules (client-safe, zero I/O). D-28 (Juan 2026-10-13):
 *
 * 1. NO DEFAULT GRADE. Every eval card used to open with all four grades on "Good", so a manager
 *    who saved without looking filed four "Good"s nobody chose — and `/my-performance` and the team
 *    trends scored them as real feedback. A grade is now unset until the manager taps one, and a card
 *    saves only when all four are picked (the route already refuses anything but a real grade).
 *
 * 2. THE ROSTER COMES FROM TODAY'S PRESENCE. The starting cards used to be "anyone who touched the
 *    app today" (checklist completions + confirmations), which missed the person who worked the line
 *    all day without ticking a box and included anyone who opened a checklist from home. The seed is
 *    now the shift board's people who were at this shop today: present by the Who's Here model
 *    (Toast clock or CO-OPS activity — on shift now or off after being here), or, with presence
 *    tracking off, holding a station or task or having held a station today. The manager can still
 *    add anyone from the shop's list.
 */
import type { Gradient } from "@/lib/pm-report";
import type { ShiftBoard } from "@/lib/assignments-shared";

export interface EvalGrades {
  arrivedReady: Gradient | null;
  attitude: Gradient | null;
  production: Gradient | null;
  teamPlayer: Gradient | null;
}

/** True only when every grade has been picked — there is no default. */
export function evalGradesComplete(grades: EvalGrades): boolean {
  return grades.arrivedReady !== null && grades.attitude !== null && grades.production !== null && grades.teamPlayer !== null;
}

/**
 * Today's presence roster for the PM report, in the board's (name) order. A person is in when they
 * were at this shop today; someone no longer available at the shop (deactivated or moved) is not
 * seeded — the add-picker lists only the shop's active people, and the seed must not offer more.
 */
export function pmPresenceRoster(board: Pick<ShiftBoard, "people" | "events">): Array<{ id: string; name: string }> {
  const heldStationToday = new Set(board.events.filter((event) => event.stationId).map((event) => event.userId));
  return board.people
    .filter((person) => person.available !== false)
    .filter((person) => (person.presence ? person.presence.onShift || person.presence.source !== null : false)
      || person.hasWork || heldStationToday.has(person.id))
    .map((person) => ({ id: person.id, name: person.name }));
}
