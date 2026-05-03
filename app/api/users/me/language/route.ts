/**
 * PATCH /api/users/me/language — update the actor's language preference.
 *
 * Body: { language: 'en' | 'es' }
 * Response: { ok: true, language: 'en' | 'es' }
 *
 * Per SPEC_AMENDMENTS.md C.31. Self-only — actor can only update their
 * own row. RLS users_update_self permits self-row UPDATE; the schema's
 * CHECK constraint enforces the language enum at the DB layer.
 *
 * No audit row: language is a UI preference, not an authorization or
 * security event. Pattern matches phone / sms_consent updates which also
 * skip audit (per AGENTS.md Phase 2 column-level enforcement notes:
 * users_update_self self-updates are routine settings, not auth events).
 *
 * No session revoke needed: language is NOT in JWT claims (per the
 * architectural decision to read users.language directly per Server
 * Component render, avoiding post-toggle staleness).
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { isLanguage } from "@/lib/i18n/types";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

interface LanguageBody {
  language: "en" | "es";
}

function isLanguageBody(raw: unknown): raw is LanguageBody {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return isLanguage(r.language);
}

export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isLanguageBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include language ('en' or 'es').",
      field: "language",
    });
  }

  const ctx = await requireSession(req, "/api/users/me/language");
  if (ctx instanceof Response) return ctx;

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  // RLS users_update_self gates this to the actor's own row; per AGENTS.md
  // silent-denial footgun, check rowCount and treat 0 as a 403/internal error.
  const { data: updatedRows, error: updateErr } = await authed
    .from("users")
    .update({ language: parsed.language })
    .eq("id", ctx.user.id)
    .select("id, language");

  if (updateErr) {
    // Defensive: extract the IP for logging so future debugging has context.
    const ip = extractIp(req);
    console.error(
      `[/api/users/me/language PATCH] update failed for user=${ctx.user.id} ip=${ip}:`,
      updateErr.message,
    );
    return jsonError(500, "internal_error", { message: "language update failed" });
  }
  if (!updatedRows || updatedRows.length === 0) {
    // RLS denial path — should never fire for self-update, but defensive.
    return jsonError(403, "forbidden", { message: "Cannot update language for this user." });
  }

  return jsonOk({ ok: true, language: parsed.language });
}
