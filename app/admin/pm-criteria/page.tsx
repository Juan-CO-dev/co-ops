import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShop } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverT } from "@/lib/i18n/server";
import { canEditPmCriteria, peopleActorFromAuth } from "@/lib/people/access-shared";
import { loadCriteriaEditor, PmCriteriaError } from "@/lib/pm-criteria";
import { PmCriteriaEditor } from "@/components/pm-report-v2/PmCriteriaEditor";

/**
 * Scheduling Phase 1, Task 22 (R10): the PM v2 criteria editor. GM own shop, MoO+ any (canEditPmCriteria);
 * every write takes the Tier E edit window, which opens only on the admin surface (this layout's
 * StepUpProvider has `catalogWindow`) — which is why the editor lives under /admin and not under /settings.
 * Criteria are DATA: seeded once per shop (scripts/seed-pm-criteria.ts, Juan's word) and edited here.
 */
export default async function PmCriteriaPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/pm-criteria");
  const actor = peopleActorFromAuth(auth);
  const language = auth.user.language;
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  const locations = ((data ?? []) as { id: string; name: string }[]).filter((l) => canEditPmCriteria(actor, l.id));
  if (locations.length === 0) redirect("/admin");
  const sp = await searchParams;
  const selected = (await resolveShop(locations, shopParamFor("/admin/pm-criteria", searchParamValues(sp)))) ?? undefined; // B2: ?loc= → remembered → first
  const view = selected ? await loadCriteriaEditor(sb, { actor, locationId: selected.id }).catch((e: unknown) => {
    if (e instanceof PmCriteriaError && e.code === "pm_v2_unavailable") return null;
    throw e;
  }) : null;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "pmCriteria.title")}</h1>
    <p className="text-co-text-muted">{serverT(language, "pmCriteria.intro")}</p>
    {locations.length > 1 && <nav aria-label={serverT(language, "pmCriteria.shopPicker")} className="flex flex-wrap gap-2">{locations.map((location) =>
      <Link key={location.id} href={`/admin/pm-criteria?loc=${location.id}`} aria-current={location.id === selected?.id ? "page" : undefined}
        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{location.name}</Link>)}</nav>}
    {view ? <PmCriteriaEditor key={view.locationId} view={view} /> : <p className="co-card p-4 text-sm text-co-text">{serverT(language, "pmCriteria.unavailable")}</p>}
  </div>;
}
