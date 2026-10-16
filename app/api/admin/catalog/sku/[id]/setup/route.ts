import { serverT } from "@/lib/i18n/server";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { setUpItemAtShop } from "@/lib/catalog/new-item";
import { parseSetupStep } from "@/lib/catalog/new-item-shared";
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
        if (objectBody(raw.step) && raw.step.kind === "use_in" && (!Object.hasOwn(raw.step, "expectedVersionId") || !Object.hasOwn(raw.step, "basedOnVersionId")))
            return catalogRefusal(ctx, 400, "invalid_payload", { field: "version" });
        const parsed = parseSetupStep(raw);
        if (!parsed.ok)
            return catalogRefusal(ctx, 400, "invalid_payload", { field: parsed.field });
        const result = await setUpItemAtShop(ctx, { skuId: id, shopId: parsed.shopId, step: parsed.step });
        return jsonOk({ ...result, ...(result.step === "guide_line" && result.detail.lineSaved === null ? { messageKey: "catalog.setup.guide_unconfirmed", message: serverT(ctx.user.language, "catalog.setup.guide_unconfirmed") } : {}) });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
