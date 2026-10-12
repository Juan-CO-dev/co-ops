import Link from "next/link";
import type { Language } from "@/lib/i18n/types";
import type { loadProfileDetail, ProfileLinkDto } from "@/lib/customers/customers";
import { formatCents, formatMonthLabel, formatTrendMonthLabels } from "@/lib/i18n/format";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { RevokeLinkButton } from "./RevokeLinkButton";
import { customerDisplay, customerPill } from "./customer-display";

export function ProfileDetail({ detail: d, language, canRevoke }: { detail: Awaited<ReturnType<typeof loadProfileDetail>>; language: Language; canRevoke: boolean }) {
  const { t, money, date, last, channel } = customerDisplay(language, d.today);
  const p = d.profile;
  const shops = new Map(d.shopNames.map((s) => [s.id, s.name]));
  const shop = (id: string) => shops.get(id) ?? t("customers.list.unknownShop");
  const max = Math.max(1, ...d.months.map((m) => m.visits));
  const linkRow = (l: ProfileLinkDto) => <article key={l.id} className="min-w-0 space-y-2 border-t border-co-border py-3 [overflow-wrap:anywhere]">
    <p>{l.person ? <Link className="inline-flex min-h-[44px] items-center font-bold underline" href={`/admin/customers/${l.person.id}`}>{l.person.name ?? t("customers.unnamed")}</Link> : t("customers.link.otherShop")}</p>
    <p className="text-sm text-co-text-muted">{t("customers.link.confidence", { percent: Math.round(l.confidence * 100) })} · {l.reasons.map((r) => t(`customers.link.reason.${r}`)).join(" · ")}</p>
    {l.stats && <dl className="grid grid-cols-2 gap-2 text-sm">
      <div><dt>{t("customers.stats.visits")}</dt><dd>{l.stats.visits}</dd></div><div><dt>{t("customers.stats.spend")}</dt><dd>{money(l.stats.spendCents)}</dd></div>
      <div><dt>{t("customers.profile.firstOrder")}</dt><dd>{date(l.stats.firstOrder)}</dd></div><div><dt>{t("customers.stats.lastOrder")}</dt><dd>{date(l.stats.lastOrder)}</dd></div>
    </dl>}
    {canRevoke && <RevokeLinkButton linkId={l.id} />}
  </article>;
  // Twelve months always cross a year boundary unless it is December: the labels then carry the year.
  const monthLabels = formatTrendMonthLabels(d.months.map((m) => m.month), language);
  const historyHeadings = ["date", "shop", "channel", "total", "items"] as const;
  const historyCells = (o: typeof d.history.rows[number]) => [date(o.date), shop(o.locationId), <span key="channel">{channel(o.channel)}{o.source !== "toast" && <span className="block text-xs">{t(`customers.source.${o.source}`)}</span>}</span>, money(o.totalCents),
    `${o.items.map((i) => `${i.name} ×${i.qty}`).join(" · ")}${o.moreItems ? ` ${t("customers.history.more", { count: o.moreItems })}` : ""}`];
  return <>
    <section className="co-card min-w-0 space-y-3 p-4 [overflow-wrap:anywhere]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-2xl font-bold">{d.isGuest ? t("customers.list.guestName", { name: p.name ?? t("customers.unnamed") }) : p.name ?? t("customers.unnamed")}</h1>
        <span className="rounded-lg bg-co-surface-inset px-2 py-1 text-sm">{t(`customers.marketing.${p.emailMarketing}`)}</span>
      </div>
      {p.maskedChannels.length > 0 && <p className="text-sm text-co-warning-text">{t("customers.stats.masked", { channels: p.maskedChannels.join(", ") })}</p>}
      <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">{([
        [t("customers.stats.visits"), p.visits], [t("customers.stats.spend"), money(p.spendCents)],
        [t("customers.list.avgOrder"), money(p.spendCents === null || !p.visits ? null : Math.round(p.spendCents / p.visits))],
        [t("customers.profile.firstOrder"), date(p.firstOrder)], [t("customers.stats.lastOrder"), last(p.lastOrder)],
        [t("customers.stats.frequency"), p.avgDaysBetween === null ? t("customers.stats.once") : t("customers.stats.everyDays", { days: p.avgDaysBetween })],
        [t("customers.list.cards"), p.cards], [t("customers.list.shops"), d.shops.length],
      ] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold">{t("customers.profile.months")}</h2>
      <div className="grid grid-cols-12 gap-1">{d.months.map((m, i) => <div key={m.month} className="min-w-0 text-center text-[10px]" role="img"
        aria-label={t("customers.profile.monthBar", { month: formatMonthLabel(m.month, language), visits: m.visits, spend: m.spendCents === null ? t("customers.stats.unknown") : formatCents(m.spendCents, language) })}>
        <div className="flex h-24 items-end"><div className="w-full rounded-t bg-co-gold" style={{ height: `${m.visits / max * 100}%` }} /></div>
        <span className="block">{monthLabels[i]}</span><span className="block font-bold">{m.visits}</span>
      </div>)}</div>
    </section>
    {d.shops.length > 1 && <section className="co-card min-w-0 p-4"><h2 className="text-lg font-bold">{t("customers.profile.byShop")}</h2>
      {d.shops.map((s) => <div key={s.locationId} className="grid min-w-0 grid-cols-2 gap-2 border-t border-co-border py-3 [overflow-wrap:anywhere]">
        <span className="font-bold">{shop(s.locationId)}</span><span>{t("customers.profile.shopVisits", { count: s.visits })}</span><span>{money(s.spendCents)}</span><span>{date(s.lastOrder)}</span>
      </div>)}
    </section>}
    <section className="co-card min-w-0 space-y-2 p-4 [overflow-wrap:anywhere]">
      <h2 className="text-lg font-bold">{t("customers.stats.favourites")}</h2>
      <p>{p.favourites.map((f) => `${f.name} ×${f.qty}`).join(" · ") || t("customers.stats.unknown")}</p>
      <p className="text-sm text-co-text-muted">{t("customers.stats.channels")}: {p.channels.map((c) => `${channel(c.channel)} (${c.visits})`).join(" · ")}</p>
    </section>
    {d.catering && <section className="co-card min-w-0 space-y-2 p-4">
      <h2 className="text-lg font-bold">{t("customers.catering.title")}</h2>
      <p>{t("customers.catering.orderCount", { count: d.catering.orders })} · {money(d.catering.spendCents)}</p>
      <p>{t("customers.catering.last")}: {date(d.catering.lastOrder)}</p>
      <Link className={customerPill} href="/admin/customers/catering">{t("customers.catering.title")}</Link>
    </section>}
    {d.links.outgoing.length > 0 && <CollapsibleSection idBase="customer-probable" title={t("customers.link.probable", { count: d.links.outgoing.length })}>{d.links.outgoing.map(linkRow)}</CollapsibleSection>}
    {d.links.incoming.length > 0 && <CollapsibleSection idBase="customer-guests" title={t("customers.link.guests", { count: new Set(d.links.incoming.map((l) => l.person!.id)).size })}>
      <p className="text-sm text-co-text-muted">{t("customers.link.notCounted")}</p>{d.links.incoming.map(linkRow)}
    </CollapsibleSection>}
    <CollapsibleSection idBase="customer-history" title={t("customers.history.title", { count: d.history.total })}>
      <div className="hidden lg:block"><table className="w-full table-fixed text-left text-sm"><thead><tr>{historyHeadings.map((h) => <th key={h} scope="col" className="break-words p-2">{t(`customers.history.${h}`)}</th>)}</tr></thead>
        <tbody>{d.history.rows.map((o, i) => <tr key={i} className="border-t border-co-border">{historyCells(o).map((v, j) => <td key={j} className="p-2 [overflow-wrap:anywhere]">{v}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="space-y-3 lg:hidden">{d.history.rows.map((o, i) => <article key={i} className="co-card min-w-0 p-3"><dl className="grid grid-cols-2 gap-2">{historyCells(o).map((v, j) => <div key={j} className="min-w-0 [overflow-wrap:anywhere]"><dt className="text-[11px] font-bold text-co-text-dim">{t(`customers.history.${historyHeadings[j]!}`)}</dt><dd>{v}</dd></div>)}</dl></article>)}</div>
    </CollapsibleSection>
    {d.history.pages > 1 && <nav aria-label={t("customers.list.pages")} className="flex flex-wrap items-center gap-2">
      {d.history.page > 1 && <Link className={customerPill} href={`/admin/customers/${p.id}?page=${d.history.page - 1}`}>{t("customers.list.prev")}</Link>}
      <span>{t("customers.list.pageOf", { page: d.history.page, pages: d.history.pages })}</span>
      {d.history.page < d.history.pages && <Link className={customerPill} href={`/admin/customers/${p.id}?page=${d.history.page + 1}`}>{t("customers.list.next")}</Link>}
    </nav>}
  </>;
}
