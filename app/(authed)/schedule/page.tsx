import Link from "next/link";
import { redirect } from "next/navigation";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { ScheduleBoard } from "@/components/schedule/ScheduleBoard";
import { serverT } from "@/lib/i18n/server";
import { operationalNow } from "@/lib/midshift-shared";
import { peopleActorFromAuth } from "@/lib/people/access-shared";
import { canViewSchedule } from "@/lib/scheduling/access-shared";
import { loadBoard } from "@/lib/scheduling/board";
import { ScheduleError } from "@/lib/scheduling/errors-shared";
import { isYmd, isoWeekStart } from "@/lib/scheduling/time-shared";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShop } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";

/**
 * Scheduling Phase 2, chunk F — THE SCHEDULE BOARD (spec §7). GM own shop, an AGM at their own shop (read; edit when
 * the shop grants it), MoO+ any shop; the social media manager and the catering / prep managers never (the rule lives
 * in `access-shared`, asked per shop below and again by `loadBoard`). Shop: ?loc= → remembered → first (B2). Week:
 * ?week= (any date of it), else this week. Day: ?day=. The board hosts its own step-up (Tier B: Approve, a confirmed
 * overwrite — always prompted). No email, no notification.
 */
export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ loc?: string; week?: string; day?: string }> }) {
  const auth = await requireSessionFromHeaders("/schedule");
  const actor = peopleActorFromAuth(auth);
  const language = auth.user.language;
  const service = getServiceRoleClient();
  const { data, error } = await service.from("locations").select("id,name").eq("active", true).order("name");
  if (error) throw error;
  const locations = ((data ?? []) as Array<{ id: string; name: string }>).filter((l) => canViewSchedule(actor, l.id));
  if (locations.length === 0) redirect("/dashboard");
  const sp = await searchParams;
  const selected = (await resolveShop(locations, shopParamFor("/schedule", searchParamValues(sp)))) ?? locations[0]!; // B2: ?loc= → remembered → first
  const today = operationalNow(new Date()).date;
  const weekStart = isoWeekStart(typeof sp.week === "string" && isYmd(sp.week) ? sp.week : today);
  const view = await loadBoard({ service }, { actor, locationId: selected.id, weekStart }).catch((e: unknown) => {
    if (e instanceof ScheduleError && (e.code === "schedule_forbidden" || e.code === "schedule_role_refused" || e.code === "shop_not_allowed")) redirect("/dashboard");
    throw e;
  });
  return (
    <main className="mx-auto grid w-full max-w-5xl min-w-0 gap-4 px-4 pb-10 pt-2">
      <header className="grid gap-1">
        <h1 className="text-2xl font-bold text-co-text">{serverT(language, "schedule.page.title")} · {selected.name}</h1>
        <p className="text-sm text-co-text-muted">{serverT(language, "schedule.page.intro")}</p>
      </header>
      {locations.length > 1 ? (
        <nav aria-label={serverT(language, "schedule.page.shop_picker")} className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <Link key={l.id} href={`/schedule?loc=${l.id}&week=${weekStart}`} aria-current={l.id === selected.id ? "page" : undefined}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{l.name}</Link>
          ))}
        </nav>
      ) : null}
      <StepUpProvider unlocked={false} unlockedAt={null}>
        <ScheduleBoard key={`${selected.id}|${weekStart}`} view={view} initialDate={typeof sp.day === "string" ? sp.day : undefined} />
      </StepUpProvider>
    </main>
  );
}
