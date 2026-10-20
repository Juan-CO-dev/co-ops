/**
 * THE SCHEDULE SETTINGS VIEW — pure (Scheduling Phase 2, chunk F, Task 24). The view-model the settings page renders,
 * the helpers its editors share (quarter ↔ clock text, the TS structure validator naming the key BEFORE any post, the
 * station-column advisory) and the EXACT request bodies of every settings write (the route shapes are pinned in
 * `route-shapes-shared` and the people settings route).
 */
import type { NarrativeLine } from "@/lib/people-narrative";
import type { RoleCode } from "@/lib/roles";
import type { SkillTunables } from "@/lib/people/tunables-shared";
import type { PositionLabel } from "./board-view-shared";
import type { ScheduleShopSettings } from "./inputs-shared";
import type { PersonSettingsRow } from "./people-input-shared";
import type { ToastPrimarySuggestion } from "./position-rank-shared";
import { validScheduleStructure, type ScheduleStructure, type SeededFrom } from "./structure-shared";
import { Q_PER_DAY, addDays, isoWeekStart, qToWall, wallToQ } from "./time-shared";

export interface SettingsPerms {
  /** The schedule structure (GM own shop / MoO+; Tier E). */
  structure: boolean;
  /** Person schedule settings (GM own / MoO+ / an AGM with edit access). */
  people: boolean;
  /** Presence toggles and Add to schedule (pins). */
  presence: boolean;
  /** The shop switch, wage estimates, AGM access (MoO+; Tier E). */
  shopSwitch: boolean;
  /** The skill tunables (MoO+; Tier E). */
  tunables: boolean;
  /** The prep evidence position (GM own / MoO+; Tier E). */
  prepCard: boolean;
}

export interface SettingsMember {
  userId: string;
  name: string;
  role: RoleCode;
  /** The person's latest schedule settings; null = role defaults. */
  settings: PersonSettingsRow | null;
  /** Their role is off the floor schedule by default (prep / catering manager): "Include on the schedule" is offered. */
  includeOffered: boolean;
  /**
   * Juan 2026-10-20: a suggested PRIMARY from their most-worked Toast job (last 8 weeks) — only when they have a Toast
   * link, no primary yet, and a confident match to one of the shop's positions. A button, never saved on its own.
   */
  suggestedPrimary?: ToastPrimarySuggestion | null;
  /** Astra BC-007: the id of the latest settings row the card shows (null = none yet) — sent back as `expectedId`. */
  settingsId?: string | null;
  /**
   * Juan 2026-10-20 ("GMs own their shop"): may this actor change this person's settings? Below MoO never oneself, anyone at
   * or above GM, or anyone at or above the actor (`personSettingsSubjectRefusal`); the save path enforces the same rule.
   */
  editable?: boolean;
}

export interface SettingsPin { id: string; date: string; userId: string; startQ: number; endQ: number; positions: string[]; kind: "presence" | "added" }

export interface ScheduleSettingsView {
  locationId: string;
  today: string;
  /** The dates presence / Add to schedule may target (today on, two weeks). */
  dates: string[];
  perms: SettingsPerms;
  structure: { id: string | null; source: "saved" | "defaults"; value: ScheduleStructure } | null;
  closing: { measuredMinutes: number | null; samples: number };
  stationAdvisory: NarrativeLine[];
  positions: Record<string, PositionLabel>;
  /**
   * Juan 2026-10-20: the positions' roles are KNOWN (the structure is saved). Before that every position reads as a line
   * position, so the primary / secondary work-type check is not made (the save path skips it too).
   */
  positionRolesKnown?: boolean;
  names: Record<string, string>;
  members: SettingsMember[];
  /** MoO / Owner (presence only): the "in today" toggles. */
  presencePeople: Array<{ userId: string; name: string }>;
  pins: SettingsPin[];
  shop: ScheduleShopSettings | null;
  tunables: SkillTunables | null;
  prep: { pmV2: boolean; prepPositionId: string | null } | null;
}

// ─── The presence / Add-to-schedule range ─

/** How many days, from today, presence and Add to schedule offer — the ONE constant the offered dates AND the loaded
 * pins derive from (Astra chunk F P2-4: offering a date whose pins were never loaded hid them after a refresh). */
export const PRESENCE_DAYS = 14;
/** The offered dates: today … today + PRESENCE_DAYS − 1. */
export function presenceDates(today: string): string[] {
  return Array.from({ length: PRESENCE_DAYS }, (_, i) => addDays(today, i));
}
/** Every ISO week those dates touch (three when today is not a Monday): the weeks the loader reads pins for. */
export function presenceWeekStarts(today: string): string[] {
  return [...new Set(presenceDates(today).map(isoWeekStart))];
}

// ─── Clock text ──────────────────────────────────────────────────────────────

/** A quarter as an <input type="time"> value ("HH:MM"); 96 → "23:59"-free "24:00" is not an input value, so it clamps to 23:45. */
export function qToTime(q: number): string {
  return qToWall(Math.min(Math.max(0, q), Q_PER_DAY - 1));
}
/** An <input type="time"> value as a quarter; off the 15-minute grid or empty → null (the field shows its error). */
export function timeToQ(v: string): number | null {
  try { return wallToQ(v.length > 5 ? v.slice(0, 5) : v); } catch { return null; }
}

// ─── The structure ───────────────────────────────────────────────────────────

/** The TS twin of the SQL validator: the FIRST failing key, or null — checked BEFORE any post. */
export function structureSaveRefusal(draft: unknown): string | null {
  const r = validScheduleStructure(draft);
  return r.ok ? null : r.key;
}

/**
 * The station-column advisory (plan J4): after the structure is saved it is the scheduler's single source; a station
 * time that later differs from it (`stations.usually_closes_at`, a position's trim), a position added on the station
 * admin, or one retired there, is SHOWN — never applied silently.
 */
export function stationAdvisory(saved: ScheduleStructure, seeded: ScheduleStructure, seededFrom: Readonly<Record<string, SeededFrom>>): NarrativeLine[] {
  const out: NarrativeLine[] = [];
  const ids = [...new Set([...Object.keys(saved.positions), ...Object.keys(seeded.positions)])].sort();
  for (const id of ids) {
    const a = saved.positions[id];
    const b = seeded.positions[id];
    if (!a && b) { out.push({ key: "schedule.settings.advisory.new_position", params: { positionId: id } }); continue; }
    if (a && !b) { out.push({ key: "schedule.settings.advisory.retired_position", params: { positionId: id } }); continue; }
    if (!a || !b) continue;
    const from = seededFrom[id];
    if (from?.close === "station" && a.closeQ !== b.closeQ) out.push({ key: "schedule.settings.advisory.close", params: { positionId: id, savedQ: a.closeQ, stationQ: b.closeQ } });
    if (from && from.trim !== "default" && a.trimQ !== b.trimQ) out.push({ key: "schedule.settings.advisory.trim", params: { positionId: id, savedQ: a.trimQ, stationQ: b.trimQ } });
  }
  return out;
}

// ─── The exact bodies ────────────────────────────────────────────────────────

export const structureBody = (locationId: string, expectedId: string | null, structure: ScheduleStructure) => ({ action: "structure" as const, locationId, expectedId, structure });
export const shopBody = (locationId: string, s: ScheduleShopSettings) => ({
  action: "shop" as const, locationId, enabled: s.enabled, estimatedHourlyCents: s.estimatedHourlyCents, estimatedSalariedWeeklyCents: s.estimatedSalariedWeeklyCents, agmAccess: s.agmAccess,
});
export const personBody = (locationId: string, settings: PersonSettingsRow, expectedId: string | null) => ({ action: "person" as const, locationId, settings: { ...settings }, expectedId });
/** The user screen's pickers: only what changed, merged server-side onto the latest row (Astra BC-007). */
export const personPositionsBody = (locationId: string, userId: string, changes: Record<string, unknown>, expectedId: string | null) =>
  ({ action: "person_positions" as const, locationId, userId, changes: { ...changes }, expectedId });
export const pinBody = (locationId: string, pin: Omit<SettingsPin, "id">) => ({ action: "pin" as const, locationId, pin: { ...pin, positions: [...pin.positions] } });
export const retirePinBody = (locationId: string, pinId: string) => ({ action: "pin" as const, locationId, pin: { retiresId: pinId } });
export const tunablesBody = (locationId: string | null, tunables: SkillTunables) => ({ action: "tunables" as const, locationId, tunables });
export const prepBody = (locationId: string, s: { pmV2: boolean; prepPositionId: string | null }) => ({ action: "shop" as const, locationId, pmV2: s.pmV2, prepPositionId: s.prepPositionId });

/**
 * Astra BC-007 (r3): the staff editor's expected row id is bound to its DRAFT. When the props bring a different row (a
 * refresh, someone else's save) a CLEAN editor adopts it — values AND id together; a DIRTY editor keeps its draft and the
 * id that draft was based on, so its save is refused `person_settings_moved` instead of overwriting the newer row.
 */
export function editorBaseOnProps(cur: { dirty: boolean; baseId: string | null; seenId: string | null }, propsId: string | null): { baseId: string | null; seenId: string | null; reset: boolean } {
  if (propsId === cur.seenId) return { baseId: cur.baseId, seenId: cur.seenId, reset: false };
  return cur.dirty ? { baseId: cur.baseId, seenId: propsId, reset: false } : { baseId: propsId, seenId: propsId, reset: true };
}

/** Dollars typed by a person → cents, or null when blank (a blank estimate stays blank, R2); NaN / negative → "invalid". */
export function dollarsToCents(v: string): number | null | "invalid" {
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : "invalid";
}
