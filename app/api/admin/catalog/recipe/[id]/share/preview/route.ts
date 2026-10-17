import { publicShareRecipePreview } from "@/lib/catalog/job-preview-shared";
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { uuid, objectBody, catalogError, catalogRefusal } from "@/app/api/admin/catalog/job-http";
import { previewShareRecipe } from "@/lib/catalog/share";
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
        return jsonOk({ preview: publicShareRecipePreview(await previewShareRecipe(ctx, id)) });
    }
    catch (error) {
        return catalogError(ctx, error);
    }
}
