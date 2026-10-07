import { reportLandingContext } from "@/lib/report-navigation";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReportPageNav } from "@/components/reports-hub/ReportPageNav";
import { ReportShopTabs } from "@/components/reports-hub/ReportShopTabs";
import { ReportRangeControls } from "@/components/reports-hub/ReportRangeControls";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import { canReadReportLocation, lockLocationContext, REPORT_ALL_LOCATIONS_LEVEL } from "@/lib/locations";
import { operationalNow } from "@/lib/midshift";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { parseReportRange, reportRangeParams, shiftReportDate } from "@/lib/report-range";
import { composeLastClose, composeReportSummary, reportIsFinalized } from "@/lib/report-summary";
import { listReports, listReportSkeleton, type Viewer } from "@/lib/reports-hub";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const auth = await requireSessionFromHeaders("/reports");
  if (auth.level < 2) redirect("/dashboard");
  const params = reportLandingContext(await searchParams);
  const actor = { role: auth.role, locations: auth.locations };
  const locationId = params.location ?? auth.locations[0];
  if (!locationId || (locationId === "all" ? auth.level < REPORT_ALL_LOCATIONS_LEVEL : !canReadReportLocation(actor, locationId))) redirect("/dashboard");
  const service = getServiceRoleClient();
  let locationsQuery = service.from("locations").select("id,name").eq("active", true).order("name");
  if (auth.level < REPORT_ALL_LOCATIONS_LEVEL) locationsQuery = locationsQuery.in("id", auth.locations);
  const { data: shops, error } = await locationsQuery;
  if (error) throw new Error(`report locations: ${error.message}`);
  const locations = (shops ?? []) as Array<{ id: string; name: string }>;
  const selected = locations.filter((shop) => locationId === "all" || shop.id === locationId);
  if (selected.length === 0) redirect("/dashboard");
  const language = auth.user.language;
  const t = (key: TranslationKey, values?: Record<string, string | number>) => serverT(language, key, values);
  const today = operationalNow(new Date()).date;
  const yesterday = shiftReportDate(today, -1);
  const range = parseReportRange(params, today);
  const viewer: Viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const context = (shopId: string, additions: Record<string, string> = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
    for (const [key, value] of reportRangeParams(range)) query.set(key, value);
    query.set("location", shopId);
    query.delete("returnLocation");
    if (locationId === "all") query.set("hubLocation", "all");
    for (const [key, value] of Object.entries(additions)) query.set(key, value);
    return query.toString();
  };
  // Summary counts intentionally aggregate the bounded authorized window, unlike paged lists.
  const panels = await Promise.all(selected.map(async (shop) => {
    const load = (from: string, to: string) => listReports(service, { viewer, locationId: shop.id, dateFrom: from, dateTo: to });
    const [current, previous, lastDay, receiving, ordering] = await Promise.all([
      load(range.from, range.to), range.compare ? load(range.previous.from, range.previous.to) : Promise.resolve([]),
      listReportSkeleton(service, { viewer, locationId: shop.id, dateFrom: yesterday, dateTo: yesterday }),
      auth.level >= 4 && lockLocationContext(actor, shop.id) ? canDoOperationalTask(auth, shop.id, "receiving") : false,
      auth.level >= 4 && lockLocationContext(actor, shop.id) ? canDoOperationalTask(auth, shop.id, "ordering") : false,
    ]);
    return { shop, current: composeReportSummary(current), previous: composeReportSummary(previous), close: composeLastClose(lastDay, auth.level), receiving, ordering };
  }));
  const linkClass = "inline-flex min-h-[44px] items-center rounded-lg border border-co-border-2 px-3 py-2 text-sm font-bold hover:bg-co-surface-2";
  return <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6 lg:max-w-5xl">
    <ReportPageNav viewerLevel={auth.level} path="/reports" params={{ ...params, location: locationId }} language={language} />
    <h1 className="mb-4 text-lg font-bold text-co-text">{t("reports.page.title")}</h1>
    <ReportShopTabs path="/reports" params={params} locationId={locationId} language={language} viewer={auth} />
    <ReportRangeControls range={range} locationId={locationId} language={language} />
    {auth.level < 4 && <p className="mb-4 text-sm text-co-text-muted">{t("reports.hub.own_scope")}</p>}
    {panels.map(({ shop, current, previous, close, receiving, ordering }) => {
      const dayContext = context(shop.id, { range: "custom", from: yesterday, to: yesterday });
      const signals = { underPar: current.signals.underPar, overPar: current.signals.overPar, skipped: current.signals.skipped, tempFlag: current.signals.tempFlags, ...(auth.level >= 4 ? { cashOver: current.cashOver, cashShort: current.cashShort } : {}) };
      const priorSignals = { underPar: previous.signals.underPar, overPar: previous.signals.overPar, skipped: previous.signals.skipped, tempFlag: previous.signals.tempFlags, cashOver: previous.cashOver, cashShort: previous.cashShort };
      return <section key={shop.id} className="mb-6 rounded-xl border border-co-border bg-co-surface p-4">
        <h2 className="text-base font-bold">{shop.name}</h2>
        <h3 className="mt-3 text-sm font-bold">{t(close.ownScope ? "reports.hub.your_submissions" : "reports.hub.last_close", { date: formatDateLabel(yesterday, language) })}</h3>
        {close.noActivity ? <p className="py-3 text-sm text-co-text-muted">{t("reports.hub.no_activity")}</p> : close.ownScope ? <ul>
          {close.submissions.map((item) => <li key={`${item.type}:${item.id}`}><Link className="inline-flex min-h-[44px] items-center gap-2 text-sm underline" href={`/reports/${item.type}/${item.id}?${dayContext}`}>{t(`reports.type.${item.type}` as TranslationKey)} · {t(reportIsFinalized(item) ? "reports.hub.done" : "reports.hub.not_finalized")}</Link></li>)}
        </ul> : <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {close.reports.map(({ type, state, item }) => <li key={type}><Link className={`${linkClass} w-full justify-between gap-3`} href={item ? `/reports/${type}/${item.id}?${dayContext}` : `/reports/operations?${dayContext}&type=${type}`}><span>{t(`reports.type.${type}` as TranslationKey)}</span><span>{t(`reports.hub.${state}` as TranslationKey)}</span></Link></li>)}
        </ul>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link className={linkClass} href={`/reports/operations?${context(shop.id)}`}>{t("reports.hub.total", { n: current.total })}</Link>
          {range.compare && <span className="inline-flex min-h-[44px] items-center text-sm">{t("reports.hub.previous", { n: previous.total })}</span>}
          {Object.entries(signals).map(([signal, n]) => <Link className={linkClass} key={signal} href={`/reports/operations?${context(shop.id, { [`sf_${signal}`]: "true" })}`}>{t(`reports.hub.${signal}` as TranslationKey, { n })}{range.compare ? ` · ${t("reports.hub.previous", { n: priorSignals[signal as keyof typeof priorSignals] })}` : ""}</Link>)}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <section className="rounded-lg border border-co-border p-3"><h3 className="mb-2 font-bold">{t("reports.hub.operations")}</h3><div className="flex flex-wrap gap-2"><Link className={linkClass} href={`/reports/operations?${context(shop.id)}`}>{t("reports.hub.operations")}</Link>{auth.level >= 4 && <Link className={linkClass} href={`/reports/trends/ops?${context(shop.id)}`}>{t("reports.hub.trends")}</Link>}</div></section>
          <Link className={linkClass} href={`/reports/written?${context(shop.id)}`}>{t("reports.hub.written")}</Link>
          <section className="rounded-lg border border-co-border p-3"><h3 className="mb-2 font-bold">{t("reports.hub.people")}</h3><div className="flex flex-wrap gap-2"><Link className={linkClass} href={`/my-feedback?${context(shop.id)}`}>{t("reports.hub.feedback")}</Link>{auth.level >= 6 && <Link className={linkClass} href={`/reports/trends/team?${context(shop.id)}`}>{t("reports.hub.team")}</Link>}</div></section>
          {auth.level >= 6 && <section className="rounded-lg border border-co-border p-3"><h3 className="font-bold">{t("reports.hub.sales")}</h3><p className="text-sm text-co-text-muted">{t("reports.hub.coming_next")}</p></section>}
          {lockLocationContext(actor, shop.id) && (auth.level >= 6 || receiving || ordering) && <section className="rounded-lg border border-co-border p-3"><h3 className="mb-2 font-bold">{t("reports.hub.inventory")}</h3><div className="flex flex-wrap gap-2">{auth.level >= 6 && <Link className={linkClass} href={`/operations/counts?location=${shop.id}`}>{t("reports.hub.counts")}</Link>}{receiving && <Link className={linkClass} href={`/operations/receiving?location=${shop.id}`}>{t("receiving.page.title")}</Link>}{ordering && <Link className={linkClass} href={`/ordering?location=${shop.id}`}>{t("nav.ordering")}</Link>}</div></section>}
          {auth.level >= 5 && lockLocationContext(actor, shop.id) && <Link className={linkClass} href="/catering/insights">{t("nav.catering")}</Link>}
          {auth.level >= 6 && <Link className={linkClass} href="/admin/menu-costing">{t("reports.hub.costing")}</Link>}
        </div>
      </section>;
    })}
  </main>;
}
