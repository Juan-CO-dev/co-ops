import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { confirmSandwichToastLink } from "@/lib/admin/toast-map";
import { uuid, objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
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
    const su = assertStepUp(ctx, "A");
    if (!su.ok)
        return catalogRefusal(ctx, 403, su.code);
    const { id } = await params;
    if (!uuid(id))
        return catalogRefusal(ctx, 404, "not_found");
    const raw = await parseJsonBody(req);
    if (raw instanceof Response)
        return catalogRefusal(ctx, 400, "invalid_json");
    if (!objectBody(raw) || !uuid(raw.locationId) || !uuid(raw.toastItemGuid) || raw.confirmed !== true)
        return catalogRefusal(ctx, 400, "invalid_payload");
    try {
        return jsonOk({ ...await confirmSandwichToastLink(ctx, { menuItemId: id, locationId: raw.locationId, toastItemGuid: raw.toastItemGuid, confirmed: true }) });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
