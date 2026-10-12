import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { CUSTOMER_ALL_SHOPS_MIN, CUSTOMER_STATS_MIN, customerProfilesEnabled, loadCateringAccounts, loadCustomerShops } from "@/lib/customers/customers";
import { CATERING_SORTS, type CateringAccount } from "@/lib/customers/catering-accounts-shared";
import type { CustomerListSearchParams } from "@/lib/customers/list-params-shared";
import { customerDisplay, customerPill } from "@/components/admin/customers/customer-display";

export default async function CateringAccountsPage({ searchParams }: { searchParams: Promise<CustomerListSearchParams> }) {
  const auth = await requireSessionFromHeaders("/admin/customers/catering");
  if (auth.level < CUSTOMER_STATS_MIN) redirect("/admin");
  if (!customerProfilesEnabled()) redirect("/admin/customers");
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const [list, shops] = await Promise.all([loadCateringAccounts(viewer, await searchParams), loadCustomerShops(viewer)]);
  const { t, money, last } = customerDisplay(auth.user.language, list.today);
  const names = new Map(shops.map((s) => [s.id, s.name]));
  const href = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams({ sort: list.params.sort });
    if (list.params.quiet) q.set("quiet", "1");
    if (list.params.locationId) q.set("location", list.params.locationId);
    for (const [k, v] of Object.entries(changes)) { if (v === null) q.delete(k); else q.set(k, v); }
    return `/admin/customers/catering?${q}`;
  };
  const headings = ["name", "orders", "spend", "average", "last", "allVisits", "sources", "shops"] as const;
  const cells = (r: CateringAccount) => [<Link key="name" className="inline-flex min-h-[44px] items-center font-bold underline" href={`/admin/customers/${r.id}`}>{r.name ?? t("customers.unnamed")}</Link>,
    r.orders, money(r.spendCents), money(r.avgOrderCents), last(r.lastOrder), r.allVisits,
    r.sources.map((s) => t(`customers.source.${s}`)).join(" · "), r.shops.map((id) => names.get(id) ?? t("customers.list.unknownShop")).join(" · ")];
  const control = "min-h-[44px] min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
  return <div className="min-w-0 space-y-4 text-co-text [overflow-wrap:anywhere]">
    <Link href="/admin/customers" className={customerPill}>{t("customers.back")}</Link>
    <h1 className="text-2xl font-bold">{t("customers.catering.title")}</h1>
    <nav aria-label={t("customers.catering.summary")} className="flex flex-wrap gap-2">
      <Link className={customerPill} href={href({ quiet: null, sort: "spend" })}>{t("customers.catering.accounts", { count: list.summary.accounts })}</Link>
      <span className={customerPill}>{t("customers.catering.repeat", { count: list.summary.repeat })}</span>
      <Link className={customerPill} href={href({ quiet: "1" })}>{t("customers.catering.quietCount", { count: list.summary.quiet })}</Link>
      <span className={customerPill}>{t("customers.catering.yearSpend")}: {money(list.summary.spendCents)}</span>
    </nav>
    <form action="/admin/customers/catering" className="flex min-w-0 flex-wrap items-end gap-3">
      <label className="grid min-w-0 max-w-full gap-1 text-sm font-bold">{t("customers.filter.sort")}<select name="sort" defaultValue={list.params.sort} className={control}>
        {CATERING_SORTS.map((s) => <option key={s} value={s}>{t(`customers.catering.sort.${s}`)}</option>)}
      </select></label>
      {auth.level >= CUSTOMER_ALL_SHOPS_MIN && <label className="grid min-w-0 max-w-full gap-1 text-sm font-bold">{t("customers.filter.shop")}
        <select name="location" defaultValue={list.params.locationId ?? ""} className={control}><option value="">{t("customers.filter.allShops")}</option>{shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </label>}
      <label className="flex min-h-[44px] min-w-0 items-center gap-2"><input type="checkbox" name="quiet" value="1" aria-label={t("customers.catering.quietOnly")} defaultChecked={list.params.quiet} />{t("customers.catering.quietOnly")}</label>
      <button type="submit" className="min-h-[44px] rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold">{t("customers.filter.apply")}</button>
    </form>
    <h2 className="text-lg font-bold">{t("customers.catering.accounts", { count: list.total })}</h2>
    {list.rows.length === 0 ? <p className="co-card p-4">{t("customers.catering.empty")}</p> : <>
      <div className="hidden lg:block"><table className="w-full table-fixed text-left text-sm"><thead><tr>{headings.map((h) => <th key={h} scope="col" className="p-2">{t(`customers.catering.${h}`)}</th>)}</tr></thead>
        <tbody>{list.rows.map((r) => <tr key={r.id} className="border-t border-co-border">{cells(r).map((v, i) => <td key={i} className="p-2">{v}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="space-y-3 lg:hidden">{list.rows.map((r) => <article key={r.id} className="co-card min-w-0 space-y-2 p-4">
        {cells(r)[0]}<dl className="grid min-w-0 grid-cols-2 gap-3">{cells(r).slice(1).map((v, i) => <div key={i} className="min-w-0"><dt className="text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t(`customers.catering.${headings[i + 1]!}`)}</dt><dd>{v}</dd></div>)}</dl>
      </article>)}</div>
    </>}
    {list.pages > 1 && <nav aria-label={t("customers.list.pages")} className="flex flex-wrap items-center gap-2">
      {list.params.page > 1 && <Link className={customerPill} href={href({ page: String(list.params.page - 1) })}>{t("customers.list.prev")}</Link>}
      <span>{t("customers.list.pageOf", { page: list.params.page, pages: list.pages })}</span>
      {list.params.page < list.pages && <Link className={customerPill} href={href({ page: String(list.params.page + 1) })}>{t("customers.list.next")}</Link>}
    </nav>}
  </div>;
}
