import Link from "next/link";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import type { CustomerStatsDto } from "@/lib/customers/access-shared";

const CHANNELS = ["dine_in", "takeout", "online", "app", "delivery", "third_party", "catering", "unknown"];

/** One profile's stats, no contact data (the DTO has none). Used by the list and the detail page. */
export function ProfileStats({ p, language, link }: { p: CustomerStatsDto; language: Language; link?: boolean }) {
  const t = (key: TranslationKey, params?: Record<string, string | number>) => serverT(language, key, params);
  const channel = (c: string) => CHANNELS.includes(c) ? t(`customers.channel.${c}` as TranslationKey) : c;
  const name = p.name ?? t("customers.unnamed");
  return <article className="co-card min-w-0 space-y-2 p-4">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      {link ? <Link href={`/admin/customers/${p.id}`} className="inline-flex min-h-[44px] min-w-0 items-center truncate text-lg font-bold text-co-text underline">{name}</Link>
        : <h1 className="min-w-0 truncate text-2xl font-bold text-co-text">{name}</h1>}
      <span className={p.emailMarketing === "opted_in" ? "rounded-lg bg-co-success-surface px-2 py-1 text-sm font-bold text-co-confirm-text" : "rounded-lg bg-co-surface-inset px-2 py-1 text-sm text-co-text-muted"}>
        {t(`customers.marketing.${p.emailMarketing}` as TranslationKey)}
      </span>
    </div>
    <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 text-co-text sm:grid-cols-4">
      <div><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("customers.stats.visits")}</dt><dd className="font-bold">{p.visits}</dd></div>
      <div><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("customers.stats.spend")}</dt><dd className="font-bold">{p.spendCents === null ? t("customers.stats.unknown") : formatCents(p.spendCents, language)}</dd></div>
      <div><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("customers.stats.lastOrder")}</dt><dd>{p.lastOrder ? formatDateLabel(p.lastOrder, language) : t("customers.stats.unknown")}</dd></div>
      <div><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("customers.stats.frequency")}</dt><dd>{p.avgDaysBetween === null ? t("customers.stats.once") : t("customers.stats.everyDays", { days: p.avgDaysBetween })}</dd></div>
    </dl>
    {p.favourites.length > 0 && <p className="text-sm text-co-text"><span className="font-bold">{t("customers.stats.favourites")}:</span> {p.favourites.map((f) => `${f.name} ×${f.qty}`).join(" · ")}</p>}
    {p.channels.length > 0 && <p className="text-sm text-co-text-muted">{t("customers.stats.channels")}: {p.channels.map((c) => `${channel(c.channel)} (${c.visits})`).join(" · ")}</p>}
    {p.maskedChannels.length > 0 && <p className="text-sm text-co-warning-text">{t("customers.stats.masked", { channels: p.maskedChannels.join(", ") })}</p>}
    {p.cards > 0 && <p className="text-sm text-co-text-muted">{t("customers.stats.cards", { count: p.cards })}</p>}
  </article>;
}
