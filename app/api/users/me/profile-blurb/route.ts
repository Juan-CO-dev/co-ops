/**
 * PATCH /api/users/me/profile-blurb — set/clear the actor's profile blurb.
 *
 * Body: { blurb: string }  — trimmed; whitespace-only clears (stores NULL).
 * Response: { ok: true, blurb: string | null }
 *
 * AGM+ ONLY (role level >= 6). This gate is app-layer because RLS can't
 * express a role predicate on a self-update — to users_update_self it is just
 * the user editing their own row (always allowed). The level is derived from
 * the session-loaded user's role (not a JWT claim) so a same-session role
 * change can't leave a stale gate.
 *
 * No audit row: a profile blurb is a routine self-authored preference, like
 * language / phone / sms_consent (per AGENTS.md Phase 2 column-level notes).
 */

import { type NextRequest } from "next/server";

import { extractIp, jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { ROLES } from "@/lib/roles";
import { requireSession, SESSION_COOKIE_NAME } from "@/lib/session";
import { createAuthedClient } from "@/lib/supabase-server";

const MAX_BLURB_LEN = 500;

interface BlurbBody {
  blurb: string;
}

function isBlurbBody(raw: unknown): raw is BlurbBody {
  if (typeof raw !== "object" || raw === null) return false;
  return typeof (raw as Record<string, unknown>).blurb === "string";
}

export async function PATCH(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  if (!isBlurbBody(parsed)) {
    return jsonError(400, "invalid_payload", {
      message: "Body must include blurb (a string).",
      field: "blurb",
    });
  }

  // Normalize: trim; whitespace-only clears (NULL). Enforce length on the
  // trimmed value — the DB CHECK is the second line of defense.
  const trimmed = parsed.blurb.trim();
  if (trimmed.length > MAX_BLURB_LEN) {
    return jsonError(400, "blurb_too_long", {
      message: `Blurb must be ${MAX_BLURB_LEN} characters or fewer.`,
      field: "blurb",
    });
  }
  const value: string | null = trimmed.length === 0 ? null : trimmed;

  const ctx = await requireSession(req, "/api/users/me/profile-blurb");
  if (ctx instanceof Response) return ctx;

  // App-layer AGM+ gate (level >= 6). Derived from the session-loaded role.
  const level = ROLES[ctx.user.role].level;
  if (level < 6) {
    return jsonError(403, "forbidden", {
      message: "Only AGM and above can set a profile blurb.",
    });
  }

  const rawJwt = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!rawJwt) {
    return jsonError(500, "internal_error", { message: "session cookie missing after auth" });
  }
  const authed = createAuthedClient(rawJwt);

  // RLS users_update_self gates this to the actor's own row; per AGENTS.md
  // silent-denial footgun, check rowCount and treat 0 as a 403/internal error.
  const { data: updatedRows, error: updateErr } = await authed
    .from("users")
    .update({ profile_blurb: value })
    .eq("id", ctx.user.id)
    .select("id");

  if (updateErr) {
    const ip = extractIp(req);
    console.error(
      `[/api/users/me/profile-blurb PATCH] update failed for user=${ctx.user.id} ip=${ip}:`,
      updateErr.message,
    );
    return jsonError(500, "internal_error", { message: "profile blurb update failed" });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return jsonError(403, "forbidden", { message: "Cannot update blurb for this user." });
  }

  return jsonOk({ ok: true, blurb: value });
}
