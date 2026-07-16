// GET list (AGM+ ≥6, no step-up) · POST create (AGM+ ≥6, Tier B)
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import {
  loadFaqs,
  loadFaqLocations,
  createFaq,
  AdminCateringError,
  type CreateFaqInput,
} from "@/lib/admin/catering/faq";

const MIN = 6;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/catering/faq");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MIN) return jsonError(403, "forbidden");
  try {
    const [faqs, locations] = await Promise.all([loadFaqs(ctx), loadFaqLocations(ctx)]);
    return jsonOk({ faqs, locations });
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/catering/faq");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < MIN) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Partial<CreateFaqInput>;
  if (typeof b.questionEn !== "string" || typeof b.answerEn !== "string") {
    return jsonError(400, "invalid_payload", { message: "questionEn and answerEn are required" });
  }
  const locationId =
    b.locationId === null || b.locationId === undefined
      ? null
      : typeof b.locationId === "string"
        ? b.locationId
        : undefined;
  if (locationId === undefined) {
    return jsonError(400, "invalid_payload", { message: "locationId must be a string or null" });
  }

  try {
    const result = await createFaq(ctx, {
      locationId,
      questionEn: b.questionEn,
      questionEs: typeof b.questionEs === "string" ? b.questionEs : null,
      answerEn: b.answerEn,
      answerEs: typeof b.answerEs === "string" ? b.answerEs : null,
    });
    return jsonOk({ id: result.id, slug: result.slug }, 201);
  } catch (e) {
    if (e instanceof AdminCateringError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
