/** Daily advisory schedules. Pure projection: never closes or releases anything. */
import { currentStation, type ShiftBoard, type Station } from "./assignments-shared";
import { etCalendarDate, etClockTime, etYmdMinusDays } from "./operational-day";

export interface StationTrim { at: string; to_count: number }
export function validStationTrims(value: unknown): value is StationTrim[] {
  if (!Array.isArray(value) || value.length > 24) return false;
  let previous = "";
  for (const trim of value) {
    if (!trim || typeof trim !== "object" || Array.isArray(trim)
      || Object.keys(trim).some(key => key !== "at" && key !== "to_count")
      || typeof trim.at !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trim.at)
      || trim.at <= previous || !Number.isInteger(trim.to_count) || trim.to_count < 0 || trim.to_count > 100) return false;
    previous = trim.at;
  }
  return true;
}
export interface StationNudge { key: string; kind: "close" | "trim"; at: string; count: number; toCount: number }
export function stationNudges(board: ShiftBoard, station: Station, now: string, dismissed: readonly string[]): StationNudge[] {
  const day = board.stationDate ?? board.date;
  if (board.viewerLevel < 4 || !station.active || !station.staffed || station.closedAt || etCalendarDate(now) !== board.date) return [];
  const clock = etClockTime(now);
  // A closing schedule runs noon-to-noon: morning targets belong to the
  // following calendar date, not the morning before that day's evening shift.
  // Compare Eastern wall dates/times directly, without a fixed UTC/DST offset.
  const target = (at: string) => `${at.slice(0, 5) < "12:00" ? etYmdMinusDays(day, -1) : day}T${at.slice(0, 5)}`;
  const due = (at: string) => `${board.date}T${clock}` >= target(at);
  const count = board.people.filter(person => currentStation(board.events, person.id)?.stationId === station.id).length;
  const result: StationNudge[] = [];
  if (station.usuallyClosesAt && due(station.usuallyClosesAt)) {
    result.push({ key: `${day}/${station.id}/close/${station.usuallyClosesAt.slice(0, 5)}`, kind: "close", at: station.usuallyClosesAt, count, toCount: 0 });
  } else {
    // Only the latest due target applies; earlier targets must not compete with it.
    const trim = station.trims?.filter(entry => due(entry.at))
      .sort((a, b) => target(a.at).localeCompare(target(b.at))).at(-1);
    if (trim && count > trim.to_count) result.push({ key: `${day}/${station.id}/trim/${trim.at}/${trim.to_count}`, kind: "trim", at: trim.at, count, toCount: trim.to_count });
  }
  return result.filter(nudge => !dismissed.includes(nudge.key));
}

/** Each explicit picker choice goes through the existing unassign contract. */
export function trimReleasePayload(board: ShiftBoard, stationId: string, userId: string) {
  const person = board.people.find(entry => entry.id === userId);
  if (board.viewerLevel < 4 || !person || person.level > board.viewerLevel
    || currentStation(board.events, userId)?.stationId !== stationId) return null;
  return { action: "station", userId, stationId: null, positionId: null, manage: true } as const;
}
