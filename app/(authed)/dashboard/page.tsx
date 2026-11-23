/**
 * /dashboard — the day, on the day engine (nav PR 7, spec r5 3.2; plan r2 2.6).
 *
 * Server Component. Calls requireSessionFromHeaders for the full session check before any data load. Reads `?loc=<id>`
 * for the selected shop (resolveShop: ?loc=, else the remembered shop, else the first allowed).
 *
 * The page composes no tiles of its own: ONE clock instant per request; ONE page-owned board promise, bounded by the ONE
 * absolute page deadline and never rejecting; ONE loadDayFacts call (PR 6) started with that board; ONE planDay call
 * (PR 5); the components render the plan. It reads no checklist state itself (no template-first read, no tile loader).
 * Every optional read (board, retrain, the own Receiving / Counts bodies) is bounded by what is left of the page
 * deadline (lib/dashboard-day.ts), so the page resolves about 6 s after the optional reads start, whatever hangs.
 *
 * Nav PR 9: the bell moved into the top bar (components/nav/NavFrame, on every signed-in page, with its own 6 s bound),
 * so this page makes NO notification read and draws no bell; "All pages" opens the bar's Go to sheet.
 *
 * The social media manager gets its own small page from SmmPlan: no board, no retrain, no auto-release trigger, and no
 * shop-fact read (the loader's SMM branch); the bar gives it no bell either. Decided by the REAL role, never "works as".
 *
 * Nav PR 8, the role blocks (spec 3.6), each by the REAL role and each read through the page's `settle` (the SAME
 * deadline, one cell per read): the numbers strip for MoO / Owner / CGS, "Needs you" for GM and up, the catering block
 * from the engine's `placement: "block"` item, and the "My shift | Shop pulse" toggle. The social media manager starts
 * none of their reads and sees none of them.
 */

import { after } from "next/server";
import Link from "next/link";
import { loadShiftBoard } from "@/lib/assignments";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { RetrainTaskList } from "@/components/production/RetrainTaskList";
import { loadMyRetrainTasks } from "@/lib/yield-stats";

import { AuthShell } from "@/components/auth/AuthShell";
import { BrandMark } from "@/components/BrandMark";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { CateringBlock } from "@/components/dashboard/CateringBlock";
import { DayList } from "@/components/dashboard/DayList";
import { MyShiftPulseToggle } from "@/components/dashboard/MyShiftPulseToggle";
import { NeedsYou } from "@/components/dashboard/NeedsYou";
import { NumbersStrip } from "@/components/dashboard/NumbersStrip";
import { PhaseLine } from "@/components/dashboard/PhaseLine";
import { Shortcuts } from "@/components/dashboard/Shortcuts";
import { SmmDashboard } from "@/components/dashboard/SmmDashboard";
import { YesterdayUnconfirmedAlert } from "@/components/dashboard/YesterdayUnconfirmedAlert";
import { ReceivingTile } from "@/components/receiving/ReceivingTile";
import { CountsTile } from "@/components/counts/CountsTile";
import { ROLES } from "@/lib/roles";
import { evaluateAutoReleaseForUserLocations } from "@/lib/checklists";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { loadRecentDeliveries } from "@/lib/receiving";
import { loadCountsTileState } from "@/lib/counts";
import { deriveMissingEmailIds, type ReceivingDeliveryFacts } from "@/lib/dashboard-status-shared";
import { aggregateFailure, amPrepEditFor, dayViewerFor, greetingKey, myShiftKey } from "@/lib/dashboard-day-shared";
import { loadDayFactsSafe, richBodies, settleBy, startPageDeadline, unwrapSettled, type Settle, type Widget } from "@/lib/dashboard-day";
import { loadCateringBlockExtras, loadNeedsYou, loadStrip } from "@/lib/dashboard-blocks";
import { assignmentsKnown, cateringBlockIndex, needsYouFor, nextUpInBlock, numbersStripFor } from "@/lib/dashboard-blocks-shared";
import { deliveryNeedsOf, lensFor, planDay, type DayPlan, type SmmPlan } from "@/lib/day-plan-shared";
import { firstName } from "@/lib/day-plan-load-shared";
import { renderDayReason } from "@/lib/day-plan-render";
import { operationalNow } from "@/lib/midshift-shared";
import { navSwitches } from "@/lib/nav-switches";
import { withAbort } from "@/lib/pulse/abort";
import { requireSessionFromHeaders } from "@/lib/session";
import { resolveShop } from "@/lib/shop-context";
import { searchParamValues, shopParamFor } from "@/lib/shop-context-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";

interface LocationLite {
  id: string;
  name: string;
  code: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loaders
// ─────────────────────────────────────────────────────────────────────────────

async function loadAccessibleLocations(
  sb: ReturnType<typeof getServiceRoleClient>,
  actor: LocationActor,
): Promise<LocationLite[]> {
  // accessibleLocations returns "all" for level 9+, else the explicit ID list.
  // For "all" we fetch every active location; for the explicit list we filter.
  const access = accessibleLocations(actor);
  let query = sb
    .from("locations")
    .select("id, name, code")
    .eq("active", true)
    .order("name", { ascending: true });
  if (access !== "all") {
    if (access.length === 0) return [];
    query = query.in("id", access);
  }
  const { data, error } = await query;
  if (error) throw new Error(`load locations: ${error.message}`);
  return (data ?? []) as LocationLite[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

interface DashboardPageProps {
  searchParams: Promise<{ loc?: string; denied?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const auth = await requireSessionFromHeaders("/dashboard");
  const now = new Date(); // the request's ONE instant (the plan date, the minutes, the board's date, the receiving rule)
  const language: Language = auth.user.language;
  const role = ROLES[auth.role];
  // Tactical inline lookup for role badge label per SPEC_AMENDMENTS.md C.38
  // discipline. Role registry uses English labels; we map to translation
  // keys here via the canonical `role.<code>` namespace. Proper system-wide
  // role-registry translation pattern (C.38-style resolver) is deferred to
  // a future architectural conversation; this inline lookup is intentionally
  // scope-bounded for PR 5d, NOT the long-term answer. See AGENTS.md.
  const roleLabel = serverT(language, `role.${auth.role}` as TranslationKey);

  const sb = getServiceRoleClient();
  const locationActor: LocationActor = {
    role: auth.role,
    locations: auth.locations,
  };
  const locations = await loadAccessibleLocations(sb, locationActor);
  // The REAL role decides the lens first (lib/day-plan-shared.ts lensFor): the social media manager's page.
  const smm = lensFor(auth.role) === "smm";

  // Build #3 PR 1 — lazy auto-release trigger. Fires after the response
  // is sent (Next 15+ `after()` keeps the request alive past dispatch),
  // so dashboard render latency is unaffected. Scoped to the user's
  // accessible locations: level 9+ with `auth.locations === []` means
  // all-locations override → pass "all"; otherwise pass the explicit
  // ID list. The helper itself is fire-and-forget-safe — it logs
  // errors and never throws to its caller. The pg_cron 6h backstop catches
  // anything the lazy path misses (per locked decision C.2). Nav PR 7 (Q4):
  // not for the social media manager; every other viewer and the cron stay.
  if (!smm) {
    after(async () => {
      const scope = auth.level >= 9 && auth.locations.length === 0
        ? ("all" as const)
        : auth.locations;
      await evaluateAutoReleaseForUserLocations(sb, { locationIds: scope });
    });
  }

  // B2: ?loc= wins, else the remembered shop (tile login / last explicit pick), else the first.
  const sp = await searchParams;
  const selectedLocation = await resolveShop(locations, shopParamFor("/dashboard", searchParamValues(sp)));
  const switches = navSwitches(); // ONE read: the engine's viewer, the shortcuts and "All pages" share it
  const viewer = dayViewerFor(auth, selectedLocation?.id ?? "", switches);
  const shop = selectedLocation ? { id: selectedLocation.id, code: selectedLocation.code } : null;

  // ── The social media manager: own rows only. NO board, retrain, rich body, or shop-fact read. ──
  let smmPlan: SmmPlan | null = null;
  if (smm && shop) {
    const smmInput = await loadDayFactsSafe(sb, { viewer, shop, now, board: null, locations: auth.locations });
    smmPlan = planDay(smmInput) as SmmPlan;
  }

  // ── Everyone else (F1, G1): ONE absolute deadline; every optional read starts before anything is awaited. ──
  const failedWidgets = new Set<TranslationKey>();
  const deadlineAt = startPageDeadline();
  const widget: Widget = (label, run) => settleBy(run, deadlineAt, label).then((r) => {
    if (r.kind === "ok") return r.value;
    failedWidgets.add(label);
    return null;
  });
  // Nav PR 8: the role blocks' cells, bound to the SAME deadline; a cell says "Couldn't load" itself (no failedWidgets line).
  const settle: Settle = (area, run) => settleBy(run, deadlineAt, area);
  const planDate = operationalNow(now).date;
  const assignmentActor = { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations };
  // ONE board promise, page-owned, never rejects; the loader, My shift and the rich bodies all read it.
  const boardSettled = !smm && shop && viewer.surfaces.has("ops")
    ? settleBy((signal) => loadShiftBoard(withAbort(sb, signal), { actor: assignmentActor, locationId: shop.id, date: planDate }), deadlineAt, "board")
    : null;
  const retrainP = !smm && shop && auth.level >= 4 ? widget("yield.task.heading", (signal) => loadMyRetrainTasks(auth, shop.id, { signal })) : null;
  const richP = boardSettled && shop
    ? richBodies(boardSettled, { userId: auth.user.id, receiving: (signal) => loadRecentDeliveries(auth, shop.id, 20, { signal }), counts: (signal) => loadCountsTileState(auth, shop.id, { signal }) }, widget)
    : null;
  // Nav PR 8: started before anything is awaited, each only for its real role (never a level), never for the SMM.
  const stripP = !smm && shop && numbersStripFor(auth.role) ? loadStrip(sb, auth, locations, planDate, switches, settle) : null;
  const needsP = !smm && shop && needsYouFor(auth.role) ? loadNeedsYou(auth, shop.id, settle) : null;
  const blockP = !smm && shop && auth.role === "catering_mgr" && viewer.surfaces.has("catering")
    ? loadCateringBlockExtras(sb, auth, shop.id, planDate, settle) : null;
  const input = !smm && shop
    ? await loadDayFactsSafe(sb, { viewer, shop, now, locations: auth.locations, deadlineAt, board: boardSettled ? () => boardSettled.then(unwrapSettled) : null })
    : null;
  const plan = input ? (planDay(input) as DayPlan) : null;
  const board = boardSettled ? await boardSettled : null; // already settled: never hangs
  if (board && board.kind !== "ok") failedWidgets.add("nav.assignments");
  const [retrainTasks, rich, strip, needs, blockExtras] = await Promise.all([retrainP, richP, stripP, needsP, blockP]);
  // The catering block: the engine's one `placement: "block"` item. It draws the night-before line, so PhaseLine leaves it
  // out ONLY when the block is drawn and has that line to draw (Q5).
  const blockIndex = plan ? cateringBlockIndex(plan) : -1;
  const blockItem = plan && blockIndex >= 0 ? plan.items[blockIndex] : undefined;
  const blockDrawsHeadsUp = blockItem !== undefined && plan!.cateringBlock !== null && plan!.headsUp !== null;
  const amPrepEditHref = input && shop ? amPrepEditFor(input, auth.user.id, shop.id) : undefined;
  // Catering delivery D3: the "Needs you" delivery cell, from the day's own facts (no second read). null = delivery is off
  // here, and then no prop is handed on at all (the tree is the pre-D3 tree).
  const deliveryNeeds = input ? deliveryNeedsOf(input) : null;

  // The own Receiving body: the loader rows projected for the tile, at the request's one instant.
  const missingEmailIds = rich?.deliveries ? deriveMissingEmailIds(rich.deliveries, now.getTime()) : new Set<string>();
  const receivingFacts: ReceivingDeliveryFacts[] | null = rich?.deliveries
    ? rich.deliveries.map((d) => ({
        id: d.id,
        vendorName: d.vendorName,
        deliveryDate: d.deliveryDate,
        matchState: d.matchState,
        deliveryStatus: d.deliveryStatus,
        receiptUrl: d.receiptUrl,
        arrivedAt: formatTime(d.createdAt, language),
        missingEmail: missingEmailIds.has(d.id),
      }))
    : null;
  const bodies = shop && rich ? {
    ...(rich.ownReceiving ? { receiving: <ReceivingTile language={language} locationId={shop.id} deliveries={receivingFacts} today={planDate} /> } : {}),
    ...(rich.ownCounts ? { counts: <CountsTile language={language} locationId={shop.id} state={rich.counts} today={planDate} /> } : {}),
  } : undefined;

  const allLocationsBadge = auth.level >= 9 && auth.locations.length === 0;
  const nowMin = input?.nowMin ?? operationalNow(now).minutesOfDay;
  const greeting = serverT(language, greetingKey(nowMin), { name: firstName(auth.user.name) ?? auth.user.name });

  return (
    <AuthShell width="wide">
      <div className="mt-2 flex flex-col gap-6">
        {/* Nav spec PR S1: a refused report page sends the person here with ?denied=reports. A fixed line,
            no parameters (only this one value is recognised; anything else shows nothing). */}
        {sp.denied === "reports" ? (
          <p role="status" className="rounded-lg border-2 border-co-border bg-co-surface-inset px-3 py-2 text-sm text-co-text">
            {serverT(language, "dashboard.denied.reports")}
          </p>
        ) : null}
        {/* HEADER ZONE: phone keeps the stack (greeting → identity → location); lg+ composes it as a two-column grid. */}
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[1fr_auto] lg:items-start lg:gap-x-8 lg:gap-y-4">
        <div className="flex items-center gap-3 lg:col-start-1 lg:row-start-1">
          <BrandMark size={40} decorative className="shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
              {serverT(language, "dashboard.header.label")}
            </p>
            <h2 className="mt-1 text-3xl font-extrabold leading-tight text-co-text">
              {greeting}
            </h2>
          </div>
        </div>

        {/* The role badge (top-right of the header row). Nav PR 9: the bell moved into the top bar. */}
        <div className="flex items-center justify-between gap-3 lg:col-start-2 lg:row-start-1 lg:justify-end lg:gap-4">
          <div className="flex flex-wrap gap-2">
            <span
              className="
                inline-flex items-center gap-2 rounded-full px-3 py-1.5
                text-xs font-bold uppercase tracking-[0.14em] text-co-text
              "
              style={{
                background: role.color + "33",
                border: `1px solid ${role.color}`,
              }}
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: role.color }}
              />
              {roleLabel}
            </span>
          </div>
        </div>

        {/* Location chrome — single non-interactive chip for single-location
         * users; switcher (interactive selectable pills) for multi-location.
         * empty:hidden — the rare all-null branch must not leave a ghost flex gap on phones. */}
        <div className="empty:hidden lg:col-start-2 lg:row-start-2 lg:justify-self-end">
        {allLocationsBadge && locations.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            <span
              className="
                inline-flex items-center rounded-full border-2 border-co-border-2
                bg-co-surface px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em]
                text-co-text-muted
              "
            >
              {serverT(language, "dashboard.location.all")}
            </span>
          </div>
        ) : locations.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            <span
              className="
                inline-flex items-center rounded-full border-2 border-co-border
                bg-co-surface px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em]
                text-co-text-faint
              "
            >
              {serverT(language, "dashboard.location.none")}
            </span>
          </div>
        ) : locations.length === 1 ? (
          // Single accessible location — non-interactive chip; no switcher needed.
          <div className="flex flex-wrap gap-2">
            <span
              className="
                inline-flex items-center rounded-full border-2 border-co-border-2
                bg-co-surface px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em]
                text-co-text-muted
              "
            >
              {locations[0]!.code} · {locations[0]!.name}
            </span>
          </div>
        ) : selectedLocation ? (
          <LocationSwitcher
            locations={locations}
            selectedId={selectedLocation.id}
            language={language}
          />
        ) : null}
        </div>
        </div>

        {!smm ? <MyShiftPulseToggle viewer={viewer} shopId={shop?.id ?? null} current="my_shift" language={language} /> : null}

        {smmPlan && shop ? (
          <SmmDashboard plan={smmPlan} shopId={shop.id} language={language} actorRole={auth.role} actorLevel={auth.level} surfaces={viewer.surfaces} switches={switches} />
        ) : null}

        {plan ? <PhaseLine plan={plan} language={language} omitHeadsUp={blockDrawsHeadsUp} /> : null}
        {plan && selectedLocation ? plan.alerts.map((alert) => (
          <YesterdayUnconfirmedAlert key={alert.date} location={selectedLocation} yesterdayDate={alert.date} language={language} />
        )) : null}
        {plan ? plan.notes.map((note, i) => (
          <p key={`${note.reason.key}:${i}`} className="text-sm text-co-text-muted" role="status">{renderDayReason(note.reason, language)}</p>
        )) : null}
        {Array.from(failedWidgets).map((label) => (
          <p key={label} className="text-sm text-co-text-muted" role="status">
            {serverT(language, label)}: {serverT(language, "dashboard.tile.unavailable")}
          </p>
        ))}
        {strip ? <NumbersStrip rows={strip} language={language} /> : null}
        {needs && plan && shop && input ? (
          <NeedsYou cells={needs} plan={plan} tasksKnown={assignmentsKnown(input) && !aggregateFailure(plan)} shopId={shop.id} language={language}
            {...(deliveryNeeds ? { delivery: deliveryNeeds } : {})} />
        ) : null}
        {plan && shop && blockItem && plan.cateringBlock ? (
          <CateringBlock item={blockItem} block={plan.cateringBlock} heavyToday={plan.heavyToday} headsUp={plan.headsUp} extras={blockExtras}
            nextUp={nextUpInBlock(plan)} shopId={shop.id} language={language} />
        ) : null}
        {plan && shop ? <DayList plan={plan} shopId={shop.id} language={language} editHref={amPrepEditHref} bodies={bodies} /> : null}

        {board?.kind === "ok" ? (
          <ShiftBoardClient key={myShiftKey(board.value, auth.user.id)} board={board.value} compact refreshEvery={null} retrainTasks={retrainTasks ?? []} />
        ) : null}
        {board?.kind !== "ok" && retrainTasks && retrainTasks.length > 0 ? <section className="co-card p-4"><RetrainTaskList tasks={retrainTasks} /></section> : null}

        {!selectedLocation ? <NoLocationsState language={language} /> : null}
        {smmPlan ? null : (
          <Shortcuts actorRole={auth.role} actorLevel={auth.level} surfaces={viewer.surfaces} switches={switches} shopId={shop?.id ?? null} language={language} />
        )}

        <div className="flex justify-center">
          <LogoutButton sessionId={auth.session.id} />
        </div>
      </div>
    </AuthShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View sub-components
// ─────────────────────────────────────────────────────────────────────────────

function LocationSwitcher({
  locations,
  selectedId,
  language,
}: {
  locations: LocationLite[];
  selectedId: string;
  language: Language;
}) {
  return (
    <nav
      aria-label={serverT(language, "dashboard.location.switcher_aria")}
      className="flex flex-wrap gap-2"
    >
      {locations.map((loc) => {
        const isSelected = loc.id === selectedId;
        return (
          <Link
            key={loc.id}
            href={`/dashboard?loc=${loc.id}`}
            scroll={false}
            aria-current={isSelected ? "page" : undefined}
            className={[
              "inline-flex min-h-[44px] items-center rounded-full px-4 py-2",
              "text-xs font-bold uppercase tracking-[0.14em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              isSelected
                ? "border-2 border-co-text bg-co-gold text-co-text"
                : "border-2 border-co-border-2 bg-co-surface text-co-text-muted hover:border-co-text hover:text-co-text",
            ].join(" ")}
          >
            {loc.code} · {loc.name}
          </Link>
        );
      })}
    </nav>
  );
}

function NoLocationsState({ language }: { language: Language }) {
  return (
    <section className="co-card p-5 text-center sm:p-6">
      <p className="text-sm text-co-text-muted">
        {serverT(language, "dashboard.no_locations.body")}
      </p>
    </section>
  );
}
