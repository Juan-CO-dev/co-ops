/**
 * Station close times — THE SEAM (pure, client-safe).
 *
 * The pulse asks one question of a station: "when does it close / trim, and is that soon or due?"
 * Today the answer comes from 0230's advisory `stations.usually_closes_at` and
 * `station_positions.usually_trims_at` plus the lifecycle closure (`closedAt`). Astra's station
 * close times (0238, `stations.trims jsonb [{at, to_count}]`) is in review: this module reads `trims`
 * STRUCTURALLY when a board row carries it, so when that branch merges the richer schedule flows
 * through here with no change anywhere else in the pulse. Nothing here closes or releases anything.
 */
import type { Station } from "@/lib/assignments-shared";

/** "Closing soon" = within this many minutes of the station's close time. */
export const CLOSING_SOON_MINUTES = 60;

export interface CloseTimeFacts {
  /** "HH:MM" or null when the shop never set one. */
  closesAt: string | null;
  closedAt: string | null;
  closingSoon: boolean;
  /** Past the close time and still not closed. */
  closeDue: boolean;
  /** The trim that governs now (latest due) or the next one; null when none is set. */
  trimAt: string | null;
  trimTo: number | null;
  trimDue: boolean;
}

/** "HH:MM" / "HH:MM:SS" → minutes of day; anything else → null. */
export function clockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

const hhmm = (value: string): string => value.slice(0, 5).padStart(5, "0");

interface Trim { at: string; to_count: number }
/** Structural read of 0238's jsonb (validated like station-schedule-shared, independently). */
function trimsOf(station: Station): Trim[] {
  const raw = (station as Station & { trims?: unknown }).trims;
  if (!Array.isArray(raw) || raw.length > 24) return [];
  const out: Trim[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object" || Array.isArray(t)) return [];
    const at = (t as { at?: unknown }).at;
    const to = (t as { to_count?: unknown }).to_count;
    if (typeof at !== "string" || clockToMinutes(at) === null || !Number.isInteger(to) || (to as number) < 0) return [];
    out.push({ at: hhmm(at), to_count: to as number });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** 0230 fallback: positions with `usually_trims_at` (sort > 1) — trimming position N leaves N-1. */
function positionTrims(station: Station): Trim[] {
  const active = station.positions.filter((p) => p.active);
  return active
    .filter((p) => p.usuallyTrimsAt && clockToMinutes(p.usuallyTrimsAt) !== null)
    .map((p) => ({ at: hhmm(p.usuallyTrimsAt!), to_count: Math.max(0, active.filter((q) => q.sort < p.sort).length) }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function closeTimeFacts(station: Station, nowMinutes: number): CloseTimeFacts {
  const closedAt = station.closedAt ?? null;
  const closeMin = clockToMinutes(station.usuallyClosesAt ?? null);
  const closesAt = closeMin === null ? null : hhmm(station.usuallyClosesAt!);
  const open = closedAt === null;
  const closingSoon = open && closeMin !== null && nowMinutes < closeMin && closeMin - nowMinutes <= CLOSING_SOON_MINUTES;
  const closeDue = open && closeMin !== null && nowMinutes >= closeMin;

  const trims = trimsOf(station);
  const list = trims.length > 0 ? trims : positionTrims(station);
  let trimAt: string | null = null;
  let trimTo: number | null = null;
  let trimDue = false;
  if (open && list.length > 0) {
    const due = list.filter((t) => (clockToMinutes(t.at) ?? Infinity) <= nowMinutes);
    const governing = due.at(-1) ?? list[0]!;
    trimAt = governing.at;
    trimTo = governing.to_count;
    trimDue = due.length > 0;
  }
  return { closesAt, closedAt, closingSoon, closeDue, trimAt, trimTo, trimDue };
}
