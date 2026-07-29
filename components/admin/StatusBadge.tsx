"use client";

/**
 * StatusBadge — shared soft-gate badge (first shared badge extraction).
 * Gaps-only: render ONLY for 'incomplete' (red) / 'upstream_gaps' (amber);
 * ready entities render nothing (callers skip). Red classes mirror the
 * shipped recipes.badge.incomplete chip (RecipesClient.tsx).
 */
import { useTranslation } from "@/lib/i18n/provider";
import { AlertPill, type AlertPillTone } from "@/components/ui/AlertPill";
import type { Reason } from "@/lib/readiness";
import type { TranslationKey } from "@/lib/i18n/types";

// Component API preserved (status → badge); rendering delegates to the shared
// AlertPill primitive on co- tokens. incomplete = danger (was co-cta red),
// upstream_gaps = warn (was raw amber).
const TONE: Record<"incomplete" | "upstream_gaps", AlertPillTone> = {
  incomplete: "danger",
  upstream_gaps: "warn",
};

export function StatusBadge({ status }: { status: keyof typeof TONE }) {
  const { t } = useTranslation();
  return (
    <AlertPill tone={TONE[status]} uppercase={false}>
      {t(status === "incomplete" ? "readiness.badge.not_ready" : "readiness.badge.upstream")}
    </AlertPill>
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
