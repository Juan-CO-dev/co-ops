import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { reconcileNewSandwich } from "@/lib/catalog/new-sandwich";

export async function POST(req: NextRequest) {
  const ctx = await requireSession(req, req.nextUrl.pathname);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < 7 || ctx.user.role === "social_media_mgr") return catalogRefusal(ctx, 403, "forbidden");
  const raw = await parseJsonBody(req);
  if (raw instanceof Response) return catalogRefusal(ctx, 400, "invalid_json");
  if (!objectBody(raw)) return catalogRefusal(ctx, 400, "invalid_payload");
  try {
    return jsonOk(await reconcileNewSandwich(ctx, raw));
  } catch (error) {
    return catalogError(ctx, error);
  }
}
