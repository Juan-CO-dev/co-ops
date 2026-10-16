import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { createNewSandwich } from "@/lib/catalog/new-sandwich";
import { parseNewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
import { assertSameOrigin } from "@/lib/portal/csrf";
export async function POST(req: NextRequest) {
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
    const raw = await parseJsonBody(req);
    if (raw instanceof Response)
        return catalogRefusal(ctx, 400, "invalid_json");
    if (!objectBody(raw))
        return catalogRefusal(ctx, 400, "invalid_payload");
    try {
        const parsed = parseNewSandwichRequest(raw);
        if (!parsed.ok)
            return catalogRefusal(ctx, 400, parsed.code, parsed.position === undefined ? {} : { line: { position: parsed.position, reason: parsed.code } });
        const result = await createNewSandwich(ctx, parsed.request);
        return jsonOk({ ...result }, 201);
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
