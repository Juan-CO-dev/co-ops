/**
 * POST /api/admin/catalog/sku/[id]/pack/restore — RETIRED as a write (audit W18/B107).
 * Restore from the History tab now goes through the preview (kind `pack_restore`) and
 * /pack/apply with `restoredFromVersionId`, so the par keep-or-convert rows a pack change offers
 * are offered for a Restore too. This route stays for an old tab and refuses 409 `preview_required`
 * (after the same origin, session, floor and Tier E checks it always had), because a Restore that
 * skips the conversion is the bug. Nothing is written here.
 */
import { type NextRequest } from "next/server";
import { assertSameOrigin } from "@/lib/portal/csrf";
import { requireSession } from "@/lib/session";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, parseJsonBody } from "@/lib/api-helpers";
import { SHOP_VERSION_WRITE_MIN } from "@/lib/sku-versions-shared";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const { id } = await params;
  if (!UUID_RE.test(id)) return jsonError(404, "not_found");
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/catalog/sku/${id}/pack/restore`);
  if (ctx instanceof Response) return ctx;
  if (ctx.level < SHOP_VERSION_WRITE_MIN) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "E");
  if (!su.ok) return jsonError(403, su.code);
  return jsonError(409, "preview_required");
}
