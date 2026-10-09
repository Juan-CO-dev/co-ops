import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";
import { operationalNow } from "@/lib/midshift";
import { CUSTOMER_CONTACT_MIN, customerProfilesEnabled, loadConsentOverview } from "@/lib/customers/customers";
import { ConsentTools } from "@/components/admin/customers/ConsentTools";
import { CancelImportButton } from "@/components/admin/customers/CancelImportButton";

/**
 * 0234 consent desk (level 9+): the Toast Web Marketing list import, the opted-in-only exports (Meta
 * hashed, OFF until Pete's OK), "newly opted in", delete-on-request intake, retention.
 */
export default async function ConsentPage() {
  const auth = await requireSessionFromHeaders("/admin/customers/consent");
  if (auth.level < CUSTOMER_CONTACT_MIN) redirect("/admin/customers");
  if (!customerProfilesEnabled()) redirect("/admin/customers");
  const language = auth.user.language;
  const t = (k: Parameters<typeof serverT>[1], p?: Record<string, string | number>) => serverT(language, k, p);
  const viewer = { userId: auth.user.id, level: auth.level, locations: auth.locations };
  const overview = await loadConsentOverview(viewer);
  const today = operationalNow(new Date()).date;
  return <div className="min-w-0 space-y-4">
    <Link href="/admin/customers" className="inline-flex min-h-[44px] items-center font-bold text-co-text underline">{t("customers.back")}</Link>
    <h1 className="text-2xl font-bold text-co-text">{t("customers.consent.title")}</h1>
    <p className="text-co-text-muted">{t("customers.consent.intro", { count: overview.optedIn })}</p>
    <ConsentTools metaEnabled={overview.metaEnabled} today={today} />
    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("customers.newly.title", { count: overview.newlyOptedIn.length })}</h2>
      <p className="text-sm text-co-text-muted">{t("customers.newly.hint")}</p>
      {overview.newlyOptedIn.length === 0 ? <p className="text-sm text-co-text-muted">{t("customers.newly.none")}</p>
        : <ul className="space-y-2">{overview.newlyOptedIn.map((r) => <li key={r.customerId} className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-co-border p-3">
          <Link href={`/admin/customers/${r.customerId}`} className="inline-flex min-h-[44px] min-w-0 items-center truncate font-bold text-co-text underline">{r.name ?? t("customers.unnamed")}</Link>
          <span className="text-sm text-co-text-muted">{formatDateLabel(r.optedInAt.slice(0, 10), language)} · {t(r.previous === "opted_out" ? "customers.newly.wasOut" : "customers.newly.wasNone")}{r.hadOrders ? ` · ${t("customers.newly.hadOrders")}` : ""}</span>
        </li>)}</ul>}
    </section>
    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("customers.imports.title")}</h2>
      {overview.imports.length === 0 ? <p className="text-sm text-co-text-muted">{t("customers.imports.none")}</p>
        : <ul className="space-y-2">{overview.imports.map((i) => <li key={i.id} className="rounded-xl border border-co-border p-3 text-co-text">
          <p className="font-bold">{t("customers.imports.row", { date: formatDateLabel(i.exportDate, language), rows: i.rowsTotal })}</p>
          <p className="text-sm text-co-text-muted">{i.status === "cancelled" ? t("customers.imports.cancelled") : i.status === "failed" ? t("customers.imports.failed")
            : t(i.status === "completed" ? "customers.import.summary" : "customers.imports.running", { in: i.newOptIns, out: i.optOuts })}{i.baseline ? ` · ${t("customers.imports.baseline")}` : ""}</p>
          {i.status === "running" && <CancelImportButton importId={i.id} />}
        </li>)}</ul>}
    </section>
  </div>;
}
