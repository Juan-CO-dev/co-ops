/**
 * Demand signals (item 4 PR 2 / PR 5): WHAT A PERSON SENDS, pure and import-free: the source mark and a manual
 * event. The pages' forms (client components) validate with the SAME rules the routes parse with. Re-exported
 * by sources-shared.ts. 0343's writers (demand_source_mark, demand_event_save) re-check every rule on the rows.
 */
const ID = /^[a-z0-9_]{2,40}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A mark's note: required, and bounded (0343 holds the same bounds). */
export const SOURCE_MARK_NOTE_MIN = 3;
export const SOURCE_MARK_NOTE_MAX = 500;
export const DEMAND_EVENT_TITLE_MIN = 2;
export const DEMAND_EVENT_TITLE_MAX = 120;

export interface SourceMarkInput { sourceId: string; definitionHash: string; status: "verified" | "revoked"; note: string }
/** The mark request: the source, THE DEFINITION THE PERSON READ, the new status and why. */
export function parseSourceMark(body: unknown): SourceMarkInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const sourceId = str(b.sourceId), definitionHash = str(b.definitionHash), status = str(b.status), note = str(b.note)?.trim();
  if (!sourceId || !ID.test(sourceId) || !definitionHash || !HASH.test(definitionHash)) return null;
  if (status !== "verified" && status !== "revoked") return null;
  if (!note || note.length < SOURCE_MARK_NOTE_MIN || note.length > SOURCE_MARK_NOTE_MAX) return null;
  return { sourceId, definitionHash, status, note };
}

export const DEMAND_EVENT_CATEGORIES = ["weather_alert", "government_closure", "federal_holiday", "school_closure", "transit_disruption",
  "street_closure", "sports_game", "concert_show", "convention", "race", "festival_parade", "demonstration", "other"] as const;
export type DemandEventCategory = (typeof DEMAND_EVENT_CATEGORIES)[number];
export const DEMAND_EVENT_IMPACTS = ["up", "down", "unknown"] as const;
export type DemandEventImpact = (typeof DEMAND_EVENT_IMPACTS)[number];
export const DEMAND_EVENT_MAX_SPAN_DAYS = 60;

export interface DemandEventInput {
  /** null = every shop (MoO+ only). */
  locationId: string | null;
  category: DemandEventCategory;
  validFrom: string;
  validTo: string;
  startLocal: string | null;
  endLocal: string | null;
  title: string;
  impact: DemandEventImpact;
  note: string | null;
  /** The entry being corrected (its current head), or null for a new one. */
  supersedesId: string | null;
  retract: boolean;
}
const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;
const realDate = (ymd: string) => YMD.test(ymd) && new Date(dayNumber(ymd) * 86_400_000).toISOString().slice(0, 10) === ymd;

/** A manual event as PR 5's form will send it (0343 demand_event_save re-checks every rule). */
export function parseDemandEvent(body: unknown): DemandEventInput | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const supersedesId = b.supersedesId == null ? null : str(b.supersedesId);
  if (b.supersedesId != null && (!supersedesId || !UUID.test(supersedesId))) return null;
  const retract = b.retract === true;
  if (retract) {
    if (!supersedesId) return null;
    const note = str(b.note)?.trim() || null;
    if (note && note.length > 500) return null;
    return { locationId: null, category: "other", validFrom: "", validTo: "", startLocal: null, endLocal: null, title: "", impact: "unknown", note, supersedesId, retract };
  }
  const locationId = b.locationId == null ? null : str(b.locationId);
  if (b.locationId != null && (!locationId || !UUID.test(locationId))) return null;
  const category = str(b.category) as DemandEventCategory | null;
  if (!category || !DEMAND_EVENT_CATEGORIES.includes(category)) return null;
  const validFrom = str(b.validFrom), validTo = str(b.validTo) ?? validFrom;
  if (!validFrom || !validTo || !realDate(validFrom) || !realDate(validTo)) return null;
  const span = dayNumber(validTo) - dayNumber(validFrom);
  if (span < 0 || span > DEMAND_EVENT_MAX_SPAN_DAYS) return null;
  const startLocal = b.startLocal == null ? null : str(b.startLocal), endLocal = b.endLocal == null ? null : str(b.endLocal);
  if ((b.startLocal != null && (!startLocal || !TIME.test(startLocal))) || (b.endLocal != null && (!endLocal || !TIME.test(endLocal)))) return null;
  if (startLocal && endLocal && span === 0 && endLocal <= startLocal) return null;
  const title = str(b.title)?.trim();
  if (!title || title.length < DEMAND_EVENT_TITLE_MIN || title.length > DEMAND_EVENT_TITLE_MAX) return null;
  const impact = (b.impact == null ? "unknown" : str(b.impact)) as DemandEventImpact | null;
  if (!impact || !DEMAND_EVENT_IMPACTS.includes(impact)) return null;
  const note = b.note == null ? null : str(b.note)?.trim() || null;
  if (note && note.length > 500) return null;
  return { locationId, category, validFrom, validTo, startLocal, endLocal, title, impact, note, supersedesId, retract };
}
