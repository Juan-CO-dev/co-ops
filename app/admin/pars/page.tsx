import { ParsTabs } from "@/components/admin/pars/ParsTabs";
import { PrepParsClient, type PrepParsView } from "@/components/admin/pars/PrepParsClient";
import { loadChecklistLocationView } from "@/lib/admin/templates";
import { getRoleLevel } from "@/lib/roles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ParsClient } from "@/components/admin/pars/ParsClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { loadPars } from "@/lib/admin/pars";
import { canViewPars, type ParsView } from "@/lib/admin/pars-shared";
import { serverT } from "@/lib/i18n/server";
import { lockLocationContext } from "@/lib/locations";
import { OrderingError } from "@/lib/ordering";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShopId } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";

export default async function AdminParsPage({ searchParams }: {
  searchParams: Promise<{ location?: string | string[]; tab?: string | string[] }>;
}) {
  const auth = await requireSessionFromHeaders("/admin/pars");
  if (!canViewPars(auth.user.role)) redirect("/dashboard");
  const lang = auth.user.language;
  const sp = await searchParams;
  const tab = sp.tab === "prep" ? "prep" : "vendor";
  const explicit = shopParamFor("/admin/pars", searchParamValues(sp));
  const actor = { role: auth.user.role, locations: auth.locations };
  if (explicit && !lockLocationContext(actor, explicit)) redirect("/dashboard");
  const { data, error } = await getServiceRoleClient().from("locations")
    .select("id, name, code").eq("active", true).order("name")
    .returns<Array<{ id: string; name: string; code: string }>>();
  if (error) throw new Error(`pars locations: ${error.message}`);
  const locations = (data ?? []).filter((l) => lockLocationContext(actor, l.id));
  if (explicit && !locations.some((l) => l.id === explicit)) redirect("/dashboard");
  const locationId = await resolveShopId(locations.map((l) => l.id), explicit);
  let prepViews: PrepParsView[] = [];
  let view: ParsView | null = null;
  if (locationId) {
    try {
      if (tab === "prep") {
        // Prep pars use checklist par authority, not the ordering task permission.
        const loc = locations.find((l) => l.id === locationId)!;
        prepViews = await Promise.all((["am_prep", "mid_day_prep"] as const).map(async (subtype) => ({ ...await loadChecklistLocationView(auth, loc, subtype), subtype })));
      } else view = await loadPars(auth, locationId);
    }
    catch (e) {
      if (e instanceof OrderingError && (e.status === 403 || e.status === 404)) redirect("/dashboard");
      throw e;
    }
  }
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader title={serverT(lang, "admin.pars.title")} subtitle={serverT(lang, "admin.pars.subtitle")} />
      <nav aria-label={serverT(lang, "admin.pars.shops")} className="flex flex-wrap gap-2">
        {locations.map((l) => <Link key={l.id} href={`/admin/pars?location=${encodeURIComponent(l.id)}${tab === "prep" ? "&tab=prep" : ""}`}
          aria-current={l.id === locationId ? "page" : undefined}
          className={`inline-flex min-h-[44px] max-w-full items-center break-words rounded-lg border-2 px-4 py-2 text-sm font-bold ${l.id === locationId ? "border-co-gold-deep bg-co-surface-2" : "border-co-border bg-co-surface"}`}>
          {l.name}
        </Link>)}
      </nav>
      {locationId ? <ParsTabs tab={tab} locationId={locationId}>
        {tab === "prep" ? <PrepParsClient key={locationId} views={prepViews} canEdit={getRoleLevel(auth.user.role) >= 6} /> : view && <ParsClient key={locationId} view={view} />}
      </ParsTabs> :
        <p className="text-sm text-co-text-muted">{serverT(lang, "admin.pars.no_location")}</p>}
    </div>
  );
}
