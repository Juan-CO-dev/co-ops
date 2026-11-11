import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { getVendorMailMessage, VendorMailError } from "@/lib/vendor-mail";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSession(req, "/api/operations/vendor-mail");
  if (ctx instanceof Response) return ctx;
  try {
    return jsonOk({ message: await getVendorMailMessage(ctx, (await params).id) });
  } catch (error) {
    if (error instanceof VendorMailError) return jsonError(error.status, error.code);
    throw error;
  }
}

