import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonError, jsonOk } from "@/lib/api-helpers";
import { listCateringInbox, CateringInboxError } from "@/lib/catering/inbox";

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/catering/inbox");
  if (ctx instanceof Response) return ctx;
  try {
    return jsonOk({ inbox: await listCateringInbox(ctx, req.nextUrl.searchParams.get("assignee") ?? undefined) });
  } catch (error) {
    if (error instanceof CateringInboxError) return jsonError(error.status, error.code);
    throw error;
  }
}
