import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { getCateringInboxMessage, CateringInboxError } from "@/lib/catering/inbox";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireSession(req, "/api/catering/inbox");
  if (ctx instanceof Response) return ctx;
  try {
    return jsonOk({ message: await getCateringInboxMessage(ctx, (await params).id) });
  } catch (error) {
    if (error instanceof CateringInboxError) return jsonError(error.status, error.code);
    throw error;
  }
}
