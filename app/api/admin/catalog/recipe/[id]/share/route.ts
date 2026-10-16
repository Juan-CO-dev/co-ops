import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, token, uuidList, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { shareRecipeWithAllShops } from "@/lib/catalog/share";
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
        if (!uuid(raw.expectedOwner) || !token(raw.previewToken) || !uuidList(raw.shareSkuIds) || !uuidList(raw.shareItemIds))
            return catalogRefusal(ctx, 400, "invalid_payload");
        const result = await shareRecipeWithAllShops(ctx, { recipeId: id, expectedOwner: raw.expectedOwner, previewToken: raw.previewToken, shareSkuIds: raw.shareSkuIds, shareItemIds: raw.shareItemIds });
        return jsonOk({ ...result });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
