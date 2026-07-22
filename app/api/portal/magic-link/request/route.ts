/**
 * POST /api/portal/magic-link/request — customer requests a sign-in link.
 *
 * PUBLIC (no staff auth). Constant-shape `{ok:true}` regardless of internal disposition
 * (enumeration defense — never leak whether an email exists). Honeypot + Origin/Referer
 * check are the spam/CSRF guards; the real rate-limit + allowlist gating live in
 * lib/portal/magic-link.ts requestMagicLink.
 */

import { NextRequest, NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/portal/magic-link";
import type { DraftIntake } from "@/lib/portal/draft";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { trustedClientIp } from "@/lib/client-ip";

export const runtime = "nodejs";

/** Coerce a JSON intake payload into a DraftIntake (shape only — createDraftFromIntake re-validates
 * the location UUID + re-derives ALL pricing at consume time; nothing here is trusted for money). */
// String-length caps so a crafted intake can't store a multi-MB blob on the (anon-reachable,
// never-swept) token table (A-H4). Trim + truncate rather than reject, so a legit-but-long note
// still produces a usable order.
const CAP_SHORT = 200; // names, company, phone, window, type, event name, door
const CAP_ADDR = 500; // delivery address
const CAP_NOTES = 2000; // dietary & allergen notes
const MAX_HEADCOUNT = 100000;
const MAX_PRESELECT = 40; // mirrors MAX_CART_LINES; caps the anon-reachable token payload (A-H4)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ⑤ storefront carry-through: validate the pre-selection (item+qty). Drop malformed entries —
 *  never reject the whole intake (the draft just seeds fewer/no lines; createDraftFromIntake
 *  re-resolves + re-prices every ref server-side). Returns null when nothing valid remains. */
function parsePreselect(v: unknown): Array<{ menuItemId?: string; itemId?: string; quantity: number }> | null {
  if (!Array.isArray(v)) return null;
  const out: Array<{ menuItemId?: string; itemId?: string; quantity: number }> = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const menuItemId = typeof o.menuItemId === "string" && UUID_RE.test(o.menuItemId) ? o.menuItemId : undefined;
    const itemId = typeof o.itemId === "string" && UUID_RE.test(o.itemId) ? o.itemId : undefined;
    if ((menuItemId === undefined) === (itemId === undefined)) continue; // exactly one ref
    const q = o.quantity;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > 99) continue;
    out.push(menuItemId ? { menuItemId, quantity: q } : { itemId, quantity: q });
    if (out.length >= MAX_PRESELECT) break;
  }
  return out.length > 0 ? out : null;
}

function parseIntake(raw: unknown): DraftIntake | null {
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const csrf = assertSameOrigin(req); // A-H5 — fail closed on missing/cross-site Origin
  if (csrf) return csrf;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot: bots fill hidden fields. Pretend success, do nothing.
  if (typeof body.website === "string" && body.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const ip = trustedClientIp(req); // A-M2 — platform-trusted, not the spoofable leftmost XFF
  if (typeof body.email === "string") {
    await requestMagicLink({ email: body.email, name: typeof body.name === "string" ? body.name : null, ip, intake: parseIntake(body.intake) });
  }

  // Constant shape regardless of internal disposition.
  return NextResponse.json({ ok: true });
}
