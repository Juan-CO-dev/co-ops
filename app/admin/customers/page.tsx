import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import { etCalendarDate } from "@/lib/operational-day";
import { CUSTOMER_CONTACT_MIN, CUSTOMER_STATS_MIN, customerProfilesEnabled, loadCustomerList, loadCustomerSummary, loadCustomerShops, loadSuggestions } from "@/lib/customers/customers";
import { listParamsQuery } from "@/lib/customers/list-params-shared";
import { CustomerSuggestions } from "@/components/admin/customers/CustomerSuggestions";
import { CustomerListControls } from "@/components/admin/customers/CustomerListControls";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";

const pill = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 font-bold text-co-text";

/** Stats-only directory: contact values are never loaded or passed to client components. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireSessionFromHeaders("/admin/customers");
  if (auth.level < CUSTOMER_STATS_MIN) redirect("/admin");
  const language = auth.user.language;
  const t = (k: Parameters<typeof serverT>[1], p?: Record<string, string | number>) => serverT(language, k, p);
  if (!customerProfilesEnabled()) {
    return <div className="space-y-4"><h1 className="text-2xl font-bold text-co-text">{t("customers.title")}</h1>
      <p className="co-card p-4 text-co-text-muted">{t("customers.disabled")}</p></div>;
  }
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const raw = await searchParams;
  const [list, summary, shops, suggestions] = await Promise.all([
    loadCustomerList(viewer, raw), loadCustomerSummary(viewer, raw), loadCustomerShops(viewer), loadSuggestions(viewer),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const href = (changes: Record<string, string | null>) => {
    const query = listParamsQuery(list.params);
    for (const [key, value] of Object.entries(changes)) { if (value === null) query.delete(key); else query.set(key, value); }
    return `/admin/customers?${query}`;
  };
  // Summary numbers describe the selected shop, so a chip starts a fresh lens within that shop.
  const summaryHref = (changes: Record<string, string>) => {
    const query = new URLSearchParams(changes);
    if (list.params.locationId) query.set("location", list.params.locationId);
    return `/admin/customers?${query}`;
  };
  const shopNames = new Map(shops.map((s) => [s.id, s.name]));
  const money = (value: number | null) => value === null ? <span title={t("customers.stats.unknown")} aria-label={t("customers.stats.unknown")}>—</span> : formatCents(value, language);
  const lastOrder = (date: string | null) => {
    if (!date) return t("customers.stats.unknown");
    const today = etCalendarDate(new Date().toISOString());
    const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(date.slice(0, 10))) / 86400000));
    return <span>{t("customers.list.daysAgo", { days })}<span className="block text-xs text-co-text-muted">{formatDateLabel(date.slice(0, 10), language)}</span></span>;
  };
  const headings = ["name", "visits", "spend", "avgOrder", "lastOrder", "cards", "catering", "shops"] as const;
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-bold text-co-text">{t("customers.title")}</h1>
      {auth.level >= CUSTOMER_CONTACT_MIN && <Link href="/admin/customers/consent" className={pill}>{t("customers.consent.link")}</Link>}
    </div>
    <p className="text-co-text-muted">{t(auth.level >= CUSTOMER_CONTACT_MIN ? "customers.intro.owner" : "customers.intro.manager")}</p>
    <nav aria-label={t("customers.summary.title")} className="flex flex-wrap gap-2">
      <Link className={pill} href={summaryHref({})}>{t("customers.summary.people", { count: summary.people })}</Link>
      {auth.level >= CUSTOMER_CONTACT_MIN && summary.reachable !== undefined && <Link className={pill} href={summaryHref({ reachable: "1" })}>{t("customers.summary.reachable", { count: summary.reachable })}</Link>}
      {([ ["regulars", summary.regulars], ["lapsed", summary.lapsed], ["both_shops", summary.bothShops], ["catering", summary.catering] ] as const).map(([segment, count]) => <Link key={segment} className={pill} href={summaryHref({ segment })}>{t(`customers.summary.${segment}`, { count })}</Link>)}
      <Link className={pill} href={summaryHref({ only_guests: "1" })}>{t("customers.summary.guests", { count: summary.guests, linked: summary.guestsLinked })}</Link>
    </nav>
    <CustomerListControls params={list.params} level={auth.level} shops={shops} />
    <h2 className="text-lg font-bold text-co-text">{t("customers.list.title", { count: list.total })}</h2>
    {list.profiles.length === 0 ? <p className="co-card p-4 text-co-text-muted">{t("customers.list.noMatches")}</p> : <>
      <div className="hidden lg:block"><table className="w-full table-fixed text-left text-sm text-co-text"><thead><tr>{headings.map((h) => <th key={h} scope="col" className="break-words px-2 py-3">{t(`customers.list.${h}`)}</th>)}</tr></thead><tbody>
        {list.profiles.map((p) => <tr key={p.id} className="border-t border-co-border">
          <th scope="row" className="break-words px-2 py-3"><Link className="inline-flex min-h-[44px] items-center underline" href={`/admin/customers/${p.id}`}>{p.isGuest ? t("customers.list.guestName", { name: p.name ?? t("customers.unnamed") }) : p.name ?? t("customers.unnamed")}</Link></th>
          <td className="px-2 py-3">{p.visits}</td><td className="break-words px-2 py-3">{money(p.spendCents)}</td><td className="break-words px-2 py-3">{money(p.avgOrderCents)}</td><td className="px-2 py-3">{lastOrder(p.lastOrder)}</td><td className="px-2 py-3">{p.cards}</td><td className="px-2 py-3">{p.cateringOrders}</td>
          <td className="break-words px-2 py-3">{p.shops.map((id) => <span key={id} className="mb-1 block rounded-lg bg-co-surface-inset px-2 py-1">{shopNames.get(id) ?? t("customers.list.unknownShop")}</span>)}</td>
        </tr>)}
      </tbody></table></div>
      <div className="space-y-3 lg:hidden">{list.profiles.map((p) => <article key={p.id} className="co-card min-w-0 space-y-2 p-4">
        <Link className="flex min-h-[44px] items-center break-words text-lg font-bold text-co-text underline" href={`/admin/customers/${p.id}`}>{p.isGuest ? t("customers.list.guestName", { name: p.name ?? t("customers.unnamed") }) : p.name ?? t("customers.unnamed")}</Link>
        <dl className="grid min-w-0 grid-cols-2 gap-3 text-co-text">{([
          ["visits", p.visits], ["spend", money(p.spendCents)], ["avgOrder", money(p.avgOrderCents)], ["lastOrder", lastOrder(p.lastOrder)], ["cards", p.cards], ["catering", p.cateringOrders],
        ] as const).map(([key, value]) => <div key={key} className="min-w-0 break-words"><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t(`customers.list.${key}`)}</dt><dd>{value}</dd></div>)}</dl>
        <div className="flex flex-wrap gap-1">{p.shops.map((id) => <span key={id} className="max-w-full break-words rounded-lg bg-co-surface-inset px-2 py-1 text-sm text-co-text">{shopNames.get(id) ?? t("customers.list.unknownShop")}</span>)}</div>
      </article>)}</div>
    </>}
    {pages > 1 && <nav aria-label={t("customers.list.pages")} className="flex flex-wrap items-center gap-2">
      {list.page > 1 && <Link className={pill} href={href({ page: String(list.page - 1) })}>{t("customers.list.prev")}</Link>}
      <span className="text-co-text-muted">{t("customers.list.pageOf", { page: list.page, pages })}</span>
      {list.page < pages && <Link className={pill} href={href({ page: String(list.page + 1) })}>{t("customers.list.next")}</Link>}
    </nav>}
    <CollapsibleSection idBase="customer-suggestions" title={t("customers.list.suggestions", { count: suggestions.length })}><CustomerSuggestions suggestions={suggestions} /></CollapsibleSection>
  </div>;
}
