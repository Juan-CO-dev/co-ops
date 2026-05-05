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
import {
  canEditReport,
  loadChecklistChainAttribution,
  type ChecklistChainEntry,
} from "@/lib/checklists";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { ChecklistInstance, PrepInputs } from "@/lib/types";

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
  searchParams: Promise<{ location?: string; edit?: string }>;
}

export default async function AmPrepPage({ searchParams }: PageProps) {
  // 1. Auth boundary (handled by `(authed)` layout, but the page calls
  //    requireSessionFromHeaders again to get a typed AuthContext for its
  //    own auth-aware reads — same pattern as closing-page).
  const auth = await requireSessionFromHeaders("/operations/am-prep");
  const { location: locationParam, edit: editParam } = await searchParams;
  const editRequested = editParam === "true";

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
  //    For chained submissions (C.46): state.completions already contains
  //    completions across the chain (chain head + updates). For each
  //    template_item_id, the latest by edit_count reflects the
  //    chain-resolved current state — used here for initialValues.
  //
  //    Edge case: if instance status is 'open' but completions exist
  //    (shouldn't happen with single-submission templates per RPC atomic
  //    write, but defensive), the form renders editable with pre-populated
  //    values. Per submitAmPrep RPC behavior, completions and
  //    status='confirmed' are written atomically.
  const latestEditCountByItem = new Map<string, number>();
  const initialValues: Record<string, PrepInputs> = {};
  for (const c of state.completions) {
    if (!c.prepData) continue;
    const existing = latestEditCountByItem.get(c.templateItemId);
    if (existing === undefined || (c.editCount ?? 0) >= existing) {
      latestEditCountByItem.set(c.templateItemId, c.editCount ?? 0);
      initialValues[c.templateItemId] = c.prepData.inputs;
    }
  }

  // 6. C.46 — load chain attribution + compute edit-mode access. Only
  //    meaningful when the instance is already confirmed (chain head exists).
  const chainState = await loadChainStateForPage({
    sb,
    instance: state.instance,
    locationId: locationParam,
    date: today,
  });
  const access =
    chainState.chain.length > 0
      ? canEditReport({
          actor: { userId: auth.user.id, level: auth.level },
          originalSubmitterId: chainState.chain[0]!.submitterId,
          closingStatus: chainState.closingStatus,
          currentEditCount: chainState.maxEditCount,
        })
      : { canEdit: false as const, reason: "no_chain" };

  // Race-case redirect: ?edit=true requested but actor lacks access. Drop
  // the param so the user lands in read-only mode rather than rendering
  // edit UI we'd immediately deny.
  if (editRequested && !access.canEdit) {
    redirect(`/operations/am-prep?location=${locationParam}`);
  }

  // Mode derivation: three discrete modes (replaces former isReadOnly
  // derivation inside AmPrepForm).
  const mode: "submit" | "edit" | "read_only" =
    chainState.chain.length === 0
      ? "submit"
      : editRequested && access.canEdit
        ? "edit"
        : "read_only";

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

      {/* C.46 + C.44 — when a chain exists (edit/read_only modes), filter
          templateItems to the chain head's snapshot universe. Template
          additions between original submission and edit appear ONLY on
          tomorrow's fresh submission, not retroactively in the chain. */}
      {(() => {
        const editableTemplateItems =
          chainState.chain.length === 0
            ? state.templateItems
            : state.templateItems.filter((it) =>
                chainState.chainHeadTemplateItemIds.has(it.id),
              );
        const divergedItemCount =
          state.templateItems.length - editableTemplateItems.length;
        return (
          <div className="mt-4">
            <AmPrepForm
              instance={state.instance}
              templateItems={editableTemplateItems}
              initialValues={initialValues}
              authors={state.authors}
              actor={{ userId: auth.user.id, name: auth.user.name }}
              mode={mode}
              chainAttribution={chainState.chain}
              originalSubmissionId={chainState.originalSubmissionId}
              locationId={locationParam}
              divergedItemCount={divergedItemCount}
            />
          </div>
        );
      })()}
    </main>
  );
}

/**
 * C.46 helper — loads chain attribution + max edit_count + closing status
 * for the page Server Component. Returns empty chain when the instance has
 * no chain head (i.e., not yet submitted; mode="submit" path).
 */
async function loadChainStateForPage(args: {
  sb: ReturnType<typeof getServiceRoleClient>;
  instance: ChecklistInstance;
  locationId: string;
  date: string;
}): Promise<{
  chain: ChecklistChainEntry[];
  originalSubmissionId: string | null;
  maxEditCount: number;
  closingStatus: ChecklistInstance["status"] | null;
  /**
   * C.46 + C.44 — set of template_item_ids in the chain head's completion
   * universe. Used to filter the form's templateItems prop when a chain
   * exists, so that template additions between the original submission
   * and the edit don't surface in edit/read_only modes (they appear on
   * tomorrow's fresh submission per C.44 snapshot-frozen-at-submission).
   * Empty Set when no chain exists.
   */
  chainHeadTemplateItemIds: Set<string>;
}> {
  // Find chain head submission (original_submission_id IS NULL). Pull
  // completion_ids too — used to derive the chain head's template_item
  // universe per C.44 snapshot-locked semantic.
  const { data: headSub, error: headErr } = await args.sb
    .from("checklist_submissions")
    .select("id, completion_ids")
    .eq("instance_id", args.instance.id)
    .is("original_submission_id", null)
    .maybeSingle<{ id: string; completion_ids: string[] }>();
  if (headErr) {
    throw new Error(`am-prep page: load chain head: ${headErr.message}`);
  }

  if (!headSub) {
    return {
      chain: [],
      originalSubmissionId: null,
      maxEditCount: 0,
      closingStatus: null,
      chainHeadTemplateItemIds: new Set(),
    };
  }

  const chain = await loadChecklistChainAttribution(args.sb, {
    originalSubmissionId: headSub.id,
  });
  const maxEditCount = chain.reduce(
    (max, e) => (e.editCount > max ? e.editCount : max),
    0,
  );

  // Load chain head's completions to derive the snapshot-locked
  // template_item universe. Use completion_ids array directly (canonical
  // reference of "what was in this submission"); avoids dependence on
  // completion-row state filtering that could drift if chain semantics
  // ever change.
  const chainHeadTemplateItemIds = new Set<string>();
  if (headSub.completion_ids.length > 0) {
    const { data: headComps, error: headCompErr } = await args.sb
      .from("checklist_completions")
      .select("template_item_id")
      .in("id", headSub.completion_ids);
    if (headCompErr) {
      throw new Error(
        `am-prep page: load chain head completions: ${headCompErr.message}`,
      );
    }
    for (const c of (headComps ?? []) as Array<{ template_item_id: string }>) {
      chainHeadTemplateItemIds.add(c.template_item_id);
    }
  }

  // Closing status (two-step pattern per AGENTS.md PostgREST gotcha).
  const { data: closingTemplates, error: cTmplErr } = await args.sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", args.locationId)
    .eq("type", "closing")
    .eq("active", true);
  if (cTmplErr) {
    throw new Error(`am-prep page: load closing templates: ${cTmplErr.message}`);
  }
  const closingTemplateIds = (
    (closingTemplates ?? []) as Array<{ id: string }>
  ).map((t) => t.id);

  let closingStatus: ChecklistInstance["status"] | null = null;
  if (closingTemplateIds.length > 0) {
    const { data: closingInst, error: cInstErr } = await args.sb
      .from("checklist_instances")
      .select("status")
      .in("template_id", closingTemplateIds)
      .eq("date", args.date)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ status: ChecklistInstance["status"] }>();
    if (cInstErr) {
      throw new Error(`am-prep page: load closing instance: ${cInstErr.message}`);
    }
    closingStatus = closingInst?.status ?? null;
  }

  return {
    chain,
    originalSubmissionId: headSub.id,
    maxEditCount,
    closingStatus,
    chainHeadTemplateItemIds,
  };
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
