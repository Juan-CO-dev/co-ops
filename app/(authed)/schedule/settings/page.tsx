import Link from "next/link";
import { redirect } from "next/navigation";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { ScheduleSettings } from "@/components/schedule/ScheduleSettings";
import { stepUpEditWindowMs } from "@/lib/admin/step-up";
import { serverT } from "@/lib/i18n/server";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { canViewSchedule } from "@/lib/scheduling/access-shared";
import { ScheduleError } from "@/lib/scheduling/errors-shared";
import { loadScheduleSettings } from "@/lib/scheduling/settings-view";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShop } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * Scheduling Phase 2, chunk F, Task 24 — THE SCHEDULE SETTINGS (spec §5.3–5.7). Who may open it is `canViewSchedule`
 * (GM own shop, an AGM at their own shop, MoO+ any; never the social media, catering or prep managers); each section is
 * then the loader's to grant. Writes take the Tier E edit window (structure, the MoO's shop card, tunables, the prep
 * position): this page's step-up host opens that 15-minute window like the admin surface does (`catalogWindow`), so a
 * password typed here serves the next saves. Person settings and pins take no step-up (audited). Shop: ?loc= →
 * remembered → first (B2). No email, no notification.
 */
export default async function ScheduleSettingsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/schedule/settings");
  const actor = peopleActorFromAuth(auth);
  const language = auth.user.language;
  const service = getServiceRoleClient();
  const { data, error } = await service.from("locations").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  const locations = ((data ?? []) as Array<{ id: string; name: string }>).filter((l) => canViewSchedule(actor, l.id));
  if (locations.length === 0) redirect("/dashboard");
  const sp = await searchParams;
  const selected = (await resolveShop(locations, shopParamFor("/schedule/settings", searchParamValues(sp)))) ?? locations[0]!; // B2: ?loc= → remembered → first
  const view = await loadScheduleSettings({ service }, { actor, locationId: selected.id }).catch((e: unknown) => {
    if (e instanceof ScheduleError && (e.code === "schedule_forbidden" || e.code === "schedule_role_refused" || e.code === "shop_not_allowed")) redirect("/dashboard");
    throw e;
  });
  return (
    <main className="mx-auto grid w-full max-w-5xl min-w-0 gap-4 px-4 pb-10 pt-2">
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold text-co-text">{serverT(language, "schedule.settings.page_title")} · {selected.name}</h1>
        <p className="text-sm text-co-text-muted">{serverT(language, "schedule.settings.page_intro")}</p>
      </header>
      {locations.length > 1 ? (
        <nav aria-label={serverT(language, "schedule.page.shop_picker")} className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <Link key={l.id} href={`/schedule/settings?loc=${l.id}`} aria-current={l.id === selected.id ? "page" : undefined}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{l.name}</Link>
          ))}
        </nav>
      ) : null}
      <StepUpProvider unlocked={false} unlockedAt={null} catalogUnlockedAt={auth.session.catalogEditUnlockedAt ?? null} catalogWindow editWindowMs={stepUpEditWindowMs()}>
        <ScheduleSettings key={selected.id} view={view} />
      </StepUpProvider>
    </main>
  );
}
