"use server";

/**
 * Dashboard Server Actions — Build #3 PR 3 Step 7.
 *
 * Single action: markNotificationReadAction. Called from the dashboard
 * notification surface (NotificationList) on per-item tap. Returns a
 * minimal result shape; revalidatePath('/dashboard') triggers a Server
 * Component re-render so loadUnreadForUser fetches fresh state and the
 * just-acked notification disappears from the list.
 *
 * Architectural choices (locked Q5 Step 7 architecture surfacing):
 *   - Server Action over route handler — tight coupling to dashboard
 *     render cycle; auto-revalidation via revalidatePath; no external
 *     callers planned.
 *   - revalidatePath('/dashboard') over updateTag — `cacheComponents`
 *     is NOT enabled in next.config.ts (verified Step 7 pre-flight),
 *     so revalidatePath is the canonical Next 16 path.
 *
 * Authorization: requireSessionFromHeaders inside the action verifies
 * the session BEFORE calling lib/notifications markNotificationRead.
 * The lib helper itself adds defense-in-depth via WHERE user_id (per
 * AGENTS.md Phase 2 Session 4 lesson) — service-role bypasses RLS so
 * the WHERE clause prevents cross-user mark-read attacks.
 *
 * Idempotency: markNotificationRead returns { newlyMarked: boolean }
 * — preserves the original read_at timestamp on second call. Action
 * surface returns { ok: true } either way; the lib's audit-relevant
 * "first read" timestamp is the canonical operational evidence.
 */

import { revalidatePath } from "next/cache";

import { markNotificationRead } from "@/lib/notifications";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export interface MarkNotificationReadResult {
  ok: boolean;
  /** True when this call landed read_at; false when already read. */
  newlyMarked?: boolean;
  /** Stable error code for client-side error handling. */
  errorCode?: "missing_recipient_id" | "not_authorized" | "server_error";
}

export async function markNotificationReadAction(args: {
  recipientId: string;
}): Promise<MarkNotificationReadResult> {
  if (!args.recipientId || typeof args.recipientId !== "string") {
    return { ok: false, errorCode: "missing_recipient_id" };
  }

  const auth = await requireSessionFromHeaders("/dashboard");
  const sb = getServiceRoleClient();

  try {
    const { newlyMarked } = await markNotificationRead(sb, {
      recipientId: args.recipientId,
      userId: auth.user.id,
    });
    revalidatePath("/dashboard");
    return { ok: true, newlyMarked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Authorization failure (cross-user attempt) surfaces as the lib's
    // "recipient not found OR user_id mismatch" error string. Map to
    // a stable client-facing code without leaking internals.
    if (message.includes("user_id mismatch") || message.includes("not found")) {
      return { ok: false, errorCode: "not_authorized" };
    }
    console.error("markNotificationReadAction failed:", message);
    return { ok: false, errorCode: "server_error" };
  }
}
