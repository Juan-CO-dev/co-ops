"use client";

/**
 * Needs attention — one ranked list, each row a one-tap action. Severity is a word + colour pair;
 * the score chip mirrors v1's RED/YELLOW/GREEN. `partial` names the sources that did not answer so
 * a short list is never mistaken for a clean shop.
 */
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PulseScore } from "@/lib/midshift-shared";
import type { AttentionData, AttentionRow } from "@/lib/pulse/types";

const SCORE_KEY: Record<PulseScore, TranslationKey> = { green: "midshift.score.green", yellow: "midshift.score.yellow", red: "midshift.score.red" };
const SCORE_CHIP: Record<PulseScore, string> = {
  green: "bg-co-success-surface text-co-confirm-text",
  yellow: "bg-co-gold/25 text-co-gold-text",
  red: "bg-co-danger-surface text-co-cta-text",
};

export function ScoreChip({ score }: { score: PulseScore }) {
  const { t } = useTranslation();
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${SCORE_CHIP[score]}`}>{t(SCORE_KEY[score])}</span>;
}

function rowText(row: AttentionRow, t: ReturnType<typeof useTranslation>["t"]): string {
  const p = row.params;
  const count = typeof p.count === "number" ? p.count : Number(p.count ?? 0);
  switch (row.kind) {
    case "task_late":
      return p.name
        ? t("pulse.attention.task_late_named", { task: t(`assignments.task.${String(p.task)}` as TranslationKey), name: p.name })
        : t("pulse.attention.task_late", { task: t(`assignments.task.${String(p.task)}` as TranslationKey) });
    case "checklist_missed":
      return t("pulse.attention.checklist_missed", { report: t(`midshift.report.${String(p.report)}` as TranslationKey) });
    case "fridge_unchecked":
      return count === 1 ? t("pulse.attention.fridge_unchecked_one") : t("pulse.attention.fridge_unchecked_other", { count });
    case "item_low":
      return count === 1 ? t("pulse.attention.item_low_one", { items: String(p.items ?? "") }) : t("pulse.attention.item_low_other", { count, items: String(p.items ?? "") });
    case "clockin_unlinked":
      return count === 1 ? t("pulse.attention.clockin_unlinked_one", { names: String(p.names ?? "") }) : t("pulse.attention.clockin_unlinked_other", { count, names: String(p.names ?? "") });
    default:
      return t(`pulse.attention.${row.kind}` as TranslationKey, p);
  }
}

export function AttentionList({ data, mode }: { data: AttentionData; mode: "card" | "detail" }) {
  const { t } = useTranslation();
  const rows = mode === "card" ? data.items.slice(0, 8) : data.items;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ScoreChip score={data.score} />
        {data.partial.length > 0 && <p className="text-xs text-co-warning-text">{t("pulse.attention.partial", { sources: data.partial.join(", ") })}</p>}
      </div>
      {rows.length === 0 ? (
        <p role="status" className="text-sm text-co-confirm-text">{t("pulse.attention.all_clear")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-co-border/50" aria-label={t("pulse.section.attention")}>
          {rows.map((row) => (
            <li key={row.key} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${row.severity === "red" ? "bg-co-danger" : "bg-co-warning"}`} />
                <span className="sr-only">{t(row.severity === "red" ? "midshift.score.red" : "midshift.score.yellow")}: </span>
                <span className="min-w-0 break-words font-semibold text-co-text">{rowText(row, t)}</span>
              </span>
              <Link href={row.href} className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text hover:border-co-text">
                {t(`pulse.attention.action.${row.action}` as TranslationKey)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {mode === "card" && data.items.length > rows.length && <p className="mt-1 text-xs text-co-text-dim">+{data.items.length - rows.length}</p>}
    </div>
  );
}
