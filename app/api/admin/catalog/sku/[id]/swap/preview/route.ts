import { serverT } from "@/lib/i18n/server";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { previewSkuSwap } from "@/lib/catalog/swap-vendor";
import { parseSwapRequest } from "@/lib/catalog/swap-shared";
export async function POST(req: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const ctx = await requireSession(req, req.nextUrl.pathname);
    if (ctx instanceof Response)
        return ctx;
    if (ctx.level < 7 || ctx.user.role === "social_media_mgr")
        return catalogRefusal(ctx, 403, "forbidden");
    const { id } = await params;
    if (!uuid(id))
        return catalogRefusal(ctx, 404, "not_found");
    const raw = await parseJsonBody(req);
    if (raw instanceof Response)
        return catalogRefusal(ctx, 400, "invalid_json");
    if (!objectBody(raw))
        return catalogRefusal(ctx, 400, "invalid_payload");
    try {
        const parsed = parseSwapRequest(raw, id);
        if (!parsed.ok)
            return catalogRefusal(ctx, 400, "invalid_payload", { field: parsed.field });
        const result = await previewSkuSwap(ctx, parsed.request);
        return jsonOk({ preview: { ...result, ordering: { ...result.ordering, message: serverT(ctx.user.language, result.ordering.messageKey) } } });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
