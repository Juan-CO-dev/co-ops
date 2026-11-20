/**
 * Item 21 PR 5 — the pure rules of the catering ↔ Toast SETTINGS card (migration 0350). Read with
 * docs/runbooks/catering-toast.md ("Turning a shop on").
 *
 *  - WHO: Owner, CGS and MoO, by trusted ROLE (never by level alone). `canManageCateringToastSettings` is the app's
 *    copy; `set_catering_toast_settings` re-checks it in SQL on the locked users row.
 *  - WHAT: a shop's WHOLE row of eight settings. A save names the row the person saw (`expectedUpdatedAt`, null = the
 *    shop has no row yet): someone else's change in between is `settings_moved`, never a blind overwrite.
 *  - THE DEPENDENCIES are one rule, `settingsRefusal`: the writer's own refusals in the writer's own order (pinned
 *    against 0350). The card disables Save and says why from it; the server never trusts that and asks the writer.
 *  - A shop with no row is OFF, and the card shows the defaults a first save would write.
 * Zero I/O. Client-safe.
 */
import type { RoleCode } from "@/lib/roles";
import { realDate } from "./catering-toast-backfill-shared";

export const CATERING_TOAST_SETTINGS_ROLES: readonly RoleCode[] = ["owner", "cgs", "moo"];
export const canManageCateringToastSettings = (role: RoleCode): boolean => CATERING_TOAST_SETTINGS_ROLES.includes(role);

export interface CateringToastSettingsValues {
  enabled: boolean;
  ringCodeEnabled: boolean;
  autoLinkEnabled: boolean;
  originAutoLinkEnabled: boolean;
  includeToastOriginLeads: boolean;
  /** The amount difference that still counts as a match: cents AND share of the order's value (both must be exceeded to flag). */
  toleranceCents: number;
  tolerancePct: number;
  /** Automatic linking never reaches an event before this ET date (Juan answer 7). */
  autoLinkFromDate: string | null;
}
/** 0344's column defaults: what a shop with no row reads as. */
export const DEFAULT_CATERING_TOAST_SETTINGS: CateringToastSettingsValues = {
  enabled: false, ringCodeEnabled: false, autoLinkEnabled: false, originAutoLinkEnabled: false, includeToastOriginLeads: false,
  toleranceCents: 5000, tolerancePct: 0.15, autoLinkFromDate: null,
};
export const SETTINGS_SWITCHES = ["enabled", "ringCodeEnabled", "autoLinkEnabled", "originAutoLinkEnabled", "includeToastOriginLeads"] as const;
export type SettingsSwitch = (typeof SETTINGS_SWITCHES)[number];

export interface CateringToastShopCard {
  locationId: string;
  name: string;
  values: CateringToastSettingsValues;
  /** The row's `updated_at` exactly as the database gave it; null = the shop has no row yet. */
  updatedAt: string | null;
}
/** What the two facts the writer's refusals rest on are, as 0350's probe answered. */
export interface SettingsReadiness { linkStep: boolean; automatic: boolean }
export type CateringToastSettingsView =
  | { state: "ready"; readiness: SettingsReadiness; shops: CateringToastShopCard[] }
  /** 0344 or 0350 is not applied: nothing to edit, and the page says so. */
  | { state: "not_installed" };

/** The settings as the database row spells them (the writer accepts exactly these eight keys). */
export interface SettingsRow {
  enabled: boolean; ring_code_enabled: boolean; auto_link_enabled: boolean; origin_auto_link_enabled: boolean;
  include_toast_origin_leads: boolean; tolerance_cents: number; tolerance_pct: number | string; auto_link_from_date: string | null;
}
export const SETTINGS_ROW_COLUMNS = "location_id,enabled,ring_code_enabled,auto_link_enabled,origin_auto_link_enabled,include_toast_origin_leads,tolerance_cents,tolerance_pct,auto_link_from_date,updated_at";
export const toSettingsRow = (v: CateringToastSettingsValues): SettingsRow => ({
  enabled: v.enabled, ring_code_enabled: v.ringCodeEnabled, auto_link_enabled: v.autoLinkEnabled, origin_auto_link_enabled: v.originAutoLinkEnabled,
  include_toast_origin_leads: v.includeToastOriginLeads, tolerance_cents: v.toleranceCents, tolerance_pct: v.tolerancePct, auto_link_from_date: v.autoLinkFromDate,
});
export const fromSettingsRow = (r: SettingsRow): CateringToastSettingsValues => ({
  enabled: r.enabled === true, ringCodeEnabled: r.ring_code_enabled === true, autoLinkEnabled: r.auto_link_enabled === true,
  originAutoLinkEnabled: r.origin_auto_link_enabled === true, includeToastOriginLeads: r.include_toast_origin_leads === true,
  toleranceCents: Number(r.tolerance_cents), tolerancePct: Number(r.tolerance_pct),
  autoLinkFromDate: r.auto_link_from_date === null ? null : String(r.auto_link_from_date).slice(0, 10),
});

/** Every refusal the writer (0350) can answer, plus the route's own. Each has an en + es message. */
export const SETTINGS_ERRORS = [
  "forbidden", "location_not_found", "invalid_settings", "settings_moved", "no_change",
  "switch_needs_enabled", "auto_needs_start_date", "origin_listing_needs_origin_link", "link_step_not_installed", "automatic_not_installed",
  "backfill_needs_switch", "backfill_timeout", "backfill_stopped", "settings_unavailable", "step_up_required", "step_up_stale",
] as const;
export type SettingsError = (typeof SETTINGS_ERRORS)[number];
export function settingsErrorKey(code: unknown): `admin.catering.toast.error.${string}` {
  return `admin.catering.toast.error.${typeof code === "string" && (SETTINGS_ERRORS as readonly string[]).includes(code) ? code : "generic"}`;
}

/** The writer's dependency refusals, in the writer's order (0350; pinned). null = the row may be saved. */
export const SETTINGS_DEPENDENCY_REFUSALS = ["switch_needs_enabled", "auto_needs_start_date", "origin_listing_needs_origin_link", "link_step_not_installed", "automatic_not_installed"] as const;
export type SettingsDependencyRefusal = (typeof SETTINGS_DEPENDENCY_REFUSALS)[number];
export function settingsRefusal(v: CateringToastSettingsValues, ready: SettingsReadiness): SettingsDependencyRefusal | null {
  if (!v.enabled && (v.ringCodeEnabled || v.autoLinkEnabled || v.originAutoLinkEnabled || v.includeToastOriginLeads)) return "switch_needs_enabled";
  if ((v.autoLinkEnabled || v.originAutoLinkEnabled) && v.autoLinkFromDate === null) return "auto_needs_start_date";
  if (v.includeToastOriginLeads && !v.originAutoLinkEnabled) return "origin_listing_needs_origin_link";
  if (v.enabled && !ready.linkStep) return "link_step_not_installed";
  if ((v.ringCodeEnabled || v.autoLinkEnabled || v.originAutoLinkEnabled) && !ready.automatic) return "automatic_not_installed";
  return null;
}

export const sameSettings = (a: CateringToastSettingsValues, b: CateringToastSettingsValues): boolean =>
  SETTINGS_SWITCHES.every((k) => a[k] === b[k]) && a.toleranceCents === b.toleranceCents && a.tolerancePct === b.tolerancePct && a.autoLinkFromDate === b.autoLinkFromDate;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TOLERANCE_CENTS = 100_000;

export interface SettingsSave { locationId: string; values: CateringToastSettingsValues; expectedUpdatedAt: string | null }
/** Strict: exactly `locationId`, `values` (exactly the eight settings, each of its type and range) and `expectedUpdatedAt`. */
export function parseSettingsSave(raw: unknown): SettingsSave | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((k) => !["locationId", "values", "expectedUpdatedAt"].includes(k))) return null;
  if (typeof body.locationId !== "string" || !UUID.test(body.locationId)) return null;
  if (body.expectedUpdatedAt !== null && (typeof body.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(body.expectedUpdatedAt)) || body.expectedUpdatedAt.length > 40)) return null;
  const v = body.values;
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const values = v as Record<string, unknown>;
  const keys = [...SETTINGS_SWITCHES, "toleranceCents", "tolerancePct", "autoLinkFromDate"];
  if (Object.keys(values).length !== keys.length || Object.keys(values).some((k) => !keys.includes(k))) return null;
  for (const k of SETTINGS_SWITCHES) if (typeof values[k] !== "boolean") return null;
  const cents = values.toleranceCents, pct = values.tolerancePct, from = values.autoLinkFromDate;
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0 || cents > MAX_TOLERANCE_CENTS) return null;
  if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 1 || Math.round(pct * 1000) / 1000 !== pct) return null;
  // A date that looks like one and is not (2026-13-01, 2026-02-30) is refused here, never thrown (review PORTAL5-r1).
  if (from !== null && !realDate(from)) return null;
  return {
    locationId: body.locationId.toLowerCase(), expectedUpdatedAt: body.expectedUpdatedAt as string | null,
    values: { enabled: values.enabled as boolean, ringCodeEnabled: values.ringCodeEnabled as boolean, autoLinkEnabled: values.autoLinkEnabled as boolean,
      originAutoLinkEnabled: values.originAutoLinkEnabled as boolean, includeToastOriginLeads: values.includeToastOriginLeads as boolean,
      toleranceCents: cents, tolerancePct: pct, autoLinkFromDate: from },
  };
}
