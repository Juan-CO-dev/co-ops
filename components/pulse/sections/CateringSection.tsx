"use client";

/** Catering (KH+): due today with stage + source, tomorrow look-ahead, ezCater orders not rung into Toast (money at GM+ only), prep status. */
import Link from "next/link";
import { leadSourceLabelKey } from "@/lib/catering/intake-shared";
import { formatCents, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { stageChip, timeWindowLabel } from "@/lib/midshift-shared";
import type { CateringData } from "@/lib/pulse/types";
import { subHeading, tapLink } from "@/components/pulse/shared";

const PROGRESS_KEY: Record<string, TranslationKey> = { done: "midshift.progress.done", in_progress: "midshift.progress.in_progress", not_started: "midshift.progress.not_started" };

export function CateringSection({ data, mode }: { data: CateringData; mode: "card" | "detail" }) {
  const { t, language } = useTranslation();
  const rows = mode === "card" ? data.today.slice(0, 4) : data.today;
  const tomorrow = data.tomorrow.count === 0
    ? t("midshift.catering.tomorrow_none")
    : timeWindowLabel(data.tomorrow.firstWindow, language)
      ? t("midshift.catering.tomorrow_some", { count: data.tomorrow.count, time: timeWindowLabel(data.tomorrow.firstWindow, language)! })
      : t("midshift.catering.tomorrow_some_no_time", { count: data.tomorrow.count });
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className={subHeading}>{t("pulse.catering.next_hours")}</h3>
        {rows.length === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.catering.none_today")}</p> : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((ev) => {
              const chip = stageChip(ev.stage);
              const src = ev.source === null && data.redacted ? null : leadSourceLabelKey(ev.source);
              return (
                <li key={ev.id} className="flex min-h-[44px] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-co-gold/50 bg-co-surface px-3 py-1.5">
                  <span className="text-sm font-extrabold text-co-text">{timeWindowLabel(ev.timeWindow, language) ?? t("midshift.catering.no_time")}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${chip.className}`}>{t(chip.labelKey)}</span>
                  {ev.name !== null && <span className="min-w-0 text-sm font-semibold text-co-text">{ev.name}</span>}
                  {ev.headcount != null && <span className="text-xs text-co-text-muted">{ev.headcount === 1 ? t("midshift.catering.covers_one") : t("midshift.catering.covers_other", { count: ev.headcount })}</span>}
                  <span className="text-xs font-semibold text-co-text-muted">{t(ev.isDelivery ? "midshift.catering.delivery" : "midshift.catering.pickup")}</span>
                  {src && <span className="text-xs text-co-text-dim">{"key" in src ? t(src.key) : src.verbatim}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1 text-xs text-co-text-muted">{tomorrow}</p>
      </div>
      <p className="text-xs text-co-text-muted">{t("pulse.catering.prep", { am: t(PROGRESS_KEY[data.prep.amPrep]!), mid: t(PROGRESS_KEY[data.prep.midDay]!) })}</p>
      {data.redacted && <p className="text-[11px] text-co-text-dim">{t("pulse.catering.crew_note")}</p>}
      {!data.redacted && <div>
        <h3 className={subHeading}>{t("pulse.catering.not_rung")}</h3>
        {data.notRung.length === 0 ? <p className="text-sm text-co-confirm-text">{t("pulse.catering.not_rung_none")}</p> : (
          <ul className="flex flex-col divide-y divide-co-border/50">
            {data.notRung.map((o) => (
              <li key={o.orderId} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-1 text-sm">
                <span className="min-w-0"><span className="font-semibold text-co-text">{t("pulse.catering.order", { order: o.orderNumber ?? "—" })}</span>{o.readyAt ? <span className="text-co-text-muted"> · {formatTime(o.readyAt, language)}</span> : null}{o.headcount != null ? <span className="text-co-text-muted"> · {t("midshift.catering.covers_other", { count: o.headcount })}</span> : null}{o.totalCents != null ? <span className="text-co-text-muted"> · {formatCents(o.totalCents, language)}</span> : null}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${o.timing === "overdue" || o.timing === "due" ? "bg-co-danger-surface text-co-cta-text" : "bg-co-surface-2 text-co-text-dim"}`}>{t(`pulse.catering.timing.${o.timing}` as TranslationKey)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>}
      {mode === "detail" && !data.redacted && <Link href="/catering/pipeline" className={tapLink}>{t("pulse.catering.pipeline_link")}</Link>}
    </div>
  );
}
