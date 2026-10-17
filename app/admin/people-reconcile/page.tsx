import Link from "next/link";
import { redirect } from "next/navigation";
import { ReconcileList } from "@/components/admin/people-reconcile/ReconcileList";
import { serverT } from "@/lib/i18n/server";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { canViewReconciliation } from "@/lib/scheduling/access-shared";
import { ScheduleError } from "@/lib/scheduling/errors-shared";
import { loadReconciliation } from "@/lib/scheduling/reconcile";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShop } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * Scheduling Phase 2, Task 25 — THE THREE-WAY RECONCILIATION (CO-OPS user ↔ Toast employee ↔ 7shifts user), per shop,
 * for the last 14 operational days. GM at their own shops, MoO+ anywhere; the AGM, the social media manager (by ROLE),
 * the catering and prep managers never (`canViewReconciliation`, asked per shop below and again by the loader before any
 * read). Shop: ?loc= → remembered → first (B2). Read-only: the actions open the existing Toast and 7shifts link pages.
 */
export default async function PeopleReconcilePage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/people-reconcile");
  const actor = peopleActorFromAuth(auth);
  const language = auth.user.language;
  const service = getServiceRoleClient();
  const { data, error } = await service.from("locations").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  const locations = ((data ?? []) as Array<{ id: string; name: string }>).filter((l) => canViewReconciliation(actor, l.id));
  if (locations.length === 0) redirect("/admin");
  const sp = await searchParams;
  const selected = (await resolveShop(locations, shopParamFor("/admin/people-reconcile", searchParamValues(sp)))) ?? locations[0]!; // B2: ?loc= → remembered → first
  const page = await loadReconciliation({ service }, { actor, locationId: selected.id }).catch((e: unknown) => {
    if (e instanceof ScheduleError && (e.code === "schedule_forbidden" || e.code === "schedule_role_refused" || e.code === "shop_not_allowed")) redirect("/admin");
    throw e;
  });
  return (
    <div className="grid min-w-0 gap-4">
      <h1 className="text-2xl font-bold text-co-text">{serverT(language, "schedule.reconcile.title")} · {selected.name}</h1>
      <p className="text-co-text-muted">{serverT(language, "schedule.reconcile.intro")}</p>
      {locations.length > 1 ? (
        <nav aria-label={serverT(language, "schedule.reconcile.shop_picker")} className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <Link key={l.id} href={`/admin/people-reconcile?loc=${l.id}`} aria-current={l.id === selected.id ? "page" : undefined}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{l.name}</Link>
          ))}
        </nav>
      ) : null}
      <ReconcileList key={page.locationId} page={page} />
    </div>
  );
}
