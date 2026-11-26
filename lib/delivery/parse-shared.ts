/**
 * Catering delivery (D2) — the strict request parsers of the delivery routes. Zero I/O, no clock. Client-safe.
 *
 * ONE RULE FOR EVERY BODY: a plain object with EXACTLY the keys listed (an unknown key is a refusal, never ignored);
 * ids are uuids, made canonical lowercase here; money is integer cents; text is trimmed, an empty one is null; a time a
 * person typed is an ET WALL time (`{ date: "YYYY-MM-DD", time: "HH:MM" }`) turned into an instant by the shared
 * resolver (`etWallClockToUtcIso`: DST-correct, never a fabricated instant). A parser answers null for anything else;
 * the route answers 400 `invalid_request` (`invalid_settings` for the settings save) and never reaches the lib.
 *
 * Every write names what the person SAW: `expectedShopId` (the lead's shop on the panel) on every job-level write,
 * `expectedStatus` on a status, `correctsId` (the cost row being corrected) on a correction, `expectedHeadId` (the head
 * of the gratuity chain) on a gratuity correction, `expectedUpdatedAt` on the settings. The database compares them under its locks; these parsers only make sure they are present and well formed.
 */
import { etWallClockToUtcIso } from "@/lib/operational-day";
import { isDeliveryStatus, MANUAL_STATUSES, type ManualDeliveryStatus } from "./status-shared";
import {
  DELIVERY_COST_COMPONENTS, MAX_DELIVERY_NOTE, MAX_EXTERNAL_REF, MAX_MANUAL_PROVIDERS, MAX_PROVIDER_LABEL,
  type DeliveryBookedVia, type DeliveryCostComponent, type DeliveryStatus,
} from "./types-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** $1,000,000.00: far above any courier bill, far inside a Postgres integer. */
export const MAX_DELIVERY_CENTS = 100_000_000;

/** A uuid in canonical lowercase, or null. */
export function parseDeliveryId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const id = v.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

type Body = Record<string, unknown>;
/** A plain object holding every `required` key and nothing outside `required` + `optional`. */
function exact(raw: unknown, required: readonly string[], optional: readonly string[] = []): Body | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Body;
  const keys = Object.keys(body);
  if (keys.some((k) => !required.includes(k) && !optional.includes(k))) return null;
  if (required.some((k) => !Object.hasOwn(body, k))) return null;
  return body;
}
const MISSING = Symbol("missing");
/** Trimmed text of at most `max` characters; null / absent / empty = null; anything else is MISSING (a refusal). */
function text(v: unknown, max: number): string | null | typeof MISSING {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return MISSING;
  const t = v.trim();
  if (t.length > max) return MISSING;
  return t === "" ? null : t;
}
/** The lead's shop as the person saw it: a uuid, or null for a lead with no shop. */
function shop(v: unknown): string | null | typeof MISSING {
  if (v === null) return null;
  return parseDeliveryId(v) ?? MISSING;
}
function cents(v: unknown, min: number, max: number): number | typeof MISSING {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max ? v : MISSING;
}
/** An ET wall time a person typed → the instant. null = not given. */
function wall(v: unknown): string | null | typeof MISSING {
  if (v === null || v === undefined) return null;
  const w = exact(v, ["date", "time"]);
  if (!w || typeof w.date !== "string" || typeof w.time !== "string" || !/^\d{2}:\d{2}$/.test(w.time)) return MISSING;
  // A real calendar day (2026-02-30 is refused, never rolled forward).
  const day = new Date(`${w.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== w.date) return MISSING;
  return etWallClockToUtcIso(w.date, w.time) ?? MISSING;
}

export interface RecordJobBody {
  expectedShopId: string | null; providerLabel: string; externalRef: string | null; bookedVia: Exclude<DeliveryBookedVia, "co_ops_api">;
  pickupAt: string | null; dropoffAt: string | null; costCents: number | null; note: string | null;
}
/** POST …/delivery. `bookedVia` is never `co_ops_api`: nothing books through an API. */
export function parseRecordJob(raw: unknown): RecordJobBody | null {
  const b = exact(raw, ["expectedShopId", "providerLabel", "bookedVia"], ["externalRef", "pickupAt", "dropoffAt", "costCents", "note"]);
  if (!b) return null;
  const expectedShopId = shop(b.expectedShopId), label = text(b.providerLabel, MAX_PROVIDER_LABEL), externalRef = text(b.externalRef, MAX_EXTERNAL_REF);
  const pickupAt = wall(b.pickupAt), dropoffAt = wall(b.dropoffAt), note = text(b.note, MAX_DELIVERY_NOTE);
  const costCents = b.costCents === null || b.costCents === undefined ? null : cents(b.costCents, 0, MAX_DELIVERY_CENTS);
  if (b.bookedVia !== "manual" && b.bookedVia !== "provider_native") return null;
  if (expectedShopId === MISSING || label === MISSING || label === null || externalRef === MISSING || pickupAt === MISSING || dropoffAt === MISSING
    || note === MISSING || costCents === MISSING) return null;
  return { expectedShopId, providerLabel: label, externalRef, bookedVia: b.bookedVia, pickupAt, dropoffAt, costCents, note };
}

export interface RecordStatusBody {
  expectedShopId: string | null; expectedStatus: DeliveryStatus; status: ManualDeliveryStatus; occurredAt: string | null; note: string | null;
}
/** POST …/delivery/[jobId]/status. `occurredAt` is information only (the database orders by recording). */
export function parseRecordStatus(raw: unknown): RecordStatusBody | null {
  const b = exact(raw, ["expectedShopId", "expectedStatus", "status"], ["occurredAt", "note"]);
  if (!b) return null;
  const expectedShopId = shop(b.expectedShopId), occurredAt = wall(b.occurredAt), note = text(b.note, MAX_DELIVERY_NOTE);
  if (!isDeliveryStatus(b.expectedStatus) || typeof b.status !== "string" || !(MANUAL_STATUSES as readonly string[]).includes(b.status)) return null;
  if (expectedShopId === MISSING || occurredAt === MISSING || note === MISSING) return null;
  return { expectedShopId, expectedStatus: b.expectedStatus, status: b.status as ManualDeliveryStatus, occurredAt, note };
}

export interface RecordCostBody {
  expectedShopId: string | null; component: DeliveryCostComponent; amountCents: number;
  /** Null = a first cost (no password). A uuid = a correction of that row (Tier A, and the note is the reason). */
  correctsId: string | null; note: string | null;
}
/** POST …/delivery/[jobId]/cost. The sign rule (a credit is never positive) is the database's `bad_amount`. */
export function parseRecordCost(raw: unknown): RecordCostBody | null {
  const b = exact(raw, ["expectedShopId", "component", "amountCents"], ["correctsId", "note"]);
  if (!b) return null;
  const expectedShopId = shop(b.expectedShopId), amountCents = cents(b.amountCents, -MAX_DELIVERY_CENTS, MAX_DELIVERY_CENTS), note = text(b.note, MAX_DELIVERY_NOTE);
  const correctsId = b.correctsId === null || b.correctsId === undefined ? null : parseDeliveryId(b.correctsId) ?? MISSING;
  if (typeof b.component !== "string" || !(DELIVERY_COST_COMPONENTS as readonly string[]).includes(b.component)) return null;
  if (expectedShopId === MISSING || amountCents === MISSING || note === MISSING || correctsId === MISSING) return null;
  return { expectedShopId, component: b.component as DeliveryCostComponent, amountCents, correctsId, note };
}

/** POST …/delivery/[jobId]/keep-pickup. */
export function parseKeepPickup(raw: unknown): { expectedShopId: string | null; note: string | null } | null {
  const b = exact(raw, ["expectedShopId"], ["note"]);
  if (!b) return null;
  const expectedShopId = shop(b.expectedShopId), note = text(b.note, MAX_DELIVERY_NOTE);
  if (expectedShopId === MISSING || note === MISSING) return null;
  return { expectedShopId, note };
}

export interface GratuityCorrectionBody {
  expectedShopId: string | null;
  /** `recompute` = "Recalculate from the current quote"; `void` = "Remove — this delivery didn't happen". */
  mode: "recompute" | "void";
  /** The head of the order's gratuity chain as the person saw it; null = they saw none. */
  expectedHeadId: string | null;
  reason: string;
}
/**
 * POST …/delivery/gratuity (D4). Every key is required: `expectedHeadId` is an explicit null when the person saw no
 * split. A well-formed body with an empty reason is the NAMED refusal `reason_required` (the screen says "say why"),
 * never the writer; anything else malformed is null.
 */
export function parseGratuityCorrection(raw: unknown): GratuityCorrectionBody | "reason_required" | null {
  const b = exact(raw, ["expectedShopId", "mode", "expectedHeadId", "reason"]);
  if (!b) return null;
  const expectedShopId = shop(b.expectedShopId), reason = text(b.reason, MAX_DELIVERY_NOTE);
  const expectedHeadId = b.expectedHeadId === null ? null : parseDeliveryId(b.expectedHeadId) ?? MISSING;
  if (b.mode !== "recompute" && b.mode !== "void") return null;
  if (expectedShopId === MISSING || expectedHeadId === MISSING || reason === MISSING) return null;
  if (reason === null) return "reason_required";
  return { expectedShopId, mode: b.mode, expectedHeadId, reason };
}

export interface DeliverySettingsBody {
  locationId: string;
  values: { enabled: boolean; manualProviders: string[]; gratuityDriverBps: number };
  /** The `updatedAt` the person saw, passed back untouched (its microseconds are the compare-and-set); null = no row. */
  expectedUpdatedAt: string | null;
}
/** The courier list rule of `set_delivery_settings` (0356): at most 12 labels, each trimmed, 1 to 40 characters, distinct ignoring case. */
export function manualProvidersValid(list: unknown): list is string[] {
  if (!Array.isArray(list) || list.length > MAX_MANUAL_PROVIDERS) return false;
  if (list.some((l) => typeof l !== "string" || l !== l.trim() || l.length < 1 || l.length > MAX_PROVIDER_LABEL)) return false;
  return new Set((list as string[]).map((l) => l.toLowerCase())).size === list.length;
}
/** POST /api/admin/catering/delivery: ONE shop's whole row. */
export function parseDeliverySettingsSave(raw: unknown): DeliverySettingsBody | null {
  const b = exact(raw, ["locationId", "values", "expectedUpdatedAt"]);
  if (!b) return null;
  const locationId = parseDeliveryId(b.locationId);
  const v = exact(b.values, ["enabled", "manualProviders", "gratuityDriverBps"]);
  if (!locationId || !v || typeof v.enabled !== "boolean" || !manualProvidersValid(v.manualProviders)) return null;
  if (typeof v.gratuityDriverBps !== "number" || !Number.isInteger(v.gratuityDriverBps) || v.gratuityDriverBps < 0 || v.gratuityDriverBps > 10_000) return null;
  if (b.expectedUpdatedAt !== null && (typeof b.expectedUpdatedAt !== "string" || b.expectedUpdatedAt.length > 64 || !Number.isFinite(Date.parse(b.expectedUpdatedAt)))) return null;
  return { locationId, values: { enabled: v.enabled, manualProviders: [...v.manualProviders], gratuityDriverBps: v.gratuityDriverBps }, expectedUpdatedAt: b.expectedUpdatedAt };
}
