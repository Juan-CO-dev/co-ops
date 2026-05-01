/**
 * POST /api/checklist/instances — get-or-create the instance for a
 * (templateId, locationId, date) tuple. Idempotent. Used by the closing
 * UI on page load to ensure today's instance exists at the location.
 *
 * Body: { templateId: string, locationId: string, date: string (YYYY-MM-DD) }
 *
 * Response: { instance: ChecklistInstance, created: boolean }
 *
 * Auth: requireSession. RLS on checklist_instances enforces
 *   location_id ∈ user_locations AND role_level >= 3 at INSERT time.
 *
 * Audit: lib/checklists.ts emits checklist_instance.create on creation.
 *   Route-level audit is intentionally absent — the lib is the source of
 *   truth for vocabulary, and double-auditing would create noise.
 *
 * GET is intentionally not implemented at this collection route. List
 * queries belong to a future Synthesis View / dashboard concern (Module
 * #1 build #5). The closing UI fetches per-id state directly via the
 * authed client in the Server Component, not through a list API.
 */

import { type NextRequest, NextResponse } from "next/server";

import { ChecklistError, getOrCreateInstance } from "@/lib/checklists";
import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

import { mapChecklistError } from "../_helpers";

interface CreateBody {
  templateId: string;
  locationId: string;
  date: string;
}

function isCreateBody(raw: unknown): raw is CreateBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.templateId === "string" &&
    typeof r.locationId === "string" &&
    typeof r.date === "string"
  );
}

// Cheap YYYY-MM-DD validation. Postgres will also reject malformed dates
// at INSERT time, but the early return is a clearer caller-side error.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isCreateBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include templateId, locationId, date (YYYY-MM-DD).",
    });
  }
  const { templateId, locationId, date } = parsed;
  if (!DATE_RE.test(date)) {
    return jsonError(400, "invalid_payload", {
      field: "date",
      message: "date must be YYYY-MM-DD",
    });
  }

  const ctx = await requireSession(req, "/api/checklist/instances");
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    // Logically unreachable post-requireSession success, but defensive.
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  try {
    const result = await getOrCreateInstance(authed, {
      templateId,
      locationId,
      date,
      actor: { userId: ctx.user.id, role: ctx.role, level: ctx.level },
      ipAddress: extractIp(req),
      userAgent: req.headers.get("user-agent"),
    });
    return jsonOk({ instance: result.instance, created: result.created });
  } catch (err) {
    if (err instanceof ChecklistError) return mapChecklistError(err);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/checklist/instances POST] unexpected error:", msg);
    return jsonError(500, "internal_error", { message: "checklist instance create failed" });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Not implemented", code: "not_implemented" },
    { status: 501 },
  );
}
