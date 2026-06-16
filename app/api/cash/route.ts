import { type NextRequest } from "next/server";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { lockLocationContext } from "@/lib/locations";
import { verifyActorPin } from "@/lib/auth-flows";
import { CASH_REPORT_BASE_LEVEL, DENOMINATION_UNITS_CENTS, sumDenominations, submitCashReport, type Denominations, type OnShiftEntry } from "@/lib/cash";
import { requireSession } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, "/api/cash");
  if (ctx instanceof Response) return ctx;
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return raw;
  const b = raw as Record<string, unknown>;

  if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) return jsonError(400, "invalid_payload", { field: "locationId" });
  if (typeof b.date !== "string" || !DATE_RE.test(b.date)) return jsonError(400, "invalid_payload", { field: "date" });
  if (typeof b.pin !== "string") return jsonError(400, "invalid_payload", { field: "pin" });
  if (!isCents(b.projectedCents)) return jsonError(400, "invalid_payload", { field: "projectedCents" });
  if (!isCents(b.cashTipsCents)) return jsonError(400, "invalid_payload", { field: "cashTipsCents" });
  if (b.countMethod !== "hand" && b.countMethod !== "denomination") return jsonError(400, "invalid_payload", { field: "countMethod" });

  let drawerTotalCents: number;
  let denominations: Denominations | null = null;
  if (b.countMethod === "denomination") {
    const d = b.denominations as Denominations | undefined;
    if (!d || typeof d !== "object") return jsonError(400, "invalid_payload", { field: "denominations" });
    denominations = {};
    for (const unit of DENOMINATION_UNITS_CENTS) {
      const q = d[String(unit)];
      if (typeof q === "number" && Number.isInteger(q) && q > 0) denominations[String(unit)] = q;
    }
    drawerTotalCents = sumDenominations(denominations);
  } else {
    if (!isCents(b.drawerTotalCents)) return jsonError(400, "invalid_payload", { field: "drawerTotalCents" });
    drawerTotalCents = b.drawerTotalCents as number;
  }
  const floatCents = isCents(b.floatCents) ? (b.floatCents as number) : 20000;
  const onShift = Array.isArray(b.onShift)
    ? (b.onShift as unknown[]).filter((e): e is OnShiftEntry => typeof e === "object" && e !== null && typeof (e as OnShiftEntry).name === "string")
    : [];
  const overShortNote = typeof b.overShortNote === "string" && b.overShortNote.trim() ? b.overShortNote.trim() : null;

  if (!lockLocationContext({ role: ctx.role, locations: ctx.locations }, b.locationId)) {
    return jsonError(403, "location_access_denied", { location_id: b.locationId });
  }
  if (ctx.level < CASH_REPORT_BASE_LEVEL) {
    return jsonError(403, "role_insufficient", { required_level: CASH_REPORT_BASE_LEVEL });
  }

  if (!(await verifyActorPin(ctx.user.id, b.pin as string))) {
    return jsonError(401, "pin_invalid", { message: "Incorrect PIN." });
  }

  const service = getServiceRoleClient();
  try {
    const result = await submitCashReport(service, {
      locationId: b.locationId as string, date: b.date as string,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      projectedCents: b.projectedCents as number, drawerTotalCents, floatCents,
      countMethod: b.countMethod as "hand" | "denomination", denominations, cashTipsCents: b.cashTipsCents as number, onShift, overShortNote,
    });
    if (!result.ok && result.reason === "closing_finalized") {
      return jsonError(409, "closing_finalized", { message: "Today's closing is finalized — the cash deposit is locked." });
    }
    if (!result.ok) return jsonError(400, "cash_submit_failed", {});
    return jsonOk({ id: result.id });
  } catch (err) {
    console.error("[/api/cash] failed:", err instanceof Error ? err.message : err);
    return jsonError(500, "internal_error", { message: "cash report write failed" });
  }
}
