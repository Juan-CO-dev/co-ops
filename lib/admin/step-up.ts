import type { AuthContext } from "@/lib/session";
import {
  DEFAULT_EDIT_WINDOW_SECONDS,
  DEFAULT_FRESH_SECONDS,
  isFreshWithin,
  isInsideWindow,
  parseWindowSeconds,
  type StepUpTier,
} from "@/lib/admin/step-up-shared";

/**
 * Admin step-up enforcement (C.44 Module 1; Tier E added 2026-10-15, catalog Phase 1).
 *
 *   Tier A — sessions.step_up_unlocked (any age).
 *   Tier B — step_up_unlocked AND step_up_unlocked_at within ADMIN_STEP_UP_FRESH_SECONDS (120 s).
 *   Tier E — sessions.catalog_edit_unlocked_at (0257) within ADMIN_STEP_UP_EDIT_WINDOW_SECONDS
 *            (900 s, never shorter than B). Its OWN fixed clock: stamped only by an
 *            admin-surface password, never extended, never cleared by navigation.
 * The always-prompt catalog acts use none of these: they consume a one-shot grant
 * (lib/admin/step-up-grants.ts). Pure over AuthContext; `now` is injectable.
 */
export type { StepUpTier };

export type StepUpResult =
  | { ok: true }
  | { ok: false; code: "step_up_required" | "step_up_stale" };

/** Tier B freshness window in ms. Override via ADMIN_STEP_UP_FRESH_SECONDS. */
export function stepUpFreshWindowMs(): number {
  return parseWindowSeconds(process.env.ADMIN_STEP_UP_FRESH_SECONDS, DEFAULT_FRESH_SECONDS) * 1000;
}

/** Tier E edit window in ms. Override via ADMIN_STEP_UP_EDIT_WINDOW_SECONDS; never shorter than Tier B. */
export function stepUpEditWindowMs(): number {
  const edit = parseWindowSeconds(process.env.ADMIN_STEP_UP_EDIT_WINDOW_SECONDS, DEFAULT_EDIT_WINDOW_SECONDS) * 1000;
  return Math.max(edit, stepUpFreshWindowMs());
}

export function assertStepUp(
  ctx: AuthContext,
  tier: StepUpTier,
  now: number = Date.now(),
): StepUpResult {
  if (tier === "E") {
    const at = ctx.session.catalogEditUnlockedAt ?? null;
    if (at === null) return { ok: false, code: "step_up_required" };
    // EXCLUSIVE deadline (Astra r3 #2): at exactly 15:00 the window is closed. Tier B below keeps
    // its existing inclusive boundary.
    return isInsideWindow(at, now, stepUpEditWindowMs()) ? { ok: true } : { ok: false, code: "step_up_stale" };
  }
  if (!ctx.session.stepUpUnlocked) return { ok: false, code: "step_up_required" };
  if (tier === "A") return { ok: true };
  if (!isFreshWithin(ctx.session.stepUpUnlockedAt, now, stepUpFreshWindowMs())) {
    return { ok: false, code: "step_up_stale" };
  }
  return { ok: true };
}
