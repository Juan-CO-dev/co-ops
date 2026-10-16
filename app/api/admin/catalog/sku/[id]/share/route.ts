import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, token, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { shareSkuWithAllShops } from "@/lib/catalog/share";
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
        if (!uuid(raw.expectedOwner) || !token(raw.previewToken))
            return catalogRefusal(ctx, 400, "invalid_payload");
        const result = await shareSkuWithAllShops(ctx, { skuId: id, expectedOwner: raw.expectedOwner, previewToken: raw.previewToken });
        return jsonOk({ shared: true });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
