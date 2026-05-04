/**
 * /dashboard — Module #1 Build #1 step 8.
 *
 * Operator's "what do I need to do right now" view. Action-oriented, compact,
 * today-focused. NOT a reports console — see docs/MODULE_REPORTS_CONSOLE_VISION.md
 * for the future management-facing surface that handles tabs / filters /
 * drill-down / history. Two distinct surfaces, neither becomes the other.
 *
 * Server Component. Calls requireSessionFromHeaders for the full session
 * check (sessions row, token_hash dual verify, idle, revoked, deactivated
 * user, step-up auto-clear) before any data load.
 *
 * Reads `?loc=<id>` to determine selected location for the multi-location
 * case. Defaults to the first accessible location alphabetically. Single-
 * location users see no switcher.
 *
 * Today / yesterday computed in America/New_York — both CO locations
 * (MEP / EM) are in DC, same TZ. The spec referenced a `locations.timezone`
 * field that doesn't exist in the schema (§4.1) or types; honoring the spec
 * intent by hardcoding the operational TZ. When/if CO expands beyond DC
 * the schema gets a timezone column and this hardcode becomes a per-row
 * read.
 */

import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ROLES } from "@/lib/roles";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { loadAmPrepDashboardState } from "@/lib/prep";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { ChecklistInstance } from "@/lib/types";

const OPERATIONAL_TZ = "America/New_York";

interface LocationLite {
  id: string;
  name: string;
  code: string;
}

type ClosingStatus = "open" | "confirmed" | "incomplete_confirmed";

interface ClosingInstanceLite {
  id: string;
  date: string;
  status: ClosingStatus;
}

interface OperationalState {
  /** YYYY-MM-DD in OPERATIONAL_TZ. */
  todayDate: string;
  yesterdayDate: string;
  /** True when the location has a "Standard Closing" template seeded. */
  hasClosingTemplate: boolean;
  /** Today's closing instance, if any. */
  todayInstance: ClosingInstanceLite | null;
  /** When today's instance is open: total required items + completed required items. */
  todayProgress: { completed: number; required: number } | null;
  /** Yesterday's closing instance — only surfaced when status='open' (the alert case). */
  yesterdayUnconfirmed: ClosingInstanceLite | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers — TZ-aware
// ─────────────────────────────────────────────────────────────────────────────

function nyDateString(d: Date): string {
  // Intl.DateTimeFormat with en-CA locale yields YYYY-MM-DD reliably.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function todayAndYesterday(): { today: string; yesterday: string } {
  const now = new Date();
  const today = nyDateString(now);
  // Compute yesterday by subtracting one day from `today` in calendar terms,
  // then formatting back as YYYY-MM-DD. Using UTC arithmetic on the date-only
  // string sidesteps DST concerns (we're not converting between zones — just
  // walking calendar days).
  const todayUtc = new Date(`${today}T00:00:00Z`);
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  const yesterday = todayUtc.toISOString().slice(0, 10);
  return { today, yesterday };
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loaders
// ─────────────────────────────────────────────────────────────────────────────

async function loadAccessibleLocations(
  sb: ReturnType<typeof getServiceRoleClient>,
  actor: LocationActor,
): Promise<LocationLite[]> {
  // accessibleLocations returns "all" for level 7+, else the explicit ID list.
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

async function loadOperationalState(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<OperationalState> {
  const { today, yesterday } = todayAndYesterday();

  // Two-step query (per AGENTS.md Phase 2 Session 4: PostgREST embedded-select
  // .eq() filter on relation can fail unpredictably). Resolve template first,
  // then instances.
  const { data: tmpl, error: tmplErr } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", locationId)
    .eq("type", "closing")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (tmplErr) throw new Error(`load closing template: ${tmplErr.message}`);

  if (!tmpl) {
    return {
      todayDate: today,
      yesterdayDate: yesterday,
      hasClosingTemplate: false,
      todayInstance: null,
      todayProgress: null,
      yesterdayUnconfirmed: null,
    };
  }

  const { data: instances, error: instErr } = await sb
    .from("checklist_instances")
    .select("id, date, status")
    .eq("template_id", tmpl.id)
    .eq("location_id", locationId)
    .in("date", [today, yesterday]);
  if (instErr) throw new Error(`load instances: ${instErr.message}`);

  const todayInstance =
    (instances ?? []).find((i) => i.date === today) ??
    null;
  const yesterdayInstance =
    (instances ?? []).find((i) => i.date === yesterday) ??
    null;

  // Yesterday's alert fires only for status='open' (was-not-confirmed).
  const yesterdayUnconfirmed =
    yesterdayInstance && yesterdayInstance.status === "open"
      ? (yesterdayInstance as ClosingInstanceLite)
      : null;

  // X-of-Y progress only when today's instance is open.
  let todayProgress: { completed: number; required: number } | null = null;
  if (todayInstance && todayInstance.status === "open") {
    const { data: requiredItems, error: reqErr } = await sb
      .from("checklist_template_items")
      .select("id")
      .eq("template_id", tmpl.id)
      .eq("required", true)
      .eq("active", true);
    if (reqErr) throw new Error(`load required items: ${reqErr.message}`);
    const requiredIds = new Set((requiredItems ?? []).map((r) => r.id as string));

    // Live = non-superseded AND non-revoked (per SPEC_AMENDMENTS.md C.28).
    const { data: liveCompletions, error: compErr } = await sb
      .from("checklist_completions")
      .select("template_item_id")
      .eq("instance_id", todayInstance.id)
      .is("superseded_at", null)
      .is("revoked_at", null);
    if (compErr) throw new Error(`load live completions: ${compErr.message}`);

    const completedRequired = new Set<string>();
    for (const c of liveCompletions ?? []) {
      const id = c.template_item_id as string;
      if (requiredIds.has(id)) completedRequired.add(id);
    }
    todayProgress = {
      completed: completedRequired.size,
      required: requiredIds.size,
    };
  }

  return {
    todayDate: today,
    yesterdayDate: yesterday,
    hasClosingTemplate: true,
    todayInstance: (todayInstance as ClosingInstanceLite | null) ?? null,
    todayProgress,
    yesterdayUnconfirmed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// View helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDateLabel(yyyymmdd: string, language: Language): string {
  // YYYY-MM-DD → "Tue, May 1" (en) or "mar, 1 may" (es). Locale follows
  // user language preference per SPEC_AMENDMENTS.md C.31.
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  const locale = language === "es" ? "es-US" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

interface StatusCopy {
  label: string;
  cta: string;
  ctaTone: "primary" | "review";
}

function statusCopyFor(state: OperationalState, language: Language): StatusCopy {
  if (!state.hasClosingTemplate) {
    return {
      label: serverT(language, "dashboard.status.no_template"),
      cta: serverT(language, "dashboard.cta.open_closing"),
      ctaTone: "review",
    };
  }
  const inst = state.todayInstance;
  if (!inst) {
    return {
      label: serverT(language, "dashboard.status.not_started"),
      cta: serverT(language, "dashboard.cta.start_closing"),
      ctaTone: "primary",
    };
  }
  if (inst.status === "confirmed") {
    return {
      label: serverT(language, "dashboard.status.confirmed"),
      cta: serverT(language, "dashboard.cta.review_closing"),
      ctaTone: "review",
    };
  }
  if (inst.status === "incomplete_confirmed") {
    return {
      label: serverT(language, "dashboard.status.incomplete_confirmed"),
      cta: serverT(language, "dashboard.cta.review_closing"),
      ctaTone: "review",
    };
  }
  // open
  const p = state.todayProgress;
  const progress = p
    ? serverT(language, "dashboard.status.in_progress_progress", {
        completed: p.completed,
        required: p.required,
      })
    : serverT(language, "dashboard.status.in_progress_fallback");
  return {
    label: serverT(language, "dashboard.status.in_progress", { progress }),
    cta: serverT(language, "dashboard.cta.continue_closing"),
    ctaTone: "primary",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

interface DashboardPageProps {
  searchParams: Promise<{ loc?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const auth = await requireSessionFromHeaders("/dashboard");
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

  const { loc } = await searchParams;
  const selectedLocation =
    (loc ? locations.find((l) => l.id === loc) : null) ??
    locations[0] ??
    null;

  const operational = selectedLocation
    ? await loadOperationalState(sb, selectedLocation.id)
    : null;

  // AM Prep dashboard tile state — slim shape distinct from
  // /operations/am-prep page's loadAmPrepState. Only loads what the tile
  // needs (template existence, today's instance status + confirmedBy
  // name, assignment + assigner name for sub-KH+ users). Sub-KH+
  // assignment lookup short-circuits inside the function via
  // actor.level >= AM_PREP_BASE_LEVEL gate.
  const amPrepDashboard =
    selectedLocation && operational
      ? await loadAmPrepDashboardState(sb, {
          locationId: selectedLocation.id,
          date: operational.todayDate,
          actor: { userId: auth.user.id, role: auth.role, level: auth.level },
        })
      : null;

  const allLocationsBadge = auth.level >= 7 && auth.locations.length === 0;

  return (
    <AuthShell>
      <div className="mt-2 flex flex-col gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
            {serverT(language, "dashboard.header.label")}
          </p>
          <h2 className="mt-1 text-3xl font-extrabold leading-tight text-co-text">
            {serverT(language, "dashboard.header.greeting", { name: auth.user.name })}
          </h2>
        </div>

        {/* Role badge — user identity, not location. Stays separate from
         * the location chrome below. */}
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

        {/* Location chrome — single non-interactive chip for single-location
         * users; switcher (interactive selectable pills) for multi-location.
         * No co-existence: the surface either shows the user's one location
         * or lets them switch. */}
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

        {/* Yesterday-unconfirmed alert — operational concern, not a history view. */}
        {selectedLocation && operational?.yesterdayUnconfirmed ? (
          <YesterdayUnconfirmedAlert
            location={selectedLocation}
            yesterdayDate={operational.yesterdayDate}
            language={language}
          />
        ) : null}

        {/* Today's Operations card. */}
        {selectedLocation && operational ? (
          <TodaysOperationsCard
            location={selectedLocation}
            state={operational}
            language={language}
          />
        ) : (
          <NoLocationsState language={language} />
        )}

        {/* Reports section — renders only when at least one tile is visible
         * to the actor. Per C.42: dashboard tiles are action-oriented for
         * today's operations; the reports HUB (historical browse) is a
         * separate page that ships in a Build #2 follow-up PR.
         *
         * Tile visibility predicate per C.42 + C.41:
         *   - actor.level >= AM_PREP_BASE_LEVEL (3, KH+ post-C.41), OR
         *   - active report_assignments row for (user, am_prep, location, today)
         *
         * Sub-KH+ users without an assignment see no Reports section at all
         * (no empty placeholder). Future tiles (Mid-day Prep, Cash report,
         * Opening report, Special, Training) plug into the same section
         * under their own visibility predicates. */}
        {selectedLocation && amPrepDashboard?.isVisibleToActor ? (
          <ReportsSection language={language}>
            <AmPrepTile
              location={selectedLocation}
              state={amPrepDashboard}
              language={language}
            />
          </ReportsSection>
        ) : null}

        <div className="flex justify-center">
          <LogoutButton />
        </div>
      </div>

      <IdleTimeoutWarning />
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

function YesterdayUnconfirmedAlert({
  location,
  yesterdayDate,
  language,
}: {
  location: LocationLite;
  yesterdayDate: string;
  language: Language;
}) {
  return (
    <section
      role="alert"
      aria-label={serverT(language, "dashboard.yesterday.aria")}
      className="
        flex flex-col gap-3 rounded-2xl
        border-2 border-co-gold-deep bg-[#FFF4D0]
        p-4 sm:p-5
      "
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="
            mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center
            rounded-full bg-co-gold-deep text-co-text
          "
        >
          <WarningIcon />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-co-text">
            {serverT(language, "dashboard.yesterday.title", { code: location.code })}
          </p>
          <p className="mt-1 text-xs text-co-text-muted">
            {serverT(language, "dashboard.yesterday.body", {
              date: formatDateLabel(yesterdayDate, language),
            })}
          </p>
        </div>
      </div>
      <div className="sm:pl-10">
        <Link
          href={`/operations/closing?location=${location.id}&date=${yesterdayDate}`}
          className="
            inline-flex min-h-[48px] items-center justify-center rounded-md
            border-2 border-co-text bg-co-surface px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
            transition hover:bg-co-surface-2
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          {serverT(language, "dashboard.yesterday.cta")}
        </Link>
      </div>
    </section>
  );
}

function TodaysOperationsCard({
  location,
  state,
  language,
}: {
  location: LocationLite;
  state: OperationalState;
  language: Language;
}) {
  const copy = statusCopyFor(state, language);
  const ctaClasses =
    copy.ctaTone === "primary"
      ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
      : "border-2 border-co-border-2 bg-co-surface text-co-text hover:border-co-text";

  return (
    <section
      aria-label={serverT(language, "dashboard.today.aria", { location: location.name })}
      className="
        rounded-2xl border-2 border-co-border bg-co-surface
        p-5 shadow-sm sm:p-6
      "
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {serverT(language, "dashboard.today.label")}
      </p>
      <h3 className="mt-1 text-xl font-extrabold leading-tight text-co-text">
        {location.code} &middot; {location.name}
      </h3>
      <p className="mt-1 text-xs text-co-text-muted">
        {formatDateLabel(state.todayDate, language)}
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
            {serverT(language, "dashboard.today.closing_label")}
          </p>
          <p className="mt-1 text-base font-semibold text-co-text">{copy.label}</p>
        </div>
        {state.hasClosingTemplate ? (
          <Link
            href={`/operations/closing?location=${location.id}`}
            className={[
              "inline-flex min-h-[48px] items-center justify-center rounded-md",
              "px-5 text-sm font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              ctaClasses,
            ].join(" ")}
          >
            {copy.cta}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function NoLocationsState({ language }: { language: Language }) {
  return (
    <section className="rounded-2xl border-2 border-co-border bg-co-surface p-5 text-center sm:p-6">
      <p className="text-sm text-co-text-muted">
        {serverT(language, "dashboard.no_locations.body")}
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reports section + tiles (per SPEC_AMENDMENTS.md C.42)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Container for action-oriented report tiles (per C.42 dashboard surface).
 * Renders a Mustard-deep accent header above the stacked tiles. Caller is
 * responsible for the "at least one tile visible" predicate before
 * mounting this — the section itself doesn't render an empty state because
 * sub-KH+ users without any assignments should see no Reports section at
 * all (not an empty placeholder).
 *
 * Future report tiles (Mid-day Prep, Cash, Opening, Special, Training)
 * plug in as siblings inside the children prop, each gated by their own
 * loadXxxDashboardState predicate.
 */
function ReportsSection({
  language,
  children,
}: {
  language: Language;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={serverT(language, "dashboard.reports.heading")}
      className="flex flex-col gap-3"
    >
      <h3
        className="
          inline-block self-start text-lg font-bold uppercase tracking-[0.14em] text-co-text
          border-b-2 border-co-gold-deep pb-0.5
        "
      >
        {serverT(language, "dashboard.reports.heading")}
      </h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

interface AmPrepTileState {
  hasTemplate: boolean;
  todayInstance: {
    id: string;
    status: ChecklistInstance["status"];
    confirmedAt: string | null;
    confirmedBy: string | null;
  } | null;
  confirmedByName: string | null;
  assignment: {
    assignmentId: string;
    note: string | null;
    assignerId: string;
    assignerName: string;
  } | null;
  isVisibleToActor: boolean;
}

/**
 * AM Prep dashboard tile — three visual states (not started / in progress
 * / submitted) driven by today's instance status, plus an optional
 * assignment indicator below the CTA when the actor is sub-KH+ and has
 * an active assignment.
 *
 * Always-tappable: tapping navigates to /operations/am-prep?location=<id>
 * regardless of state. The destination page handles state-specific
 * rendering (form / read-only banner / no-template empty state). Better
 * UX than disabling the tile — closer/manager always sees an explanation
 * via the page's banner.
 *
 * Status-driven CTA + subtitle (per locked surface decision):
 *   - status: undefined (no instance)  → "Start AM Prep" + "Not yet started" — primary fill
 *   - status: 'open'  (in progress)    → "Continue AM Prep" + "In progress" — review outline
 *   - status: 'confirmed' (submitted)  → "View AM Prep" + "Submitted at {time} by {name}" — review outline
 *   - hasTemplate: false                → no CTA, "AM Prep template not configured" subtitle
 */
function AmPrepTile({
  location,
  state,
  language,
}: {
  location: LocationLite;
  state: AmPrepTileState;
  language: Language;
}) {
  // No-template branch — render the tile but without a CTA. Operator
  // contacts a manager to seed the template; until then the tile is
  // informational only.
  if (!state.hasTemplate) {
    return (
      <section
        aria-label={serverT(language, "dashboard.am_prep.aria", {
          status: serverT(language, "dashboard.am_prep.no_template"),
        })}
        className="rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-sm sm:p-6"
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
          {serverT(language, "dashboard.am_prep.tile_label")}
        </p>
        <p className="mt-2 text-sm text-co-text-muted italic">
          {serverT(language, "dashboard.am_prep.no_template")}
        </p>
      </section>
    );
  }

  // Status-driven copy + CTA tone.
  type CtaTone = "primary" | "review";
  const status = state.todayInstance?.status;
  const subtitle: string = (() => {
    if (!state.todayInstance) {
      return serverT(language, "dashboard.am_prep.status_not_started");
    }
    if (status === "open") {
      return serverT(language, "dashboard.am_prep.status_in_progress");
    }
    // confirmed / incomplete_confirmed (incomplete_confirmed is type-
    // reachable but operationally unreachable for AM Prep per RPC atomic
    // write — same defensive coverage as AmPrepForm.tsx).
    const time = state.todayInstance.confirmedAt
      ? formatTimeForLanguage(state.todayInstance.confirmedAt, language)
      : "";
    const name = state.confirmedByName ?? "—";
    return serverT(language, "dashboard.am_prep.status_submitted", { time, name });
  })();

  const ctaLabel: string = (() => {
    if (!state.todayInstance) return serverT(language, "dashboard.am_prep.cta_start");
    if (status === "open") return serverT(language, "dashboard.am_prep.cta_continue");
    return serverT(language, "dashboard.am_prep.cta_view");
  })();

  const ctaTone: CtaTone = !state.todayInstance ? "primary" : "review";
  const ctaClasses =
    ctaTone === "primary"
      ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
      : "border-2 border-co-border-2 bg-co-surface text-co-text hover:border-co-text";

  return (
    <section
      aria-label={serverT(language, "dashboard.am_prep.aria", { status: subtitle })}
      className="rounded-2xl border-2 border-co-border bg-co-surface p-5 shadow-sm sm:p-6"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {serverT(language, "dashboard.am_prep.tile_label")}
      </p>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-co-text">{subtitle}</p>
          {/* Assignment indicator — separate italic line per locked design.
           * Only renders when the tile is visible solely BECAUSE of an
           * active assignment (sub-KH+ user). KH+ users always have base
           * access; assignment field is null for them regardless. */}
          {state.assignment ? (
            <>
              <p className="text-[12px] italic text-co-text-muted">
                {serverT(language, "dashboard.am_prep.assigned_by", {
                  name: state.assignment.assignerName,
                })}
              </p>
              {state.assignment.note ? (
                <p className="text-[12px] italic text-co-text-dim">
                  {serverT(language, "dashboard.am_prep.assigned_by_note", {
                    note: state.assignment.note,
                  })}
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <Link
          href={`/operations/am-prep?location=${location.id}`}
          className={[
            "inline-flex min-h-[48px] items-center justify-center rounded-md",
            "px-5 text-sm font-bold uppercase tracking-[0.12em]",
            "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
            ctaClasses,
          ].join(" ")}
        >
          {ctaLabel}
        </Link>
      </div>
    </section>
  );
}

/**
 * Language-aware time formatter (per AGENTS.md "Language-aware time/date
 * formatting" canonical pattern). Uses es-US when language === "es",
 * en-US otherwise. Mirrors AmPrepForm's formatTime; defined locally here
 * so the dashboard module stays self-contained without a cross-component
 * util import.
 */
function formatTimeForLanguage(iso: string, language: Language): string {
  try {
    return new Date(iso).toLocaleTimeString(
      language === "es" ? "es-US" : "en-US",
      { hour: "numeric", minute: "2-digit" },
    );
  } catch {
    return "";
  }
}

function WarningIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5L15 14H1L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}
