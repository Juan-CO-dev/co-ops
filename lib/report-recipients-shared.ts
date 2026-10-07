/**
 * Report recipients — client-safe validation and vocabulary (zero I/O). The writer is
 * lib/report-recipients.ts; the admin page is /admin/report-recipients.
 *
 * Spec: "Report recipients admin page (level 9+ to manage externals; GM can view): internal
 * role-based recipients are automatic; EXTERNAL recipients = email + package(s) + cadence + format.
 * Accountant row created with email EMPTY = disabled until filled." 0220's CHECK makes the last
 * sentence a database fact; this module refuses the same thing first with a named code.
 */
import { DIGEST_DELIVERY_MODES, parseHhMm, type DigestDeliveryMode } from "@/lib/report-digests-shared";

export const RECIPIENTS_VIEW_MIN = 7;
export const RECIPIENTS_MANAGE_MIN = 9;

export const PACKAGE_SECTIONS = ["sales", "cash", "catering", "purchases", "waste", "inventory"] as const;
export const PACKAGE_CADENCES = ["daily_close", "weekly_mon", "monthly_1st"] as const;
export const PACKAGE_FORMATS = ["csv", "pdf"] as const;
export type PackageSection = (typeof PACKAGE_SECTIONS)[number];
export type PackageCadence = (typeof PACKAGE_CADENCES)[number];
export type PackageFormat = (typeof PACKAGE_FORMATS)[number];

export interface RecipientInput {
  id: string | null;
  kind: "internal" | "external";
  userId: string | null;
  email: string | null;
  displayName: string;
  active: boolean;
  cateringDigest: boolean;
  shopDigest: boolean;
  locationIds: string[] | null;
  packages: PackageSection[];
  cadence: PackageCadence | null;
  formats: PackageFormat[];
}

export type RecipientInputError =
  | "invalid_payload" | "user_required" | "email_invalid" | "email_required_to_enable"
  | "external_no_digest" | "invalid_location" | "invalid_package" | "cadence_required";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function strArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v as string[] : null;
}

/** Normalises and validates a POSTed recipient. Emails are lowercased (AGENTS.md: lowercase at insert). */
export function validateRecipientInput(raw: unknown): { ok: true; value: RecipientInput } | { ok: false; code: RecipientInputError } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const r = raw as Record<string, unknown>;
  if (r.kind !== "internal" && r.kind !== "external") return { ok: false, code: "invalid_payload" };
  if (r.id !== undefined && r.id !== null && (typeof r.id !== "string" || !UUID.test(r.id))) return { ok: false, code: "invalid_payload" };
  for (const k of ["active", "cateringDigest", "shopDigest"]) if (typeof r[k] !== "boolean") return { ok: false, code: "invalid_payload" };
  if (typeof r.displayName !== "string") return { ok: false, code: "invalid_payload" };
  const displayName = r.displayName.trim();
  if (displayName.length < 1 || displayName.length > 120) return { ok: false, code: "invalid_payload" };

  const locationIds = r.locationIds === null || r.locationIds === undefined ? null : strArray(r.locationIds);
  if (r.locationIds !== null && r.locationIds !== undefined && (locationIds === null || !locationIds.every((x) => UUID.test(x)))) return { ok: false, code: "invalid_location" };
  const packages = strArray(r.packages ?? []);
  const formats = strArray(r.formats ?? ["csv", "pdf"]);
  if (!packages || !packages.every((p) => (PACKAGE_SECTIONS as readonly string[]).includes(p))) return { ok: false, code: "invalid_package" };
  if (!formats || formats.length === 0 || !formats.every((f) => (PACKAGE_FORMATS as readonly string[]).includes(f))) return { ok: false, code: "invalid_package" };
  const cadence = r.cadence === null || r.cadence === undefined || r.cadence === "" ? null : r.cadence;
  if (cadence !== null && !(PACKAGE_CADENCES as readonly unknown[]).includes(cadence)) return { ok: false, code: "invalid_package" };
  if (packages.length > 0 && cadence === null) return { ok: false, code: "cadence_required" };

  const kind = r.kind;
  const active = r.active as boolean;
  const cateringDigest = r.cateringDigest as boolean;
  const shopDigest = r.shopDigest as boolean;
  let userId: string | null = null;
  let email: string | null = null;
  if (kind === "internal") {
    if (typeof r.userId !== "string" || !UUID.test(r.userId)) return { ok: false, code: "user_required" };
    userId = r.userId;
  } else {
    if (cateringDigest || shopDigest) return { ok: false, code: "external_no_digest" };
    const e = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
    if (e !== "" && (!EMAIL.test(e) || e.length > 254)) return { ok: false, code: "email_invalid" };
    email = e === "" ? null : e;
    // The accountant rule: an external row without an email can exist, but never be active.
    if (active && email === null) return { ok: false, code: "email_required_to_enable" };
  }
  return {
    ok: true,
    value: {
      id: (r.id as string | undefined) ?? null, kind, userId, email, displayName, active, cateringDigest, shopDigest,
      locationIds: locationIds ? [...new Set(locationIds)] : null,
      packages: [...new Set(packages)] as PackageSection[], cadence: cadence as PackageCadence | null,
      formats: [...new Set(formats)] as PackageFormat[],
    },
  };
}

export interface SettingsPatch {
  mode?: DigestDeliveryMode;
  cateringTimeEt?: string;
  unifiedFallbackTimeEt?: string;
  graceMinutes?: number;
}

export function validateSettingsPatch(raw: unknown): { ok: true; value: SettingsPatch } | { ok: false; code: "invalid_payload" | "invalid_time" | "invalid_mode" } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const r = raw as Record<string, unknown>;
  const out: SettingsPatch = {};
  if (r.mode !== undefined) {
    if (!(DIGEST_DELIVERY_MODES as readonly unknown[]).includes(r.mode)) return { ok: false, code: "invalid_mode" };
    out.mode = r.mode as DigestDeliveryMode;
  }
  for (const [k, field] of [["cateringTimeEt", "cateringTimeEt"], ["unifiedFallbackTimeEt", "unifiedFallbackTimeEt"]] as const) {
    if (r[k] === undefined) continue;
    if (parseHhMm(r[k]) === null) return { ok: false, code: "invalid_time" };
    out[field] = r[k] as string;
  }
  // The fallback must land inside the pinger window (03:00-22:00 ET) or it would never run.
  if (out.unifiedFallbackTimeEt !== undefined) {
    const m = parseHhMm(out.unifiedFallbackTimeEt)!;
    if (m < 180 || m >= 22 * 60) return { ok: false, code: "invalid_time" };
  }
  if (out.cateringTimeEt !== undefined) {
    const m = parseHhMm(out.cateringTimeEt)!;
    if (m < 180 || m >= 22 * 60) return { ok: false, code: "invalid_time" };
  }
  if (r.graceMinutes !== undefined) {
    if (typeof r.graceMinutes !== "number" || !Number.isInteger(r.graceMinutes) || r.graceMinutes < 10 || r.graceMinutes > 720) return { ok: false, code: "invalid_payload" };
    out.graceMinutes = r.graceMinutes;
  }
  if (Object.keys(out).length === 0) return { ok: false, code: "invalid_payload" };
  return { ok: true, value: out };
}

/** The settings rows a patch writes (report_settings key → JSON value). */
export function settingsRows(patch: SettingsPatch): Array<{ key: string; value: string | number }> {
  const rows: Array<{ key: string; value: string | number }> = [];
  if (patch.mode !== undefined) rows.push({ key: "digest_delivery_mode", value: patch.mode });
  if (patch.cateringTimeEt !== undefined) rows.push({ key: "catering_digest_time_et", value: patch.cateringTimeEt });
  if (patch.unifiedFallbackTimeEt !== undefined) rows.push({ key: "unified_fallback_time_et", value: patch.unifiedFallbackTimeEt });
  if (patch.graceMinutes !== undefined) rows.push({ key: "digest_watch_grace_minutes", value: patch.graceMinutes });
  return rows;
}
