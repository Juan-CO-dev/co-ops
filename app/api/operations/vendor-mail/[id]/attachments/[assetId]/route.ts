import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { VendorMailError } from "@/lib/vendor-mail";
import { signVendorMailAsset } from "@/lib/vendor-mail-assets";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  const ctx = await requireSession(req, "/api/operations/vendor-mail");
  if (ctx instanceof Response) return ctx;
  try {
    const { id, assetId } = await params;
    return jsonOk({ asset: await signVendorMailAsset(ctx, id, assetId) });
  } catch (error) {
    if (error instanceof VendorMailError) return jsonError(error.status, error.code);
    throw error;
  }
}

