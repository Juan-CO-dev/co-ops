import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { createCatalogItem } from "@/lib/catalog/new-item";
import { parseNewItemRequest } from "@/lib/catalog/new-item-shared";
import { serverT } from "@/lib/i18n/server";
export async function POST(req: NextRequest) {
    const ctx = await requireSession(req, req.nextUrl.pathname);
    if (ctx instanceof Response)
        return ctx;
    if (ctx.level < 7 || ctx.user.role === "social_media_mgr")
        return catalogRefusal(ctx, 403, "forbidden");
    const su = assertStepUp(ctx, "E");
    if (!su.ok)
        return catalogRefusal(ctx, 403, su.code);
    const raw = await parseJsonBody(req);
    if (raw instanceof Response)
        return catalogRefusal(ctx, 400, "invalid_json");
    if (!objectBody(raw))
        return catalogRefusal(ctx, 400, "invalid_payload");
    try {
        const parsed = parseNewItemRequest(raw);
        if (!parsed.ok)
            return catalogRefusal(ctx, 400, parsed.code, { field: parsed.field });
        const result = await createCatalogItem(ctx, parsed.request);
        return jsonOk({ ...result, ...(result.replayed ? { message: serverT(ctx.user.language, "catalog.new_item.replayed") } : {}) }, result.replayed ? 200 : 201);
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
