import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { listVendorMail, VendorMailError } from "@/lib/vendor-mail";
import type { VendorMailStatus } from "@/lib/vendor-mail-shared";

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/operations/vendor-mail");
  if (ctx instanceof Response) return ctx;
  try {
    const p = req.nextUrl.searchParams;
    if (p.has("stale") && !["true", "false"].includes(p.get("stale")!)) throw new VendorMailError(400, "invalid_payload");
    return jsonOk({ inbox: await listVendorMail(ctx, {
      locationId: p.get("location") ?? undefined, vendorId: p.get("vendor") ?? undefined,
      status: (p.get("status") ?? undefined) as VendorMailStatus | undefined,
      receivedFrom: p.get("from") ?? undefined, receivedTo: p.get("to") ?? undefined,
      search: p.get("search") ?? undefined, stale: p.has("stale") ? p.get("stale") === "true" : undefined,
    }) });
  } catch (error) {
    if (error instanceof VendorMailError) return jsonError(error.status, error.code);
    throw error;
  }
}
