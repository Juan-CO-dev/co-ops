import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { previewBackToNormal } from "@/lib/catalog/swap-vendor";
export async function POST(req: NextRequest, { params }: {
    params: Promise<{
        swapId: string;
    }>;
}) {
    const ctx = await requireSession(req, req.nextUrl.pathname);
    if (ctx instanceof Response)
        return ctx;
    if (ctx.level < 7 || ctx.user.role === "social_media_mgr")
        return catalogRefusal(ctx, 403, "forbidden");
    const { swapId } = await params;
    if (!uuid(swapId))
        return catalogRefusal(ctx, 404, "not_found");
    const raw = await parseJsonBody(req);
    if (raw instanceof Response)
        return catalogRefusal(ctx, 400, "invalid_json");
    if (!objectBody(raw))
        return catalogRefusal(ctx, 400, "invalid_payload");
    try {
        const result = await previewBackToNormal(ctx, swapId);
        return jsonOk({ preview: result });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
