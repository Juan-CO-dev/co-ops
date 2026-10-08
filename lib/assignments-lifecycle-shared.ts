/** Pure lifecycle projections; release history never restores a holder. */
import { orderedStationEvents, type ShiftBoard, type StationEvent } from "./assignments-shared";

export function positionVacancies(events: readonly StationEvent[], breaks: ReadonlyMap<string, boolean>, names: ReadonlyMap<string, string>): NonNullable<ShiftBoard["positionVacancies"]> {
  const heads = new Map<string, StationEvent>();
  const vacancies = new Map<string, NonNullable<ShiftBoard["positionVacancies"]>[number]>();
  for (const event of orderedStationEvents(events)) {
    const previous = heads.get(event.userId);
    if (previous?.positionId) vacancies.delete(previous.positionId);
    if (event.positionId) vacancies.delete(event.positionId);
    if (event.priorPositionId && (event.releaseReason === "clocked_out" ||
      (event.releaseReason === "on_break" && breaks.get(event.userId)))) {
      vacancies.set(event.priorPositionId, { positionId: event.priorPositionId, userId: event.userId,
        name: names.get(event.userId) ?? "", reason: event.releaseReason, at: event.effectiveAt ?? event.at });
    }
    heads.set(event.userId, event);
  }
  return [...vacancies.values()];
}

export function takenSurvivesDeparture(at: string, departedAt: string | undefined): boolean {
  return !departedAt || Date.parse(at) > Date.parse(departedAt);
}

export function validStationTime(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value));
}
