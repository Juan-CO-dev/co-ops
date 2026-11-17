import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { vendorImportScopeAllowed } from "@/lib/vendor-import-shared/levels";
import { getRoleLevel } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { isZip } from "@/lib/vendor-import-xlsx";
import { MAX_IMPORT_BYTES, stageVendorImport, VendorImportError, VENDOR_IMPORT_STAGE_MIN } from "@/lib/vendor-import";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  let form: FormData;
  try { form = await req.formData(); }
  catch { return jsonError(400, "invalid_payload"); }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "invalid_payload");
  if (file.size > MAX_IMPORT_BYTES) return jsonError(413, "too_large");
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/vendors/${id}/import`);
  if (ctx instanceof Response) return ctx;
  if (getRoleLevel(ctx.user.role) < VENDOR_IMPORT_STAGE_MIN) return jsonError(403, "forbidden");
  const location = form.get("locationId");
  if (location !== null && typeof location !== "string") return jsonError(400, "invalid_payload");
  if (!vendorImportScopeAllowed({ role: ctx.user.role, locations: ctx.locations }, location || null, "stage")) return jsonError(403, "forbidden");
  try {
    // Content sniff, never the name: a ZIP (an .xlsx workbook) goes to the library as bytes; anything
    // else is text, decoded exactly as File.text() does.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = isZip(bytes) ? { name: file.name, bytes } : { name: file.name, text: new TextDecoder().decode(bytes) };
    return jsonOk({ ...await stageVendorImport(ctx, id, upload, location || null) });
  } catch (e) {
    if (e instanceof VendorImportError) return jsonError(e.status, e.code);
    throw e;
  }
}
