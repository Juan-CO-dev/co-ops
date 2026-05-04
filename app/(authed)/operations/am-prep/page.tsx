/**
 * /operations/am-prep — Build #2 PR 1 page Server Component.
 *
 * The AM Prep submission surface. Server Component does the initial data
 * load (auth check, location-access validation, authorization gate via
 * AM_PREP_BASE_LEVEL OR active assignment, template + items + instance +
 * existing completions); AmPrepForm owns the interactive lifecycle
 * (state, validation, submit, banners).
 *
 * URL params:
 *   ?location=<id>  required — redirects to /dashboard if missing or
 *                   inaccessible
 *
 * No ?date= param — AM Prep is single-instance-per-day-per-location
 * (per the prep template's single_submission_only=true semantic +
 * checklist_instances UNIQUE(template_id, location_id, date)). Historical
 * browse of prior AM Preps lands in the Reports hub (Build #2 follow-up
 * PR per C.42).
 *
 * Authorization (per SPEC_AMENDMENTS.md C.42 + C.41):
 *   - actor.level >= AM_PREP_BASE_LEVEL (3, "KH+" semantic post-C.41), OR
 *   - active report_assignments row for (user, am_prep, location, date)
 *
 * Read-only mode kicks in when the loaded instance is already confirmed
 * (returning user OR re-load after submission); AmPrepForm derives
 * isReadOnly from instance.status and renders the read-only banner +
 * disables all inputs.
 *
 * Operational TZ hardcoded to America/New_York per SPEC_AMENDMENTS.md
 * C.23 (locations.timezone column doesn't exist in schema; CO is DC-only).
 */

import { redirect } from "next/navigation";

import {
  AM_PREP_BASE_LEVEL,
  loadAmPrepState,
  loadAssignmentForToday,
} from "@/lib/prep";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { PrepInputs } from "@/lib/types";

import { AmPrepForm } from "@/components/prep/AmPrepForm";

const OPERATIONAL_TZ = "America/New_York";

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

interface PageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function AmPrepPage({ searchParams }: PageProps) {
  // 1. Auth boundary (handled by `(authed)` layout, but the page calls
  //    requireSessionFromHeaders again to get a typed AuthContext for its
  //    own auth-aware reads — same pattern as closing-page).
  const auth = await requireSessionFromHeaders("/operations/am-prep");
  const { location: locationParam } = await searchParams;

  if (!locationParam) redirect("/dashboard");

  // 2. Location access.
  const locActor: LocationActor = {
    role: auth.role,
    locations: auth.locations,
  };
  if (!lockLocationContext(locActor, locationParam)) {
    redirect("/dashboard");
  }

  const sb = getServiceRoleClient();

  // Validate location row exists and is active.
  const { data: locationRow, error: locErr } = await sb
    .from("locations")
    .select("id, name, code")
    .eq("id", locationParam)
    .eq("active", true)
    .maybeSingle<{ id: string; name: string; code: string }>();
  if (locErr) throw new Error(`load location: ${locErr.message}`);
  if (!locationRow) redirect("/dashboard");

  const today = nyDateString(new Date());

  // 3. Authorization gate — AM_PREP_BASE_LEVEL OR active assignment.
  //    Sub-KH+ users without an assignment redirect to /dashboard (mirrors
  //    closing-page's redirect-on-no-access convention).
  const hasBaseAccess = auth.level >= AM_PREP_BASE_LEVEL;
  let hasAssignment = false;
  if (!hasBaseAccess) {
    const assignment = await loadAssignmentForToday(sb, {
      userId: auth.user.id,
      reportType: "am_prep",
      locationId: locationParam,
      date: today,
    });
    hasAssignment = assignment !== null;
  }
  if (!hasBaseAccess && !hasAssignment) {
    redirect("/dashboard");
  }

  // 4. Load AM Prep state.
  const state = await loadAmPrepState(sb, {
    locationId: locationParam,
    date: today,
    actor: { userId: auth.user.id, role: auth.role, level: auth.level },
  });

  if (state === null) {
    return (
      <NoTemplateView
        locationLabel={`${locationRow.code} · ${locationRow.name}`}
        language={auth.user.language}
      />
    );
  }

  // 5. Build initialValues from existing live completions.
  //    For fresh instances (no completions), this yields an empty record.
  //    For confirmed instances reload, this populates AmPrepForm so the
  //    operator sees what they (or a peer) submitted earlier.
  //
  //    Each completion's prepData has been narrowed by lib/prep.ts
  //    narrowPrepCompletion — non-null prepData carries { inputs, snapshot }
  //    per C.18 + C.44. We extract the inputs payload for the form.
  //
  //    Edge case: if instance status is 'open' but completions exist
  //    (shouldn't happen with single-submission templates per RPC atomic
  //    write, but defensive), the form renders editable with pre-populated
  //    values. Per submitAmPrep RPC behavior, completions and
  //    status='confirmed' are written atomically.
  const initialValues: Record<string, PrepInputs> = {};
  for (const c of state.completions) {
    if (c.prepData) {
      initialValues[c.templateItemId] = c.prepData.inputs;
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      {/* Persistent back-to-dashboard CTA — same shape as closing-client. */}
      <div className="mb-3">
        <a
          href="/dashboard"
          aria-label={serverT(auth.user.language, "am_prep.page.dashboard_back_aria")}
          className="
            inline-flex min-h-[44px] items-center gap-1.5 -ml-2 px-2 py-2
            text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted
            transition hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            rounded-md
          "
        >
          <ChevronLeftIcon />
          <span>{serverT(auth.user.language, "am_prep.page.dashboard_back")}</span>
        </a>
      </div>

      {/* Header — visual parallel to closing-client header. */}
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          {serverT(auth.user.language, "am_prep.page.title")}
        </p>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight text-co-text">
          {locationRow.code} · {locationRow.name}
        </h1>
      </div>

      <div className="mt-4">
        <AmPrepForm
          instance={state.instance}
          templateItems={state.templateItems}
          initialValues={initialValues}
          authors={state.authors}
          actor={{ userId: auth.user.id, name: auth.user.name }}
        />
      </div>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — no AM Prep template at this location
// ─────────────────────────────────────────────────────────────────────────────

function NoTemplateView({
  locationLabel,
  language,
}: {
  locationLabel: string;
  language: Language;
}) {
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {serverT(language, "am_prep.page.title")}
      </p>
      <h1 className="mt-1 text-2xl font-extrabold text-co-text">{locationLabel}</h1>
      <section className="mt-6 rounded-2xl border-2 border-co-border bg-co-surface p-5 text-center sm:p-6">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-co-text-dim">
          {serverT(language, "am_prep.no_template.heading")}
        </p>
        <p className="mt-3 text-sm text-co-text-muted">
          {serverT(language, "am_prep.no_template.body")}
        </p>
        <a
          href="/dashboard"
          className="
            mt-4 inline-flex min-h-[48px] items-center justify-center rounded-md
            border-2 border-co-text bg-co-surface px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
            transition hover:bg-co-surface-2
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          {serverT(language, "am_prep.no_template.return_dashboard")}
        </a>
      </section>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icon (matches closing-client.tsx ChevronLeftIcon)
// ─────────────────────────────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10 3L5 8L10 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
