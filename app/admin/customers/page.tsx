import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { CUSTOMER_CONTACT_MIN, CUSTOMER_STATS_MIN, customerProfilesEnabled, loadProfilePage, loadSuggestions } from "@/lib/customers/customers";
import { CustomerSuggestions } from "@/components/admin/customers/CustomerSuggestions";
import { ProfileStats } from "@/components/admin/customers/ProfileStats";

const pill = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 font-bold text-co-text";

/**
 * 0234 customer profiles. GM+ (own shop) / level 8+ (every shop): profile STATS only — visits, spend,
 * favourites, channel, last order, frequency — and the "likely same person" queue. No email or phone
 * is ever loaded for this page. Level 9+ also gets the consent desk link.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/customers");
  if (auth.level < CUSTOMER_STATS_MIN) redirect("/admin");
  const language = auth.user.language;
  const t = (k: Parameters<typeof serverT>[1], p?: Record<string, string | number>) => serverT(language, k, p);
  if (!customerProfilesEnabled()) {
    return <div className="space-y-4"><h1 className="text-2xl font-bold text-co-text">{t("customers.title")}</h1>
      <p className="co-card p-4 text-co-text-muted">{t("customers.disabled")}</p></div>;
  }
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const { q, page } = await searchParams;
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const [list, suggestions] = await Promise.all([
    loadProfilePage(viewer, { search: q, page: pageNumber }),
    loadSuggestions(viewer),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const href = (n: number) => `/admin/customers?${new URLSearchParams({ ...(list.search ? { q: list.search } : {}), page: String(n) })}`;
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-2xl font-bold text-co-text">{t("customers.title")}</h1>
      {auth.level >= CUSTOMER_CONTACT_MIN && <Link href="/admin/customers/consent" className={pill}>{t("customers.consent.link")}</Link>}
    </div>
    <p className="text-co-text-muted">{t(auth.level >= CUSTOMER_CONTACT_MIN ? "customers.intro.owner" : "customers.intro.manager")}</p>
    <form className="flex min-w-0 flex-wrap items-end gap-2" action="/admin/customers">
      <label className="grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim">{t("customers.search")}
        <input name="q" aria-label={t("customers.search")} defaultValue={list.search ?? ""} className="min-h-[44px] min-w-0 rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text" />
      </label>
      <button type="submit" className={pill}>{t("customers.searchSubmit")}</button>
    </form>
    <CustomerSuggestions suggestions={suggestions} />
    <h2 className="text-lg font-bold text-co-text">{t("customers.list.title", { count: list.total })}</h2>
    {list.profiles.length === 0 ? <p className="co-card p-4 text-co-text-muted">{t("customers.list.empty")}</p>
      : <div className="space-y-3">{list.profiles.map((p) => <ProfileStats key={p.id} p={p} language={language} link />)}</div>}
    {pages > 1 && <nav aria-label={t("customers.list.pages")} className="flex flex-wrap items-center gap-2">
      {list.page > 1 && <Link className={pill} href={href(list.page - 1)}>{t("customers.list.prev")}</Link>}
      <span className="text-co-text-muted">{t("customers.list.pageOf", { page: list.page, pages })}</span>
      {list.page < pages && <Link className={pill} href={href(list.page + 1)}>{t("customers.list.next")}</Link>}
    </nav>}
  </div>;
}
