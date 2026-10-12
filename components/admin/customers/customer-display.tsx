import { formatCents, formatDateLabelWithYear } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";

export function customerDisplay(language: Language, today: string) {
  const t = (k: TranslationKey, p?: Record<string, string | number>) => serverT(language, k, p);
  return { t,
    money: (value: number | null) => value === null ? <span title={t("customers.stats.unknown")} aria-label={t("customers.stats.unknown")}>—</span> : formatCents(value, language),
    date: (date: string | null) => date ? formatDateLabelWithYear(date, language) : t("customers.stats.unknown"),
    last: (date: string | null) => date ? <span>{t("customers.list.daysAgo", { days: Math.max(0, Math.round((Date.parse(today) - Date.parse(date)) / 86400000)) })}<span className="block text-xs text-co-text-muted">{formatDateLabelWithYear(date, language)}</span></span> : t("customers.stats.unknown"),
    channel: (channel: string) => t(`customers.channel.${["dine_in", "takeout", "online", "app", "delivery", "third_party", "catering"].includes(channel) ? channel : "unknown"}` as TranslationKey),
  };
}

export const customerPill = "inline-flex min-h-[44px] max-w-full items-center rounded-lg border-2 border-co-border bg-co-surface px-3 font-bold text-co-text";
