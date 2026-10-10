/** Client-safe assignment contracts and station history. No I/O. */
import { formatTime } from "./i18n/format";
import type { Language, TranslationKey, TranslationParams } from "./i18n/types";
import type { PresenceView } from "./presence-shared";
import type { StationTrim } from "./station-schedule-shared";

export const OVERRIDE_REASON_CODES = ["coverage_change", "unavailable", "skill_fit", "correction", "other"] as const;
export type OverrideReasonCode = (typeof OVERRIDE_REASON_CODES)[number];
export interface OverrideReason { reasonCode?: OverrideReasonCode | null; reasonNote?: string | null }
export interface AssignmentChange {
  actorName: string | null; at: string; reasonCode: OverrideReasonCode | null;
  reasonNote: string | null; overriddenAssignerId: string | null;
}
export function requiresOverrideReason(actorLevel: number, assignerLevel: number | null | undefined): boolean {
  return assignerLevel != null && assignerLevel > actorLevel;
}
/** Shared shape validation; the current assigner is resolved under the RPC lock. */
export function validOverrideReason(code: unknown, note: unknown): boolean {
  return (code == null || OVERRIDE_REASON_CODES.some((value) => value === code))
    && (note == null || (typeof note === "string" && [...note].length <= 500))
    && (code !== "other" || (typeof note === "string" && note.trim().length > 0));
}
export function formatAssignmentAttribution(
  attribution: { source: "assigned" | "claimed" | "taken"; holderName: string; actorName: string | null; at: string } | null,
  language: Language, t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  if (!attribution) return t("assignments.unassigned");
  return t(`assignments.attribution.${attribution.source}`, {
    name: attribution.holderName, by: attribution.actorName ?? t("assignments.teamLead"),
    time: formatTime(attribution.at, language),
  });
}
export const TASK_TYPES = ["am_prep", "mid_day_prep", "cash_report", "opening_report", "receiving", "counts", "ordering", "pm_report"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
/** Floor means eligibility, never visibility or permission by itself. */
export const TASK_MIN_LEVEL: Record<TaskType, number> = {
  am_prep: 3, mid_day_prep: 3, opening_report: 3,
  cash_report: 4, receiving: 4, counts: 4, ordering: 4, pm_report: 4,
};
export function isTaskType(value: unknown): value is TaskType {
  return typeof value === "string" && TASK_TYPES.some((task) => task === value);
}
export interface StationPosition { id: string; stationId: string; name: string; nameEs: string | null; duty: string | null; dutyEs: string | null; sort: number; active: boolean; usuallyTrimsAt?: string | null }
export interface Station { id: string; name: string; nameEs: string | null; sort: number; active: boolean; staffed: boolean; positions: StationPosition[]; closedAt?: string | null; usuallyClosesAt?: string | null; trims?: StationTrim[] }
export interface ShiftPerson { id: string; name: string; level: number; hasWork: boolean; available?: boolean; onBreak?: boolean;
  /** 0233 (WHOS_HERE=1): on shift today and how we know. Absent when the feature is off. */
  presence?: PresenceView;
  /** Highest level that gave this person the work they hold (station assigned / open tasks). */
  heldFromLevel?: number }
export interface StationEvent {
  id: string; sequence: string; locationId: string; businessDate: string;
  userId: string; stationId: string | null; positionId?: string | null; kind: "assign" | "claim" | "move" | "release";
  actorId: string | null; actorName: string | null; at: string; source: "assigned" | "claimed" | null;
  releaseReason?: "station_closed" | "clocked_out" | "on_break" | "ended_shift" | "shop_closed";
  priorPositionId?: string | null; effectiveAt?: string | null;
  actorLevel?: number; change?: AssignmentChange;
}
export interface TaskAssignment {
  id: string; task: TaskType; assigneeId: string; assignerId: string;
  assignerName: string | null; note: string | null;
  source?: "assigned" | "taken"; at?: string; assigneeName?: string | null; assignerLevel?: number;
  change?: AssignmentChange;
  /** False assignments stay on the manager board for retraction but confer no work/access. */
  available?: boolean;
}
export interface ShiftBoard {
  stationDate?: string;
  locationId: string; date: string; viewerId: string; viewerLevel: number;
  stations: Station[]; people: ShiftPerson[]; events: StationEvent[]; tasks: TaskAssignment[];
  occupiedPositions?: { positionId: string; firstName: string }[];
  taskChanges?: { task: TaskType; change: AssignmentChange }[];
  positionVacancies?: { positionId: string; userId: string; name: string; reason: "clocked_out" | "on_break" | "ended_shift"; at: string }[];
  taskVacancies?: { task: TaskType; userId: string; name: string; at: string; reason?: "clocked_out" | "ended_shift" }[];
  /** 0233 (WHOS_HERE=1): presence + End my shift are live. */
  whosHere?: boolean;
}
export function taskHref(task: TaskType, locationId: string): string {
  const paths: Record<TaskType, string> = {
    am_prep: "/operations/am-prep", mid_day_prep: "/operations/mid-day",
    cash_report: "/cash", opening_report: "/operations/opening",
    receiving: "/operations/receiving", counts: "/operations/counts", ordering: "/ordering", pm_report: "/pm-report",
  };
  return `${paths[task]}?location=${encodeURIComponent(locationId)}`;
}
/** Sequence is the DB's serialization order (timestamps can tie or clocks change). */
export function orderedStationEvents(events: readonly StationEvent[]): StationEvent[] {
  return [...events].sort((a, b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 : BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0);
}
/** Pass one shop/day's events, as returned by loadShiftBoard. Release remains a head. */
export function currentStation(events: readonly StationEvent[], userId: string): StationEvent | null {
  return orderedStationEvents(events.filter((event) => event.userId === userId)).at(-1) ?? null;
}
export function canManageAssignee(actorLevel: number, targetLevel: number): boolean {
  return actorLevel >= 4 && targetLevel <= actorLevel;
}
export function canSelfClaim(current: StationEvent | null): boolean {
  return !current?.stationId || current.source === "claimed";
}
export function taskVisible(level: number, task: TaskType, assignments: readonly TaskAssignment[]): boolean {
  return level >= TASK_MIN_LEVEL[task] && assignments.some((assignment) => assignment.task === task
    && assignment.available !== false && (level >= 4 || assignment.source !== "taken"));
}
export interface StationInterval {
  locationId: string; businessDate: string; userId: string; stationId: string;
  source: "assigned" | "claimed"; start: string; end: string | null; eventId: string;
}
/** Half-open intervals; do not carry a station into another business day or shop. */
export function stationTimeline(events: readonly StationEvent[]): StationInterval[] {
  const open = new Map<string, StationInterval>();
  const intervals: StationInterval[] = [];
  for (const event of orderedStationEvents(events)) {
    const key = `${event.locationId}/${event.businessDate}/${event.userId}`;
    const prior = open.get(key);
    if (prior) prior.end = event.at;
    open.delete(key);
    if (event.stationId && event.source) {
      const interval: StationInterval = {
        locationId: event.locationId, businessDate: event.businessDate, userId: event.userId,
        stationId: event.stationId, source: event.source, start: event.at, end: null, eventId: event.id,
      };
      intervals.push(interval);
      open.set(key, interval);
    }
  }
  return intervals;
}
