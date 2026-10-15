/**
 * POSITION INTERVALS — who held which station position, when. Pure.
 *
 * Scheduling Phase 1, Task 3. Skills key on `station_positions.id`, and PM v2 grades are bound to
 * positions a person actually worked, so both need a per-POSITION timeline. The existing
 * `stationTimeline` (lib/assignments-shared.ts) is per STATION and ignores `effective_at`; it is
 * left untouched and this module sits beside it, reusing its ordering (`orderedStationEvents`:
 * the DB sequence is the serialization order, timestamps can tie).
 *
 * Rules:
 *  - one timeline per (shop, business day, person); an interval never crosses any of the three;
 *  - an interval ends at the next event's `coalesce(effectiveAt, at)` for the same key (a break
 *    release, a departure, a move, a new claim), and the next interval starts at that same instant,
 *    so consecutive intervals neither overlap nor leave a gap;
 *  - an end is never before its start (a back-dated `effective_at` gives a zero-length interval);
 *  - a 0217-era event with no position stays `positionId: null` (the "position unknown" bucket),
 *    never guessed from the station.
 */
import { orderedStationEvents, type StationEvent } from "@/lib/assignments-shared";

export interface PositionInterval {
  locationId: string;
  businessDate: string;
  userId: string;
  stationId: string;
  positionId: string | null;
  start: string;
  end: string | null;
  source: "assigned" | "claimed";
}

function instantMs(iso: string): number {
  return Date.parse(iso);
}
/** The later of two ISO instants (keeps `floor`'s own spelling when it wins or ties). */
function notBefore(candidate: string, floor: string): string {
  return instantMs(candidate) < instantMs(floor) ? floor : candidate;
}

/** Half-open; an interval ends at the next event's coalesce(effectiveAt, at) for the same (shop, day, person). */
export function positionTimeline(events: readonly StationEvent[]): PositionInterval[] {
  const open = new Map<string, PositionInterval>();
  const intervals: PositionInterval[] = [];
  for (const event of orderedStationEvents(events)) {
    const key = `${event.locationId}/${event.businessDate}/${event.userId}`;
    const instant = event.effectiveAt ?? event.at;
    const prior = open.get(key);
    let start = instant;
    if (prior) {
      prior.end = notBefore(instant, prior.start);
      start = prior.end;
    }
    open.delete(key);
    if (event.stationId && event.source) {
      const interval: PositionInterval = {
        locationId: event.locationId, businessDate: event.businessDate, userId: event.userId,
        stationId: event.stationId, positionId: event.positionId ?? null,
        start, end: null, source: event.source,
      };
      intervals.push(interval);
      open.set(key, interval);
    }
  }
  return intervals;
}

/** Clip open intervals to `closeAt` (the business day's end or "now"), never past it, never before the start. */
export function closeOpenIntervals(iv: readonly PositionInterval[], closeAt: string): PositionInterval[] {
  return iv.map((i) => (i.end === null ? { ...i, end: notBefore(closeAt, i.start) } : { ...i }));
}

/** Minutes two ranges share (instants, so DST-correct). 0 when disjoint, touching, inverted or unparseable. */
export function overlapMinutes(a: { start: string; end: string }, b: { start: string; end: string }): number {
  const from = Math.max(instantMs(a.start), instantMs(b.start));
  const to = Math.min(instantMs(a.end), instantMs(b.end));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  if (instantMs(a.end) < instantMs(a.start) || instantMs(b.end) < instantMs(b.start)) return 0;
  return (to - from) / 60_000;
}

/**
 * Distinct positions a person held, with whole minutes, in first-held order. Pass ONE shop/day's
 * intervals (as `positionTimeline` gives them per key). A still-open interval counts 0 minutes:
 * close it first with `closeOpenIntervals`. A null position is its own row per station.
 */
export function positionsWorked(
  iv: readonly PositionInterval[],
  userId: string,
): Array<{ positionId: string | null; stationId: string; minutes: number }> {
  const rows = new Map<string, { positionId: string | null; stationId: string; ms: number }>();
  for (const i of iv) {
    if (i.userId !== userId) continue;
    const key = i.positionId === null ? `null/${i.stationId}` : `pos/${i.positionId}`;
    const row = rows.get(key) ?? { positionId: i.positionId, stationId: i.stationId, ms: 0 };
    if (i.end !== null) {
      const ms = instantMs(i.end) - instantMs(i.start);
      if (Number.isFinite(ms) && ms > 0) row.ms += ms;
    }
    rows.set(key, row);
  }
  return [...rows.values()].map((r) => ({ positionId: r.positionId, stationId: r.stationId, minutes: Math.round(r.ms / 60_000) }));
}
