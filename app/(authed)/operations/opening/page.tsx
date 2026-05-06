/**
 * /operations/opening — Build #3 PR 2 Phase 1 Verification Checklist page.
 *
 * Server Component. Branches by gate state + instance status:
 *   1. No template at location → "Template not configured" empty state
 *   2. Gate not satisfied (prior closing(N-1) still 'open') → "Waiting on
 *      prior closing finalization" banner. PR 4 wires opener-release UI;
 *      PR 2 just shows the message.
 *   3. Instance status='confirmed' or 'auto_finalized' → read-only banner
 *      with submitter attribution.
 *   4. Instance status='open' (or new) → render OpeningClient form.
 *
 * Today's date computed in America/New_York (existing operational TZ
 * convention; matches dashboard + closing pages).
 *
 * Replaces the Phase 0/1 PlaceholderCard wholesale.
 */

import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { accessibleLocations, type LocationActor } from "@/lib/locations";
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { loadOpeningState } from "@/lib/opening";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { OpeningClient } from "./opening-client";

const OPERATIONAL_TZ = "America/New_York";

interface LocationLite {
  id: string;
  name: string;
  code: string;
}

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function todayAndYesterday(): { today: string; yesterday: string } {
  const today = nyDateString(new Date());
  const todayUtc = new Date(`${today}T00:00:00Z`);
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  const yesterday = todayUtc.toISOString().slice(0, 10);
  return { today, yesterday };
}

async function loadAccessibleLocations(
  sb: ReturnType<typeof getServiceRoleClient>,
  actor: LocationActor,
): Promise<LocationLite[]> {
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

interface PriorClosingState {
  exists: boolean;
  status: string | null;
}

/**
 * Manual gate check for PR 2: looks up closing(N-1) status. PR 4 will
 * wire the formal gate predicate evaluator from PR 1 (when opening
 * template's submission_gate_predicate gets populated). Until then, this
 * function stands in for the predicate.
 */
async function loadPriorClosingState(
  sb: ReturnType<typeof getServiceRoleClient>,
  args: { locationId: string; yesterdayDate: string },
): Promise<PriorClosingState> {
  const { data: tmpl, error: tmplErr } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", "closing")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (tmplErr) throw new Error(`prior closing template: ${tmplErr.message}`);
  if (!tmpl) return { exists: false, status: null };

  const { data: inst, error: instErr } = await sb
    .from("checklist_instances")
    .select("status")
    .eq("template_id", tmpl.id)
    .eq("location_id", args.locationId)
    .eq("date", args.yesterdayDate)
    .maybeSingle<{ status: string }>();
  if (instErr) throw new Error(`prior closing instance: ${instErr.message}`);
  if (!inst) return { exists: false, status: null };
  return { exists: true, status: inst.status };
}

interface OpeningPageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function OpeningPage({ searchParams }: OpeningPageProps) {
  const auth = await requireSessionFromHeaders("/operations/opening");
  const language: Language = auth.user.language;

  const sb = getServiceRoleClient();
  const locationActor: LocationActor = {
    role: auth.role,
    locations: auth.locations,
  };
  const locations = await loadAccessibleLocations(sb, locationActor);

  const { location: locParam } = await searchParams;
  const selectedLocation =
    (locParam ? locations.find((l) => l.id === locParam) : null) ??
    locations[0] ??
    null;

  if (!selectedLocation) {
    return (
      <AuthShell>
        <ScaffoldHeader language={language} />
        <NoLocationView language={language} />
        <FooterActions />
        <IdleTimeoutWarning />
      </AuthShell>
    );
  }

  const { today, yesterday } = todayAndYesterday();

  // Gate check: prior night's closing must be in any non-open state for
  // opening to proceed. (PR 4 will wire the formal predicate evaluator;
  // for PR 2 this manual check stands in.)
  const priorClosing = await loadPriorClosingState(sb, {
    locationId: selectedLocation.id,
    yesterdayDate: yesterday,
  });
  const gateBlocked = priorClosing.exists && priorClosing.status === "open";

  if (gateBlocked) {
    return (
      <AuthShell>
        <ScaffoldHeader language={language} />
        <GateBlockedBanner
          location={selectedLocation}
          yesterdayDate={yesterday}
          language={language}
        />
        <FooterActions />
        <IdleTimeoutWarning />
      </AuthShell>
    );
  }

  // Load opening state (creates instance if absent).
  const state = await loadOpeningState(sb, {
    locationId: selectedLocation.id,
    date: today,
    actor: { userId: auth.user.id, role: auth.role, level: auth.level },
  });

  if (!state) {
    return (
      <AuthShell>
        <ScaffoldHeader language={language} />
        <NoTemplateView location={selectedLocation} language={language} />
        <FooterActions />
        <IdleTimeoutWarning />
      </AuthShell>
    );
  }

  // Branch by status.
  if (state.instance.status === "confirmed" || state.instance.status === "auto_finalized") {
    const submitter =
      state.instance.confirmedBy && state.authors[state.instance.confirmedBy]
        ? state.authors[state.instance.confirmedBy]!
        : "—";
    return (
      <AuthShell>
        <ScaffoldHeader language={language} />
        <ReadOnlyBanner
          location={selectedLocation}
          submitterName={submitter}
          confirmedAt={state.instance.confirmedAt}
          language={language}
        />
        <FooterActions />
        <IdleTimeoutWarning />
      </AuthShell>
    );
  }

  // status='open' — render the form.
  return (
    <AuthShell>
      <OpeningClient
        instance={state.instance}
        templateItems={state.templateItems}
        language={language}
      />
      <IdleTimeoutWarning />
    </AuthShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ScaffoldHeader({ language }: { language: Language }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {serverT(language, "opening.page.label")}
      </p>
      <h2 className="mt-1 text-2xl font-extrabold leading-tight text-co-text">
        {serverT(language, "opening.page.title")}
      </h2>
    </div>
  );
}

function FooterActions() {
  return (
    <div className="mt-6 flex justify-center">
      <LogoutButton />
    </div>
  );
}

function NoLocationView({ language }: { language: Language }) {
  return (
    <section className="rounded-2xl border-2 border-co-border bg-co-surface p-5 text-center sm:p-6">
      <p className="text-sm text-co-text-muted">
        {serverT(language, "opening.no_location.body")}
      </p>
      <Link
        href="/dashboard"
        className="
          mt-3 inline-flex min-h-[48px] items-center justify-center rounded-md
          border-2 border-co-text bg-co-surface px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
        "
      >
        {serverT(language, "opening.page.dashboard_back")}
      </Link>
    </section>
  );
}

function NoTemplateView({
  location,
  language,
}: {
  location: LocationLite;
  language: Language;
}) {
  return (
    <section
      role="alert"
      aria-label={serverT(language, "opening.no_template.aria")}
      className="rounded-2xl border-2 border-co-border bg-co-surface p-5 sm:p-6"
    >
      <h3 className="text-base font-bold text-co-text">
        {serverT(language, "opening.no_template.heading")}
      </h3>
      <p className="mt-2 text-sm text-co-text-muted">
        {serverT(language, "opening.no_template.body", { code: location.code })}
      </p>
    </section>
  );
}

function GateBlockedBanner({
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
      aria-label={serverT(language, "opening.gate.aria")}
      className="
        flex flex-col gap-3 rounded-2xl
        border-2 border-co-gold-deep bg-[#FFF4D0]
        p-4 sm:p-5
      "
    >
      <div>
        <p className="text-sm font-bold text-co-text">
          {serverT(language, "opening.gate.title", { code: location.code })}
        </p>
        <p className="mt-1 text-xs text-co-text-muted">
          {serverT(language, "opening.gate.body", {
            date: formatDateLabel(yesterdayDate, language),
          })}
        </p>
      </div>
      <div>
        <Link
          href={`/operations/closing?location=${location.id}&date=${yesterdayDate}`}
          className="
            inline-flex min-h-[48px] items-center justify-center rounded-md
            border-2 border-co-text bg-co-surface px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
          "
        >
          {serverT(language, "opening.gate.cta_view_prior_closing")}
        </Link>
      </div>
    </section>
  );
}

function ReadOnlyBanner({
  location,
  submitterName,
  confirmedAt,
  language,
}: {
  location: LocationLite;
  submitterName: string;
  confirmedAt: string | null;
  language: Language;
}) {
  return (
    <section className="rounded-2xl border-2 border-co-border bg-co-surface p-5 sm:p-6">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {serverT(language, "opening.read_only.label", { code: location.code })}
      </p>
      <h3 className="mt-1 text-xl font-extrabold leading-tight text-co-text">
        {serverT(language, "opening.read_only.title")}
      </h3>
      <p className="mt-2 text-sm text-co-text-muted">
        {confirmedAt
          ? serverT(language, "opening.read_only.attribution", {
              name: submitterName,
              time: formatTime(confirmedAt, language),
            })
          : serverT(language, "opening.read_only.attribution_no_time", {
              name: submitterName,
            })}
      </p>
    </section>
  );
}
