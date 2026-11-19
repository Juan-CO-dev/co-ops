import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShop } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverT } from "@/lib/i18n/server";
import { canViewSevenShiftsStatus, peopleActorFromAuth } from "@/lib/people/access-shared";
import { loadLinkScreen } from "@/lib/sevenshifts/links";
import { SevenShiftsScreen } from "@/components/admin/sevenshifts/SevenShiftsScreen";
import { PayrollShopCard } from "@/components/admin/sevenshifts/PayrollShopCard";
import { canManagePayrollShops } from "@/lib/facts/labor-payroll-shared";
import { loadPayrollShopCard } from "@/lib/facts/labor-payroll";
import { LaborBurdenCard } from "@/components/admin/sevenshifts/LaborBurdenCard";
import { canManageLaborBurden } from "@/lib/facts/labor-burden-shared";
import { loadLaborBurdenCard } from "@/lib/facts/labor-burden";
import { scheduleLaborViewsEnabled, type ScheduleLaborViewsEnv } from "@/lib/scheduling/labor-projection-shared";
import { BusinessVisibilityCard } from "@/components/admin/sevenshifts/BusinessVisibilityCard";
import { canManageBusinessVisibility } from "@/lib/business-access-shared";
import { businessReportEnabled } from "@/lib/business-report-shared";
import { loadBusinessVisibilityCard } from "@/lib/business-visibility";

/**
 * Scheduling Phase 1, Task 10: the 7shifts connection, the shop links (MoO+), the person links (GM own shop,
 * MoO+ any) and Sync now (MoO+). Viewers: GM and the operational level-6 managers at their own shops, MoO+
 * anywhere; the social media manager never (canViewSevenShiftsStatus). Without the token or the switch the
 * screen is the one status line and reads no 7shifts table.
 */
export default async function SevenShiftsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/sevenshifts");
  const actor = peopleActorFromAuth(auth);
  const language = auth.user.language;
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  const locations = ((data ?? []) as { id: string; name: string }[]).filter((l) => canViewSevenShiftsStatus(actor, l.id));
  if (locations.length === 0) redirect("/admin");
  const sp = await searchParams;
  const selected = (await resolveShop(locations, shopParamFor("/admin/sevenshifts", searchParamValues(sp)))) ?? undefined; // B2: ?loc= → remembered → first
  const screen = selected ? await loadLinkScreen(sb, { actor, locationId: selected.id }) : null;
  // Item 2: the payroll shop card (owner / CGS / MoO only; every shop's accounts, not the selected shop's).
  const payroll = canManagePayrollShops(auth.role) ? await loadPayrollShopCard(sb, { userId: auth.user.id, role: auth.role }) : null;
  // Board two labor views PR 2: the burden card, beside the payroll shop card (owner / CGS / MoO only; dark behind
  // SCHEDULE_LABOR_VIEWS with the two fact switches: nothing is read and nothing is shown while it is off).
  const burden = canManageLaborBurden(auth.role) && scheduleLaborViewsEnabled(process.env as ScheduleLaborViewsEnv)
    ? await loadLaborBurdenCard(sb, { userId: auth.user.id, role: auth.role }) : null;
  // Business report access: what GMs can see in the business report, beside the other labor money settings (owner /
  // CGS / MoO only; dark behind BUSINESS_REPORT with the two fact switches: nothing is read and nothing is shown
  // while it is off).
  const visibility = canManageBusinessVisibility(auth.role) && businessReportEnabled(process.env)
    ? await loadBusinessVisibilityCard(sb, { userId: auth.user.id, role: auth.role }) : null;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "sevenshifts.title")}</h1>
    <p className="text-co-text-muted">{serverT(language, "sevenshifts.intro")}</p>
    {locations.length > 1 && <nav aria-label={serverT(language, "sevenshifts.shopPicker")} className="flex flex-wrap gap-2">{locations.map((location) =>
      <Link key={location.id} href={`/admin/sevenshifts?loc=${location.id}`} aria-current={location.id === selected?.id ? "page" : undefined}
        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{location.name}</Link>)}</nav>}
    {screen && <SevenShiftsScreen key={screen.locationId} screen={screen} />}
    {payroll && <PayrollShopCard data={payroll.state === "ready" ? payroll : null} />}
    {burden && <LaborBurdenCard data={burden.state === "ready" ? burden : null} />}
    {visibility && <BusinessVisibilityCard key={visibility.state === "ready" ? visibility.headId ?? "defaults" : "unavailable"} data={visibility.state === "ready" ? visibility : null} />}
  </div>;
}
