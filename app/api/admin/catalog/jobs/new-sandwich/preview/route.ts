import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { previewNewSandwich } from "@/lib/catalog/new-sandwich";
import { parseNewSandwichRequest } from "@/lib/catalog/new-sandwich-shared";
export async function POST(req: NextRequest) {
    const ctx = await requireSession(req, req.nextUrl.pathname);
    if (ctx instanceof Response)
        return ctx;
    if (ctx.level < 7 || ctx.user.role === "social_media_mgr")
        return catalogRefusal(ctx, 403, "forbidden");
    const raw = await parseJsonBody(req);
    if (raw instanceof Response)
        return catalogRefusal(ctx, 400, "invalid_json");
    if (!objectBody(raw))
        return catalogRefusal(ctx, 400, "invalid_payload");
    try {
        const parsed = parseNewSandwichRequest(raw);
        if (!parsed.ok)
            return catalogRefusal(ctx, 400, parsed.code, parsed.position === undefined ? {} : { line: { position: parsed.position, reason: parsed.code } });
        const result = await previewNewSandwich(ctx, parsed.request);
        return jsonOk({ preview: result });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
