"use client";

/**
 * The card chrome every section shares: title, "as of" stamp, a 44 px "See more" to the section's
 * own page, and the four states (loading skeleton · ok · error with its own message, keeping the
 * last good body underneath · not installed). The body is a render prop over the section's data so
 * the card never knows a section's shape.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { PulseSection } from "@/lib/pulse/scope-shared";
import type { SectionState } from "@/lib/pulse/types";
import { SECTION_TITLE_KEY, pulseCard, sectionHref } from "@/components/pulse/shared";
import { useSectionPoll } from "@/components/pulse/useSectionPoll";

export function SectionCard<T>({ section, locationId, initial, delayMs, mode = "card", className = "", children, headerExtra }: {
  section: PulseSection;
  locationId: string;
  initial: SectionState<T> | undefined;
  delayMs?: number;
  mode?: "card" | "detail";
  className?: string;
  headerExtra?: ReactNode;
  children: (data: T, ctx: { refresh: () => Promise<void>; asOf: string | null }) => ReactNode;
}) {
  const { t, language } = useTranslation();
  const { current, lastData, refresh, refreshing } = useSectionPoll<T>({ section, locationId, initial, delayMs });
  const title = t(SECTION_TITLE_KEY[section]);
  const asOf = current.asOf;
  const errorKey = current.state === "error"
    ? current.code === "timeout" ? "pulse.card.error_timeout" : current.code === "forbidden" ? "pulse.card.error_forbidden" : "pulse.card.error"
    : null;
  const Heading = mode === "detail" ? "h1" : "h2";
  return (
    <section className={`${pulseCard} ${className}`} aria-labelledby={`pulse-${section}-title`} aria-busy={refreshing || undefined}>
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <Heading id={`pulse-${section}-title`} className={`${mode === "detail" ? "text-lg" : "text-sm"} font-bold text-co-text`}>{title}</Heading>
          {asOf && <span className="text-[11px] text-co-text-dim">{t("pulse.card.as_of", { time: formatTime(asOf, language) })}</span>}
          {headerExtra}
        </div>
        {mode === "card" && (
          <Link href={sectionHref(section, locationId)} className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-co-gold-text underline underline-offset-2">
            {t("pulse.card.see_more")}
          </Link>
        )}
      </header>
      {current.state === "loading" && (
        <div className="flex flex-col gap-2" role="status" aria-label={t("pulse.card.loading")}>
          <div className="h-4 w-2/3 animate-pulse rounded bg-co-surface-inset" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-co-surface-inset" />
          <div className="h-16 w-full animate-pulse rounded bg-co-surface-inset" />
        </div>
      )}
      {current.state === "not_installed" && <p className="text-sm text-co-text-muted">{t("pulse.card.not_installed")}</p>}
      {current.state === "error" && errorKey && (
        <div role="alert" className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-co-cta-text bg-co-danger-surface px-3 py-2">
          <p className="text-sm text-co-cta-text">{t(errorKey)}</p>
          <button type="button" onClick={() => void refresh()} className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-bold text-co-cta-text underline underline-offset-2">
            {t("pulse.card.retry")}
          </button>
        </div>
      )}
      {current.state === "ok" && children(current.data, { refresh, asOf })}
      {current.state === "error" && lastData !== null && children(lastData, { refresh, asOf })}
    </section>
  );
}
