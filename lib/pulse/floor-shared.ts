/**
 * Live shop floor — PURE (client-safe, zero I/O). Turns ONE board read into the floor's stations,
 * decides each station's status word, auto-arranges the map, merges a saved layout and decides
 * whether a device gets three.js or the 2D map.
 *
 * Auto-arrange is by `sort` in a serpentine grid: `stations` has no "type" column and the tenant
 * vocabulary law forbids classifying by name keywords, so the shape comes from the shop's own order
 * and a GM's one-time drag (saved per shop, audited). Status is always a WORD the UI translates —
 * colour is reinforcement, never the only signal.
 */
import { currentStation, isFloorStation, type ShiftBoard } from "@/lib/assignments-shared";
import { closeTimeFacts } from "@/lib/pulse/close-times-shared";
import type { FloorLayout, FloorLayoutPoint, FloorStation, FloorStatus } from "@/lib/pulse/types";

export const FLOOR_COLS = 3;
/** Layout coordinates are grid units; a GM may drag within this box. */
export const FLOOR_MAX_COORD = 12;

/**
 * The status WORD for a FLOOR station (callers filter with `isFloorStation` first). There is no
 * "unstaffed ⇒ covered" branch any more (Juan, 2026-10-10: four closing sections were painted green
 * with nobody at them): a station with nobody covering it is UNCOVERED, whatever its positions count.
 */
export function stationStatus(f: {
  active: boolean; closed: boolean; filled: number; positions: number; closingSoon: boolean; closeDue: boolean; onBreak: number;
}): FloorStatus {
  if (f.closed) return "closed";
  if (!f.active) return "inactive";
  const covering = Math.max(0, f.filled - f.onBreak);
  if (covering === 0) return "uncovered";
  if (f.positions > 0 && covering < f.positions) return "short";
  // Past its close time and still open is never green again (Astra #9): the floor and the attention list agree.
  if (f.closeDue) return "close_due";
  if (f.closingSoon) return "closing_soon";
  return "covered";
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || "?";

export function floorStations(board: ShiftBoard, args: { nowMinutes: number; viewerId: string; showNames: boolean }): FloorStation[] {
  const heads = new Map<string, ReturnType<typeof currentStation>>();
  for (const person of board.people) heads.set(person.id, currentStation(board.events, person.id));
  const onBreak = new Set(board.people.filter((p) => p.onBreak).map((p) => p.id));
  const openTasksBy = new Map<string, number>();
  for (const t of board.tasks) if (t.available !== false) openTasksBy.set(t.assigneeId, (openTasksBy.get(t.assigneeId) ?? 0) + 1);

  // Floor stations only: a closing section (unstaffed, or no active position) is never on the floor.
  return board.stations.filter(isFloorStation).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map((station) => {
    const here = board.people.filter((p) => heads.get(p.id)?.stationId === station.id);
    const covering = here.filter((p) => !onBreak.has(p.id));
    const facts = closeTimeFacts(station, args.nowMinutes);
    const positions = station.positions.filter((p) => p.active).length;
    const names = covering
      .filter((p) => args.showNames || p.id === args.viewerId)
      .map((p) => firstName(p.name));
    return {
      id: station.id,
      name: station.name,
      nameEs: station.nameEs,
      sort: station.sort,
      status: stationStatus({
        active: station.active, closed: facts.closedAt !== null,
        filled: here.length, positions, closingSoon: facts.closingSoon || facts.trimDue, closeDue: facts.closeDue, onBreak: here.length - covering.length,
      }),
      people: names,
      positions,
      filled: covering.length,
      closesAt: facts.closesAt,
      trimAt: facts.trimAt,
      trimTo: facts.trimTo,
      closedAt: facts.closedAt,
      closeDue: facts.closeDue,
      trimDue: facts.trimDue && facts.trimTo !== null && covering.length > facts.trimTo,
      tasksLeft: here.reduce((n, p) => n + (openTasksBy.get(p.id) ?? 0), 0),
    };
  });
}

/** Serpentine grid by the given order (already sorted): row 0 left→right, row 1 right→left, … */
export function autoArrange(ids: readonly string[]): FloorLayout {
  const out: FloorLayout = {};
  ids.forEach((id, i) => {
    const y = Math.floor(i / FLOOR_COLS);
    const col = i % FLOOR_COLS;
    out[id] = { x: y % 2 === 0 ? col : FLOOR_COLS - 1 - col, y };
  });
  return out;
}

function validPoint(p: unknown): p is FloorLayoutPoint {
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const { x, y } = p as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    && x >= 0 && y >= 0 && x <= FLOOR_MAX_COORD && y <= FLOOR_MAX_COORD;
}

export function validLayout(value: unknown): value is FloorLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 200 && entries.every(([k, v]) => k.length > 0 && k.length <= 64 && validPoint(v));
}

/** Saved points win; ids not on the floor are dropped; the rest keep their auto position. */
export function mergeLayout(ids: readonly string[], saved: FloorLayout | null): FloorLayout {
  const auto = autoArrange(ids);
  if (!saved) return auto;
  const out: FloorLayout = {};
  for (const id of ids) out[id] = saved[id] && validPoint(saved[id]) ? saved[id]! : auto[id]!;
  return out;
}

/** three.js only where it will not fight the device; the 2D map is the same information. */
export function choose3D(d: { webgl: boolean; reducedMotion: boolean; lowPower: boolean; saveData: boolean }): boolean {
  return d.webgl && !d.reducedMotion && !d.lowPower && !d.saveData;
}

/**
 * Which floor renders (Astra #8): a three.js failure (chunk load, renderer init, a render-time throw)
 * forces the 2D map for the rest of the mount, whatever the device or the user's toggle said;
 * otherwise the user's toggle wins over the device decision; `null` (server) is the 2D map too.
 */
export function floorMode(d: { deviceWants3D: boolean | null; override: boolean | null; failed: boolean }): "3d" | "2d" {
  if (d.failed) return "2d";
  return (d.override ?? d.deviceWants3D) === true ? "3d" : "2d";
}
