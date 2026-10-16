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
import { validScheduleStructure, type ScheduleStructure, type SeededFrom } from "./structure-shared";
import { Q_PER_DAY, qToWall, wallToQ } from "./time-shared";

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
  names: Record<string, string>;
  members: SettingsMember[];
  /** MoO / Owner (presence only): the "in today" toggles. */
  presencePeople: Array<{ userId: string; name: string }>;
  pins: SettingsPin[];
  shop: ScheduleShopSettings | null;
  tunables: SkillTunables | null;
  prep: { pmV2: boolean; prepPositionId: string | null } | null;
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
export const personBody = (locationId: string, settings: PersonSettingsRow) => ({ action: "person" as const, locationId, settings: { ...settings } });
export const pinBody = (locationId: string, pin: Omit<SettingsPin, "id">) => ({ action: "pin" as const, locationId, pin: { ...pin, positions: [...pin.positions] } });
export const retirePinBody = (locationId: string, pinId: string) => ({ action: "pin" as const, locationId, pin: { retiresId: pinId } });
export const tunablesBody = (locationId: string | null, tunables: SkillTunables) => ({ action: "tunables" as const, locationId, tunables });
export const prepBody = (locationId: string, s: { pmV2: boolean; prepPositionId: string | null }) => ({ action: "shop" as const, locationId, pmV2: s.pmV2, prepPositionId: s.prepPositionId });

/** Dollars typed by a person → cents, or null when blank (a blank estimate stays blank, R2); NaN / negative → "invalid". */
export function dollarsToCents(v: string): number | null | "invalid" {
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : "invalid";
}
