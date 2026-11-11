/**
 * The PUBLIC /order/start intake parser (pure; moved out of app/api/portal/magic-link/request/route.ts
 * in build 2 so it can be pinned). Coerces a JSON payload into a DraftIntake — shape only:
 * createDraftFromIntake re-validates the location UUID + re-derives ALL pricing at consume time;
 * nothing here is trusted for money.
 *
 * It NEVER emits `pipelineId`: only the Meta worker sets that field, on a token it mints itself
 * (A1). A public caller cannot steer a draft onto an existing lead — the returned type says so.
 */

import type { DraftIntake } from "./draft";

// String-length caps so a crafted intake can't store a multi-MB blob on the (anon-reachable,
// never-swept) token table (A-H4). Trim + truncate rather than reject, so a legit-but-long note
// still produces a usable order.
const CAP_SHORT = 200; // names, company, phone, window, type, event name, door
const CAP_ADDR = 500; // delivery address
const CAP_NOTES = 2000; // dietary & allergen notes
const MAX_HEADCOUNT = 100000;
const MAX_PRESELECT = 40; // mirrors MAX_CART_LINES; caps the anon-reachable token payload (A-H4)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicDraftIntake = Omit<DraftIntake, "pipelineId">;

/** ⑤ storefront carry-through: validate the pre-selection (item+qty). Drop malformed entries —
 *  never reject the whole intake (the draft just seeds fewer/no lines; createDraftFromIntake
 *  re-resolves + re-prices every ref server-side). Returns null when nothing valid remains. */
function parsePreselect(v: unknown): Array<{ menuItemId?: string; itemId?: string; sizeId?: string; packageId?: string; quantity: number }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ menuItemId?: string; itemId?: string; sizeId?: string; packageId?: string; quantity: number }> = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const menuItemId = typeof o.menuItemId === "string" && UUID_RE.test(o.menuItemId) ? o.menuItemId : undefined;
    const itemId = typeof o.itemId === "string" && UUID_RE.test(o.itemId) ? o.itemId : undefined;
    const packageId = typeof o.packageId === "string" && UUID_RE.test(o.packageId) ? o.packageId : undefined;
    if ([menuItemId, itemId, packageId].filter((r) => r !== undefined).length !== 1) continue; // exactly one ref
    const q = o.quantity;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > 99) continue;
    // A sized item may carry the chosen size (item lines only); a package carries no options from
    // marketing (unconfigured) — the build page configures it. createDraftFromIntake re-resolves both.
    const sizeId = typeof o.sizeId === "string" && UUID_RE.test(o.sizeId) ? o.sizeId : undefined;
    out.push(
      packageId ? { packageId, quantity: q }
      : menuItemId ? { menuItemId, quantity: q }
      : { itemId, quantity: q, ...(sizeId ? { sizeId } : {}) },
    );
    if (out.length >= MAX_PRESELECT) break;
  }
  return out.length > 0 ? out : null;
}

export function parsePublicIntake(raw: unknown): PublicDraftIntake | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const locationId = typeof o.locationId === "string" ? o.locationId : "";
  const contactName = typeof o.contactName === "string" ? o.contactName.trim().slice(0, CAP_SHORT) : "";
  if (!locationId || !contactName) return null;
  const cap = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length > 0 ? t.slice(0, max) : null;
  };
  const headcount =
    typeof o.headcount === "number" && Number.isInteger(o.headcount) && o.headcount >= 0 && o.headcount <= MAX_HEADCOUNT
      ? o.headcount
      : null;
  // An explicit allowlist of fields: `pipelineId` (and anything else unknown) is dropped here.
  return {
    locationId,
    contactName,
    company: cap(o.company, CAP_SHORT),
    eventDate: cap(o.eventDate, 40),
    headcount,
    isDelivery: o.isDelivery === true,
    deliveryAddress: cap(o.deliveryAddress, CAP_ADDR),
    contactPhone: cap(o.contactPhone, CAP_SHORT),
    timeWindow: cap(o.timeWindow, CAP_SHORT),
    eventType: cap(o.eventType, CAP_SHORT),
    dietaryNotes: cap(o.dietaryNotes, CAP_NOTES),
    eventName: cap(o.eventName, CAP_SHORT),
    dropoffDoor: cap(o.dropoffDoor, CAP_SHORT),
    geoLat: typeof o.geoLat === "number" && Number.isFinite(o.geoLat) && Math.abs(o.geoLat) <= 90 ? o.geoLat : null,
    geoLng: typeof o.geoLng === "number" && Number.isFinite(o.geoLng) && Math.abs(o.geoLng) <= 180 ? o.geoLng : null,
    fulfillmentRouted: o.fulfillmentRouted === true,
    preselect: parsePreselect(o.preselect),
  };
}
