"use client";

/**
 * StatusBadge — shared soft-gate badge (first shared badge extraction).
 * Gaps-only: render ONLY for 'incomplete' (red) / 'upstream_gaps' (amber);
 * ready entities render nothing (callers skip). Red classes mirror the
 * shipped recipes.badge.incomplete chip (RecipesClient.tsx).
 */
import { useTranslation } from "@/lib/i18n/provider";
import type { Reason } from "@/lib/readiness";
import type { TranslationKey } from "@/lib/i18n/types";

const CLS = {
  incomplete: "rounded bg-co-cta/15 px-2 py-0.5 text-xs font-bold text-co-cta",
  upstream_gaps: "rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700",
} as const;

export function StatusBadge({ status }: { status: keyof typeof CLS }) {
  const { t } = useTranslation();
  return (
    <span className={CLS[status]}>
      {t(status === "incomplete" ? "readiness.badge.not_ready" : "readiness.badge.upstream")}
    </span>
  );
}

/** Short inline reasons line, e.g. "Missing: no price · no delivery received". */
export function ReadinessReasons({ reasons }: { reasons: Reason[] }) {
  const { t } = useTranslation();
  if (reasons.length === 0) return null;
  const parts = reasons.map((r) =>
    t(
      `readiness.reason.${r.code}` as TranslationKey,
      r.count != null ? { count: r.count } : undefined,
    ),
  );
  return (
    <p className="mt-0.5 text-xs text-co-text-muted">
      {t("readiness.reasons_prefix")} {parts.join(" · ")}
    </p>
  );
}
