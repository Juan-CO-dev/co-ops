import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, token, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { startSkuSwap, loadLiveSwapsForItem } from "@/lib/catalog/swap-vendor";
import { parseSwapRequest } from "@/lib/catalog/swap-shared";
import { assertSameOrigin } from "@/lib/portal/csrf";
export async function POST(req: NextRequest, { params }: {
    params: Promise<{
        id: string;
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
        if (!token(raw.previewToken))
            return catalogRefusal(ctx, 400, "invalid_payload", { field: "previewToken" });
        const result = await startSkuSwap(ctx, parsed.request, raw.previewToken);
        return jsonOk({ ...result }, 201);
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
export async function GET(req: NextRequest, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const ctx = await requireSession(req, req.nextUrl.pathname);
    if (ctx instanceof Response)
        return ctx;
    const { id } = await params;
    if (!uuid(id))
        return catalogRefusal(ctx, 404, "not_found");
    const shopId = req.nextUrl.searchParams.get("shopId");
    if (!uuid(shopId))
        return catalogRefusal(ctx, 400, "invalid_payload", { field: "shopId" });
    try {
        return jsonOk({ swaps: await loadLiveSwapsForItem(ctx, id, shopId) });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
