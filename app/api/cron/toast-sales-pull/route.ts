// GET nightly Toast sales pull for all Toast-connected locations (Vercel Cron).
// Auth: x-cron-secret header (or Vercel Cron's Authorization: Bearer CRON_SECRET)
// must match env CRON_SECRET via constant-time compare. 503 no-op when unset
// (dormant-safe); locations without a Toast GUID are skipped by the lib.
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { pullSalesForAllLocations } from "@/lib/catering/toast-sales";

function secretOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = req.headers.get("x-cron-secret")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Yesterday in the operational timezone (business dates close overnight). */
function yesterdayYmd(): string {
  const nowEt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  nowEt.setDate(nowEt.getDate() - 1);
  return nowEt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return jsonError(503, "cron_disabled");
  if (!secretOk(req)) return jsonError(401, "unauthorized");
  const businessDate = req.nextUrl.searchParams.get("date") ?? yesterdayYmd();
  const results = await pullSalesForAllLocations(businessDate);
  return jsonOk({ businessDate, results });
}
