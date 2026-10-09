/**
 * Mid-shift Pulse v2 — the ROLE MATRIX (spec "Role scoping", approved 2026-10-09). PURE, client-safe.
 *
 * ONE decision table serves the pulse page, every section's own page and /api/pulse, so a drill link
 * can never widen scope: the page that renders a card and the route that refreshes it ask the same
 * question. Enforcement is server-side in lib/pulse/sections.ts (the loader refuses BEFORE any I/O);
 * the client only uses this to decide what to render.
 *
 *   crew   (<4): own tasks/stations, shop status (stations, catering TIMING — when/how many/stage,
 *                server-redacted — food-safety reminders), handoff notes addressed to them. NO money,
 *                NO other people's details.
 *   KH/SL (4–5): + Needs attention (full), People, Stations & tasks (names + actions), Inventory,
 *                Catering (names, not-rung orders; no money), Food safety (per fridge).
 *   AGM     (6): + Handoff authoring / "Got it" acknowledgement.
 *   GM      (7): + Sales / money for their shop (lib/sales-reports assertSalesScope re-checks).
 *   8+         : both shops side by side, all sections.
 */
import { lockLocationContext } from "@/lib/locations";
import type { RoleCode } from "@/lib/roles";

export const PULSE_SECTIONS = [
  "attention",
  "floor",
  "people",
  "stations",
  "sales",
  "catering",
  "inventory",
  "food_safety",
  "handoff",
] as const;
export type PulseSection = (typeof PULSE_SECTIONS)[number];

export function isPulseSection(v: unknown): v is PulseSection {
  return typeof v === "string" && (PULSE_SECTIONS as readonly string[]).includes(v);
}

/** The v2 page floor: trainee and up. Prospects / not-yet-worked (0–1) are denied. */
export const PULSE_V2_BASE_LEVEL = 2;
/** Full (un-stripped) detail: key holder and up. Below this the viewer is CREW. */
export const PULSE_FULL_LEVEL = 4;
/** Handoff authoring + acknowledgement. */
export const HANDOFF_AUTHOR_LEVEL = 6;
/** Money (Sales section, catering totals). Matches SALES_READ_MIN. */
export const PULSE_MONEY_LEVEL = 7;
/** Saves the 3D floor layout for the shop. */
export const FLOOR_ARRANGE_LEVEL = 7;
/** Both shops side by side (matches REPORT_ALL_LOCATIONS_LEVEL). */
export const BOTH_SHOPS_LEVEL = 8;
/**
 * The PULSE-SPECIFIC read grant (Astra #5, CC ruling): level 8 (Dir. of Ops) reads every shop's pulse
 * — the spec's "8+ both shops side by side" — without widening any OPERATIONAL grant. Writes (layout
 * save, handoff authoring) keep `lockLocationContext` (9+ all-locations, else membership).
 */
export const PULSE_READ_ALL_LEVEL = 8;
export interface PulseReadActor { role: RoleCode; locations: string[]; level: number }
export function canReadPulseLocation(actor: PulseReadActor, locationId: string): boolean {
  return actor.level >= PULSE_READ_ALL_LEVEL || lockLocationContext({ role: actor.role, locations: actor.locations }, locationId);
}

export const SECTION_MIN_LEVEL: Record<PulseSection, number> = {
  attention: PULSE_V2_BASE_LEVEL,
  floor: PULSE_V2_BASE_LEVEL,
  people: PULSE_FULL_LEVEL,
  stations: PULSE_V2_BASE_LEVEL,
  sales: PULSE_MONEY_LEVEL,
  // Spec: crew get shop-level catering TIMING (when, how many, stage). The loader redacts names,
  // contacts, order numbers and money below PULSE_FULL_LEVEL (Astra #11) — the gate alone is not the scope.
  catering: PULSE_V2_BASE_LEVEL,
  inventory: PULSE_FULL_LEVEL,
  food_safety: PULSE_V2_BASE_LEVEL,
  handoff: PULSE_V2_BASE_LEVEL,
};

export function canViewSection(level: number, section: PulseSection): boolean {
  return level >= SECTION_MIN_LEVEL[section];
}
/** Canonical order (attention first — it loads first). */
export function visibleSections(level: number): PulseSection[] {
  return PULSE_SECTIONS.filter((s) => canViewSection(level, s));
}
/** Below KH the payloads are STRIPPED: own work only, counts instead of names. */
export function crewScoped(level: number): boolean {
  return level < PULSE_FULL_LEVEL;
}
export function moneyVisible(level: number): boolean {
  return level >= PULSE_MONEY_LEVEL;
}
export function canAuthorHandoff(level: number): boolean {
  return level >= HANDOFF_AUTHOR_LEVEL;
}
export function canArrangeFloor(level: number): boolean {
  return level >= FLOOR_ARRANGE_LEVEL;
}

export type PulsePageMode = "v1" | "denied" | "v2" | "v2_both";
/** What /mid-shift renders. Flag off = the unchanged v1 page, whatever the level. */
export function pulsePageAccess(args: { flagOn: boolean; level: number }): PulsePageMode {
  if (!args.flagOn) return "v1";
  if (args.level < PULSE_V2_BASE_LEVEL) return "denied";
  return args.level >= BOTH_SHOPS_LEVEL ? "v2_both" : "v2";
}

export type SectionAccess = "not_found" | "denied" | "ok";
/** What /mid-shift/<section> (and /api/pulse/section) does for this viewer. */
export function sectionAccess(args: { flagOn: boolean; level: number; section: string }): SectionAccess {
  if (!args.flagOn || !isPulseSection(args.section)) return "not_found";
  if (args.level < PULSE_V2_BASE_LEVEL || !canViewSection(args.level, args.section)) return "denied";
  return "ok";
}
