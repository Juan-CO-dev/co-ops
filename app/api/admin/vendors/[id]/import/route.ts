import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { jsonError, jsonOk } from "@/lib/api-helpers";
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
  try {
    return jsonOk({ ...await stageVendorImport(ctx, id, { name: file.name, text: await file.text() }) });
  } catch (e) {
    if (e instanceof VendorImportError) return jsonError(e.status, e.code);
    throw e;
  }
}
