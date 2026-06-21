import type { AuthContext } from "@/lib/session";

/**
 * Two-tier admin step-up enforcement (C.44 Module 1).
 *
 * Password verification lives solely in POST /api/auth/step-up; the tiers
 * differ only by a freshness bound on the session's step_up_unlocked_at:
 *   Tier A — unlocked at all (any age). Auto-clears on /admin exit
 *            (lib/session.ts requireSessionCore).
 *   Tier B — unlocked AND step_up_unlocked_at within the freshness window.
 *
 * Pure over AuthContext (requireSessionCore populates the session row's
 * flag + timestamp from the live row, so this needs no I/O). `now` is
 * injectable for deterministic smokes.
 *
 * FOUNDATION PRIMITIVE: built + unit-smoked here; first live consumer is the
 * User Management module. Not called anywhere in this cycle — not dead code.
 */
export type StepUpTier = "A" | "B";

export type StepUpResult =
  | { ok: true }
  | { ok: false; code: "step_up_required" | "step_up_stale" };

const DEFAULT_FRESH_SECONDS = 120;

/** Tier B freshness window in ms. Override via ADMIN_STEP_UP_FRESH_SECONDS. */
export function stepUpFreshWindowMs(): number {
  const raw = process.env.ADMIN_STEP_UP_FRESH_SECONDS;
  const n = raw ? parseInt(raw, 10) : NaN;
  const seconds = Number.isFinite(n) && n > 0 ? n : DEFAULT_FRESH_SECONDS;
  return seconds * 1000;
}

export function assertStepUp(
  ctx: AuthContext,
  tier: StepUpTier,
  now: number = Date.now(),
): StepUpResult {
  if (!ctx.session.stepUpUnlocked) return { ok: false, code: "step_up_required" };
  if (tier === "A") return { ok: true };

  // Tier B — must also be fresh.
  const unlockedAt = ctx.session.stepUpUnlockedAt;
  if (!unlockedAt) return { ok: false, code: "step_up_stale" };
  const age = now - Date.parse(unlockedAt);
  if (Number.isNaN(age) || age < 0 || age > stepUpFreshWindowMs()) {
    return { ok: false, code: "step_up_stale" };
  }
  return { ok: true };
}
