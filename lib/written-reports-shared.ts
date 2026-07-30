/**
 * written-reports-shared — the CLIENT-SAFE surface for Written Reports.
 *
 * Pure module (no I/O, no server imports) per the `*-shared.ts` pattern
 * (AGENTS.md "Module boundaries"): the form (client component) and the data
 * layer (server) both need the category set, the field limits, and the
 * validation of a draft. This file holds exactly that pure surface; the
 * server module `lib/written-reports.ts` re-exports it so server consumers
 * keep one import path.
 *
 * Written Reports = the "shift happened, something went wrong, write it down"
 * artifact. Free-text body (required) + optional title + a category + a
 * visibility floor (the minimum role level that may read it). Append-only:
 * no delete ever; a self-edit is permitted only inside the 3-hour window the
 * RLS UPDATE policy enforces (mirrored here for the UI affordance).
 */

import { ROLES, type RoleCode } from "@/lib/roles";

/**
 * The category set. Stored in the nullable `category` text column (system key,
 * matched on the English original per the i18n system-key rule; rendered
 * translated). "other" is the safe default when the writer picks nothing.
 */
export const WRITTEN_REPORT_CATEGORIES = [
  "incident",
  "observation",
  "request",
  "feedback",
  "other",
] as const;

export type WrittenReportCategory = (typeof WRITTEN_REPORT_CATEGORIES)[number];

export function isWrittenReportCategory(v: unknown): v is WrittenReportCategory {
  return (
    typeof v === "string" &&
    (WRITTEN_REPORT_CATEGORIES as readonly string[]).includes(v)
  );
}

/** Field limits (app-layer; the DB body column is NOT NULL, the rest are text). */
export const WRITTEN_REPORT_LIMITS = {
  titleMax: 140,
  bodyMax: 8000,
} as const;

/**
 * The lowest role level that may AUTHOR a written report. Mirrors the live
 * `written_reports_insert` RLS policy (`current_user_role_level() >= 3`).
 * L3 = employee.
 */
export const WRITTEN_REPORT_WRITE_MIN_LEVEL = 3;

/**
 * The default visibility floor (the DB column default is 3 = any staff who can
 * see the app). A writer may RAISE it (scope to AGM+, GM+, etc.) but never
 * below their own read reach — enforced server-side; the picker only offers
 * levels >= this default.
 */
export const WRITTEN_REPORT_DEFAULT_VISIBILITY = 3;

/**
 * Self-edit window in hours. Mirrors the live `written_reports_update_self` RLS
 * policy (`submitted_at > now() - '03:00:00'`). Used ONLY for the UI affordance
 * (show/hide the Edit control); the DB is the authority.
 */
export const WRITTEN_REPORT_EDIT_WINDOW_HOURS = 3;

/**
 * Is `submittedAt` still inside the self-edit window relative to `now`?
 * Pure — both args are ISO strings / Dates; no clock read of its own so it is
 * deterministically testable.
 */
export function isWithinEditWindow(submittedAt: string | Date, now: Date): boolean {
  const submitted = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  if (Number.isNaN(submitted.getTime())) return false;
  const cutoff = now.getTime() - WRITTEN_REPORT_EDIT_WINDOW_HOURS * 60 * 60 * 1000;
  return submitted.getTime() > cutoff;
}

/**
 * The visibility-floor options a writer may choose from, as {level,label}
 * ascending, filtered to levels >= the default floor. The label is the
 * canonical role label for that level (roleLevelOptions convention: the
 * highest-listed role at a shared level). Presentational label is resolved by
 * the caller's translator on the RoleCode; here we return the raw level so the
 * caller decides the copy ("Any staff", "AGM and above", …).
 */
export interface VisibilityFloorOption {
  level: number;
  /** The canonical role code at this level (for the caller to translate). */
  role: RoleCode;
}

export function visibilityFloorOptions(): VisibilityFloorOption[] {
  const byLevel = new Map<number, RoleCode>();
  for (const r of Object.values(ROLES)) {
    // Only integer levels >= the default floor; first (highest-listed) wins.
    if (r.level < WRITTEN_REPORT_DEFAULT_VISIBILITY) continue;
    if (!Number.isInteger(r.level)) continue;
    if (!byLevel.has(r.level)) byLevel.set(r.level, r.code);
  }
  return [...byLevel.entries()]
    .map(([level, role]) => ({ level, role }))
    .sort((a, b) => a.level - b.level);
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft validation — the pure core the POST route and the client form share.
// ─────────────────────────────────────────────────────────────────────────────

export interface WrittenReportDraft {
  title: string | null;
  body: string;
  category: WrittenReportCategory | null;
  visibilityMinLevel: number;
}

export type WrittenReportValidationError =
  | "body_required"
  | "body_too_long"
  | "title_too_long"
  | "invalid_category"
  | "invalid_visibility";

export interface WrittenReportValidationResult {
  ok: boolean;
  error?: WrittenReportValidationError;
  /** The normalized draft (trimmed title→null, defaulted category/visibility). */
  draft?: WrittenReportDraft;
}

/**
 * Validate + normalize a raw draft. Pure — no clock, no I/O. The server route
 * calls this THEN applies the authorization floor (visibility can't drop below
 * the author's own read reach) which is a session-dependent concern kept out of
 * this pure fn. The client calls it for inline feedback.
 *
 * Normalization:
 *   - title: trimmed; whitespace-only → null
 *   - body: trimmed; empty → body_required
 *   - category: null passes (stored NULL); any non-member → invalid_category
 *   - visibilityMinLevel: must be one of the offered floor levels
 */
export function validateWrittenReportDraft(raw: {
  title?: unknown;
  body?: unknown;
  category?: unknown;
  visibilityMinLevel?: unknown;
}): WrittenReportValidationResult {
  // body — required
  const bodyStr = typeof raw.body === "string" ? raw.body.trim() : "";
  if (bodyStr.length === 0) return { ok: false, error: "body_required" };
  if (bodyStr.length > WRITTEN_REPORT_LIMITS.bodyMax) {
    return { ok: false, error: "body_too_long" };
  }

  // title — optional
  let title: string | null = null;
  if (typeof raw.title === "string") {
    const t = raw.title.trim();
    if (t.length > WRITTEN_REPORT_LIMITS.titleMax) {
      return { ok: false, error: "title_too_long" };
    }
    title = t.length === 0 ? null : t;
  }

  // category — optional; null OK, else must be a member
  let category: WrittenReportCategory | null = null;
  if (raw.category != null && raw.category !== "") {
    if (!isWrittenReportCategory(raw.category)) {
      return { ok: false, error: "invalid_category" };
    }
    category = raw.category;
  }

  // visibility — must be one of the offered floors
  const allowed = new Set(visibilityFloorOptions().map((o) => o.level));
  const vis =
    typeof raw.visibilityMinLevel === "number"
      ? raw.visibilityMinLevel
      : WRITTEN_REPORT_DEFAULT_VISIBILITY;
  if (!allowed.has(vis)) {
    return { ok: false, error: "invalid_visibility" };
  }

  return {
    ok: true,
    draft: { title, body: bodyStr, category, visibilityMinLevel: vis },
  };
}
