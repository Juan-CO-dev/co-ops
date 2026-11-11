import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { vendorMailRoleAllowed, type VendorMailFilters, type VendorMailStatus } from "@/lib/vendor-mail-shared";
import { listVendorMail, VendorMailError } from "@/lib/vendor-mail";
import { vendorMailOptions } from "@/lib/vendor-mail-options";
import { shopParamFor, searchParamValues } from "@/lib/shop-context-shared";
import { resolveShop } from "@/lib/shop-context";
import { etWallClockToUtcIso, etYmdMinusDays } from "@/lib/operational-day";
import { serverT } from "@/lib/i18n/server";
import { DashboardBackLink } from "@/components/DashboardBackLink";
import { VendorMailPane } from "./VendorMailPane";

export default async function VendorMailPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireSessionFromHeaders("/operations/vendor-mail");
  if (!vendorMailRoleAllowed(auth.user.role)) redirect("/dashboard");
  const sp = await searchParams;
  const param = (key: string) => typeof sp[key] === "string" ? sp[key] as string : undefined;
  const explicit = shopParamFor("/operations/vendor-mail", searchParamValues(sp));
  let options: Awaited<ReturnType<typeof vendorMailOptions>> | null = null;
  let initial: Awaited<ReturnType<typeof listVendorMail>> | null = null;
  let loadError: string | null = null;
  const from = param("from"), to = param("to");
  try {
    options = await vendorMailOptions(auth);
    // This inbox defaults to every authorized shop, preserving old unresolved messages.
    const shop = explicit && options.shops.some(s => s.id === explicit) ? await resolveShop(options.shops, explicit) : null;
    if (explicit && explicit !== "all" && explicit !== "unassigned" && !shop) throw new VendorMailError(400, "invalid_payload");
    if ([from, to].some(value => value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value))) throw new VendorMailError(400, "invalid_payload");
    const fromIso = from ? etWallClockToUtcIso(from, "00:00") : undefined;
    const toIso = to ? etWallClockToUtcIso(etYmdMinusDays(to, -1), "00:00") : undefined;
    if ((from && !fromIso) || (to && !toIso)) throw new VendorMailError(400, "invalid_payload");
    const filters: VendorMailFilters = { locationId: shop?.id ?? (explicit === "unassigned" ? "unassigned" : undefined), vendorId: param("vendor") || undefined, status: (param("status") || undefined) as VendorMailStatus | undefined, search: param("search"), stale: param("stale") === "1" ? true : undefined, receivedFrom: fromIso ?? undefined, receivedTo: toIso ? new Date(Date.parse(toIso) - 1).toISOString() : undefined };
    initial = await listVendorMail(auth, filters);
  } catch (error) {
    if (!(error instanceof VendorMailError)) throw error;
    loadError = error.code;
  }
  if (!initial || !options) return <main className="p-4"><DashboardBackLink /><h1>{serverT(auth.user.language, "vendorMail.title")}</h1><p role="alert">{serverT(auth.user.language, loadError === "invalid_payload" ? "vendorMail.error.invalid_payload" : "vendorMail.error.vendor_mail_unavailable")}</p></main>;
    return <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4"><DashboardBackLink /><VendorMailPane initial={initial} options={options} filters={{ location: explicit ?? "all", vendor: param("vendor") ?? "", status: param("status") ?? "", from: from ?? "", to: to ?? "", search: param("search") ?? "", stale: param("stale") === "1" }} forwardEnabled={process.env.VENDOR_MAIL_FORWARD_ENABLED === "1"} level={auth.level} /></main>;
}
