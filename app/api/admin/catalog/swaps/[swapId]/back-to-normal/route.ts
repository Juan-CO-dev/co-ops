import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, token, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { endSkuSwap } from "@/lib/catalog/swap-vendor";
import { assertSameOrigin } from "@/lib/portal/csrf";
export async function POST(req: NextRequest, { params }: {
    params: Promise<{
        swapId: string;
    }>;
}) {
    const origin = assertSameOrigin(req);
    if (origin) return origin;
    const ctx = await requireSession(req, req.nextUrl.pathname);
    if (ctx instanceof Response)
        return ctx;
    if (ctx.level < 7 || ctx.user.role === "social_media_mgr")
        return catalogRefusal(ctx, 403, "forbidden");
    const su = assertStepUp(ctx, "E");
    if (!su.ok)
        return catalogRefusal(ctx, 403, su.code);
    const { swapId } = await params;
    if (!uuid(swapId))
        return catalogRefusal(ctx, 404, "not_found");
    const raw = await parseJsonBody(req);
    if (raw instanceof Response)
        return catalogRefusal(ctx, 400, "invalid_json");
    if (!objectBody(raw))
        return catalogRefusal(ctx, 400, "invalid_payload");
    try {
        if (!token(raw.previewToken))
            return catalogRefusal(ctx, 400, "invalid_payload", { field: "previewToken" });
        const result = await endSkuSwap(ctx, swapId, raw.previewToken);
        return jsonOk({ ...result });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
