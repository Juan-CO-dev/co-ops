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

export const runtime = "nodejs";

/** Coerce a JSON intake payload into a DraftIntake (shape only — createDraftFromIntake re-validates
 * the location UUID + re-derives ALL pricing at consume time; nothing here is trusted for money). */
function parseIntake(raw: unknown): DraftIntake | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const locationId = typeof o.locationId === "string" ? o.locationId : "";
  const contactName = typeof o.contactName === "string" ? o.contactName.trim() : "";
  if (!locationId || !contactName) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
  return {
    locationId,
    contactName,
    company: str(o.company),
    eventDate: str(o.eventDate),
    headcount: typeof o.headcount === "number" && Number.isFinite(o.headcount) ? o.headcount : null,
    isDelivery: o.isDelivery === true,
    deliveryAddress: str(o.deliveryAddress),
    contactPhone: str(o.contactPhone),
    timeWindow: str(o.timeWindow),
    eventType: str(o.eventType),
    dietaryNotes: str(o.dietaryNotes),
    eventName: str(o.eventName),
    dropoffDoor: str(o.dropoffDoor),
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF: reject cross-site POSTs (a same-site fetch sends a matching Origin).
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host !== req.nextUrl.host) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "bad_origin" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Honeypot: bots fill hidden fields. Pretend success, do nothing.
  if (typeof body.website === "string" && body.website.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip");
  if (typeof body.email === "string") {
    await requestMagicLink({ email: body.email, name: typeof body.name === "string" ? body.name : null, ip, intake: parseIntake(body.intake) });
  }

  // Constant shape regardless of internal disposition.
  return NextResponse.json({ ok: true });
}
