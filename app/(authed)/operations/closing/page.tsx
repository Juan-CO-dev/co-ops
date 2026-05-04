/**
 * /operations/closing — Module #1 Build #1 step 9.
 *
 * The closing checklist surface. Server Component does the initial data
 * load (auth check, location-access validation, template + items + instance
 * + completions + authors); ClosingClient owns the interactive lifecycle
 * (state, taps, optimistic UI, review, PinConfirmModal).
 *
 * URL params:
 *   ?location=<id>  required — redirects to /dashboard if missing or
 *                   inaccessible
 *   ?date=YYYY-MM-DD optional — historical view (read-only); when omitted
 *                   the page operates on today's instance in NY time
 *
 * Today / yesterday / historical mode determination:
 *   - today   = nyDateString(now), the operational day in America/New_York
 *   - yesterday = today - 1 calendar day
 *   - historical = (?date is set AND ?date !== today)
 *   - readOnly mode fires when:
 *       * historical AND date === yesterday AND status === 'open'
 *         → "Yesterday's closing was not confirmed. Contact a manager
 *            to finalize." (operationally: the opener wasn't there for
 *            the prior shift's closing — they can't honestly attest to
 *            work they didn't witness. Management override path comes
 *            in Phase 5+ admin tools.)
 *       * historical (any other prior date) → generic read-only banner
 *       * status === 'confirmed' / 'incomplete_confirmed' (any date)
 *         → confirmed/incomplete read-only banner
 *
 * For today + status='open', the page is fully interactive. If today's
 * instance doesn't yet exist, getOrCreateInstance creates it server-side
 * (idempotent — no flash of empty state on the client).
 *
 * Operational TZ hardcoded to America/New_York per SPEC_AMENDMENTS.md C.23
 * (locations.timezone column doesn't exist in schema §4.1; CO is DC-only).
 */

import { redirect } from "next/navigation";

import { getOrCreateInstance } from "@/lib/checklists";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type {
  AutoCompleteMeta,
  ChecklistCompletion,
  ChecklistInstance,
  ChecklistRevocationReason,
  ChecklistStatus,
  ChecklistTemplateItem,
  ChecklistTemplateItemTranslations,
  PrepData,
  PrepMeta,
  ReportType,
} from "@/lib/types";

import { ClosingClient, type ClosingInitialState, type StatusBanner } from "./closing-client";

const OPERATIONAL_TZ = "America/New_York";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatDateLabel(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (!y || !m || !d) return yyyymmdd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(dt);
}

// formatTime imported from @/lib/i18n/format above; canonical helper
// (Build #2 PR 2) consolidates 6 prior inline copies and always pins
// to the operational TZ. The previous inline closing/page formatTime
// already passed timeZone: OPERATIONAL_TZ, so this surface was
// TZ-correct, but lifted for the language-locale add (was hardcoded
// "en-US") and for consistency with the canonical pattern.

// ─────────────────────────────────────────────────────────────────────────────
// snake_case → camelCase row mappers
// ─────────────────────────────────────────────────────────────────────────────

interface InstanceRow {
  id: string;
  template_id: string;
  location_id: string;
  date: string;
  shift_start_at: string | null;
  status: ChecklistStatus;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_at: string;
  // Build #2 (per SPEC_AMENDMENTS.md C.18 + C.43; migration 0038).
  triggered_by_user_id: string | null;
  triggered_at: string | null;
}

const rowToInstance = (r: InstanceRow): ChecklistInstance => ({
  id: r.id,
  templateId: r.template_id,
  locationId: r.location_id,
  date: r.date,
  shiftStartAt: r.shift_start_at,
  status: r.status,
  confirmedAt: r.confirmed_at,
  confirmedBy: r.confirmed_by,
  createdAt: r.created_at,
  triggeredByUserId: r.triggered_by_user_id,
  triggeredAt: r.triggered_at,
});

interface TemplateItemRow {
  id: string;
  template_id: string;
  station: string | null;
  display_order: number;
  label: string;
  description: string | null;
  min_role_level: number;
  required: boolean;
  expects_count: boolean;
  expects_photo: boolean;
  vendor_item_id: string | null;
  active: boolean;
  translations: ChecklistTemplateItemTranslations | null;
  // Build #2 (per SPEC_AMENDMENTS.md C.18 + C.42; migration 0036).
  // prep_meta NULL on cleaning items; report_reference_type non-null on
  // closing's report-reference items (auto-complete on report submission).
  prep_meta: unknown | null;
  report_reference_type: ReportType | null;
}

const rowToTemplateItem = (r: TemplateItemRow): ChecklistTemplateItem => ({
  id: r.id,
  templateId: r.template_id,
  station: r.station,
  displayOrder: r.display_order,
  label: r.label,
  description: r.description,
  minRoleLevel: r.min_role_level,
  required: r.required,
  expectsCount: r.expects_count,
  expectsPhoto: r.expects_photo,
  vendorItemId: r.vendor_item_id,
  active: r.active,
  translations: r.translations,
  // Pass-through; lib/prep.ts narrows the JSONB shape via isPrepMeta() for
  // prep-aware consumers. The closing surface only reads reportReferenceType
  // (later step in this PR — render report-reference items distinctly).
  prepMeta: (r.prep_meta ?? null) as PrepMeta | null,
  reportReferenceType: r.report_reference_type,
});

interface CompletionRow {
  id: string;
  instance_id: string;
  template_item_id: string;
  completed_by: string;
  completed_at: string;
  count_value: string | number | null;
  photo_id: string | null;
  notes: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
  // Revoke / tag fields per SPEC_AMENDMENTS.md C.28. PR 1 wires server-side
  // reads to surface them; PR 2 ships the UI rendering.
  revoked_at: string | null;
  revoked_by: string | null;
  revocation_reason: ChecklistRevocationReason | null;
  revocation_note: string | null;
  actual_completer_id: string | null;
  actual_completer_tagged_at: string | null;
  actual_completer_tagged_by: string | null;
  // Build #2 (per SPEC_AMENDMENTS.md C.18 + C.44; migration 0037). Always
  // NULL on closing-page-loaded completions (closing items don't carry
  // prep payloads). Pass-through here for type completeness.
  prep_data: unknown | null;
  // Build #2 (per SPEC_AMENDMENTS.md C.42; migration 0040). Populated on
  // the closing's auto-completed report-reference items (e.g., "AM Prep
  // List ✓ — submitted by Cristian at 9:47 PM"). Closing-client reads
  // this to branch attribution-style rendering vs user-notes rendering
  // (later step in this PR).
  auto_complete_meta: unknown | null;
}

const rowToCompletion = (r: CompletionRow): ChecklistCompletion => ({
  id: r.id,
  instanceId: r.instance_id,
  templateItemId: r.template_item_id,
  completedBy: r.completed_by,
  completedAt: r.completed_at,
  countValue: r.count_value === null ? null : Number(r.count_value),
  photoId: r.photo_id,
  notes: r.notes,
  supersededAt: r.superseded_at,
  supersededBy: r.superseded_by,
  revokedAt: r.revoked_at,
  revokedBy: r.revoked_by,
  revocationReason: r.revocation_reason,
  revocationNote: r.revocation_note,
  actualCompleterId: r.actual_completer_id,
  actualCompleterTaggedAt: r.actual_completer_tagged_at,
  actualCompleterTaggedBy: r.actual_completer_tagged_by,
  prepData: (r.prep_data ?? null) as PrepData | null,
  autoCompleteMeta: (r.auto_complete_meta ?? null) as AutoCompleteMeta | null,
});

// ─────────────────────────────────────────────────────────────────────────────
// Banner derivation
// ─────────────────────────────────────────────────────────────────────────────

interface BannerContext {
  isHistorical: boolean;
  isYesterday: boolean;
  date: string;
  status: ChecklistStatus;
  confirmedAt: string | null;
  confirmedByName: string | null;
}

function deriveBanner(ctx: BannerContext, language: Language): StatusBanner | null {
  // Yesterday's open instance → strict read-only with manager-finalize message.
  if (ctx.isHistorical && ctx.isYesterday && ctx.status === "open") {
    return {
      tone: "yesterday_unconfirmed",
      message: serverT(language, "closing.banner.yesterday_unconfirmed"),
    };
  }
  // Confirmed / incomplete-confirmed → status-specific banner (today or historical).
  if (ctx.status === "confirmed") {
    const time = ctx.confirmedAt ? formatTime(ctx.confirmedAt, language) : "";
    const who = ctx.confirmedByName ?? "—";
    const timePrefix = time ? serverT(language, "closing.banner.time_prefix", { time }) : "";
    return {
      tone: "confirmed",
      message: serverT(language, "closing.banner.confirmed", { time: timePrefix, who }),
    };
  }
  if (ctx.status === "incomplete_confirmed") {
    const time = ctx.confirmedAt ? formatTime(ctx.confirmedAt, language) : "";
    const who = ctx.confirmedByName ?? "—";
    const timePrefix = time ? serverT(language, "closing.banner.time_prefix", { time }) : "";
    return {
      tone: "incomplete_confirmed",
      message: serverT(language, "closing.banner.incomplete_confirmed", { time: timePrefix, who }),
    };
  }
  // Older historical (not yesterday, not confirmed) — abandoned older closing.
  if (ctx.isHistorical) {
    return {
      tone: "historical",
      message: serverT(language, "closing.banner.historical", { date: formatDateLabel(ctx.date) }),
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ location?: string; date?: string }>;
}

export default async function ClosingPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/operations/closing");
  const { location: locationParam, date: dateParam } = await searchParams;

  if (!locationParam) redirect("/dashboard");

  const locActor: LocationActor = {
    role: auth.role,
    locations: auth.locations,
  };
  if (!lockLocationContext(locActor, locationParam)) {
    redirect("/dashboard");
  }

  // TODO(future): could be tightened to an authed client constructed from
  // the request cookie store for defense-in-depth — if lockLocationContext
  // above ever breaks, RLS would still gate the queries below. Service-role
  // matches the /dashboard pattern for Build #1 simplicity. See
  // SPEC_AMENDMENTS.md C.24 for the documented decision.
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

  // Resolve active closing template (most recent active per Path A versioning
  // — picks v2 once Build #2 ships it without requiring code change).
  const { data: templateRow, error: tmplErr } = await sb
    .from("checklist_templates")
    .select("id")
    .eq("location_id", locationParam)
    .eq("type", "closing")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (tmplErr) throw new Error(`load template: ${tmplErr.message}`);
  if (!templateRow) {
    return (
      <NoTemplateView
        locationLabel={`${locationRow.code} · ${locationRow.name}`}
        language={auth.user.language}
      />
    );
  }

  // Date determination.
  const today = nyDateString(new Date());
  const requestedDate = dateParam && DATE_RE.test(dateParam) ? dateParam : null;
  const targetDate = requestedDate ?? today;
  const isHistorical = targetDate !== today;

  const todayUtc = new Date(`${today}T00:00:00Z`);
  todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  const yesterday = todayUtc.toISOString().slice(0, 10);
  const isYesterday = isHistorical && targetDate === yesterday;

  // Load or create the instance.
  let instanceRow: InstanceRow | null = null;
  if (isHistorical) {
    const { data, error } = await sb
      .from("checklist_instances")
      .select(
        "id, template_id, location_id, date, shift_start_at, status, confirmed_at, confirmed_by, created_at, triggered_by_user_id, triggered_at",
      )
      .eq("template_id", templateRow.id)
      .eq("location_id", locationParam)
      .eq("date", targetDate)
      .maybeSingle<InstanceRow>();
    if (error) throw new Error(`load historical instance: ${error.message}`);
    instanceRow = data;
    if (!instanceRow) {
      return (
        <NoInstanceView
          locationLabel={`${locationRow.code} · ${locationRow.name}`}
          dateLabel={formatDateLabel(targetDate)}
        />
      );
    }
  } else {
    // Today — get-or-create. Service-role bypasses RLS at INSERT; the audit
    // row records actor metadata correctly via the actor parameter.
    const result = await getOrCreateInstance(sb, {
      templateId: templateRow.id,
      locationId: locationParam,
      date: today,
      actor: { userId: auth.user.id, role: auth.role, level: auth.level },
    });
    instanceRow = {
      id: result.instance.id,
      template_id: result.instance.templateId,
      location_id: result.instance.locationId,
      date: result.instance.date,
      shift_start_at: result.instance.shiftStartAt,
      status: result.instance.status,
      confirmed_at: result.instance.confirmedAt,
      confirmed_by: result.instance.confirmedBy,
      created_at: result.instance.createdAt,
      triggered_by_user_id: result.instance.triggeredByUserId,
      triggered_at: result.instance.triggeredAt,
    };
  }

  // Load template items (active only, ordered).
  const { data: itemsRows, error: itemsErr } = await sb
    .from("checklist_template_items")
    .select(
      "id, template_id, station, display_order, label, description, min_role_level, required, expects_count, expects_photo, vendor_item_id, active, translations, prep_meta, report_reference_type",
    )
    .eq("template_id", templateRow.id)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (itemsErr) throw new Error(`load items: ${itemsErr.message}`);
  const templateItems = ((itemsRows ?? []) as TemplateItemRow[]).map(rowToTemplateItem);

  // Load live (non-superseded, non-revoked) completions. Revoked completions
  // are excluded from the live set per SPEC_AMENDMENTS.md C.28 — same
  // semantics as superseded. The progress bar, station counters, and
  // Walk-Out Verification gate all treat revoked rows as not-completed.
  const { data: completionRows, error: compErr } = await sb
    .from("checklist_completions")
    .select(
      "id, instance_id, template_item_id, completed_by, completed_at, count_value, photo_id, notes, superseded_at, superseded_by, revoked_at, revoked_by, revocation_reason, revocation_note, actual_completer_id, actual_completer_tagged_at, actual_completer_tagged_by, prep_data, auto_complete_meta",
    )
    .eq("instance_id", instanceRow.id)
    .is("superseded_at", null)
    .is("revoked_at", null);
  if (compErr) throw new Error(`load completions: ${compErr.message}`);
  const completions = ((completionRows ?? []) as CompletionRow[]).map(rowToCompletion);

  // Resolve author names for completion meta + confirmedBy + accountability
  // tagging (per SPEC_AMENDMENTS.md C.28). actualCompleterId carries the
  // accountability-truth author whose name is rendered as the
  // "credited to [name]" annotation in ChecklistItem.
  const authorIds = new Set<string>();
  for (const c of completions) {
    authorIds.add(c.completedBy);
    if (c.actualCompleterId) authorIds.add(c.actualCompleterId);
  }
  if (instanceRow.confirmed_by) authorIds.add(instanceRow.confirmed_by);
  const authors: Record<string, string> = {};
  if (authorIds.size > 0) {
    const { data: userRows, error: userErr } = await sb
      .from("users")
      .select("id, name")
      .in("id", Array.from(authorIds));
    if (userErr) throw new Error(`load authors: ${userErr.message}`);
    for (const u of (userRows ?? []) as Array<{ id: string; name: string }>) {
      authors[u.id] = u.name;
    }
  }

  // Build initial completions map keyed by templateItemId.
  const initialCompletions: Record<string, ChecklistCompletion> = {};
  for (const c of completions) {
    initialCompletions[c.templateItemId] = c;
  }

  // Determine read-only mode + banner.
  const isReadOnly =
    isHistorical ||
    instanceRow.status === "confirmed" ||
    instanceRow.status === "incomplete_confirmed";

  const banner = deriveBanner(
    {
      isHistorical,
      isYesterday,
      date: targetDate,
      status: instanceRow.status,
      confirmedAt: instanceRow.confirmed_at,
      confirmedByName: instanceRow.confirmed_by ? authors[instanceRow.confirmed_by] ?? null : null,
    },
    auth.user.language,
  );

  const initialState: ClosingInitialState = {
    location: locationRow,
    instance: rowToInstance(instanceRow),
    templateItems,
    initialCompletions,
    authors,
    actor: { userId: auth.user.id, role: auth.role, level: auth.level },
    readOnly: isReadOnly,
    banner,
    todayDate: today,
  };

  return <ClosingClient initialState={initialState} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty-state views
// ─────────────────────────────────────────────────────────────────────────────

function NoTemplateView({ locationLabel, language }: { locationLabel: string; language: Language }) {
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {serverT(language, "closing.no_template.heading")}
      </p>
      <h1 className="mt-1 text-2xl font-extrabold text-co-text">{locationLabel}</h1>
      <section className="mt-6 rounded-2xl border-2 border-co-border bg-co-surface p-5 text-center sm:p-6">
        <p className="text-sm text-co-text-muted">
          {serverT(language, "closing.no_template.body")}
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
          {serverT(language, "closing.no_template.return_dashboard")}
        </a>
      </section>
    </main>
  );
}

function NoInstanceView({
  locationLabel,
  dateLabel,
}: {
  locationLabel: string;
  dateLabel: string;
}) {
  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        Closing checklist
      </p>
      <h1 className="mt-1 text-2xl font-extrabold text-co-text">{locationLabel}</h1>
      <section className="mt-6 rounded-2xl border-2 border-co-border bg-co-surface p-5 text-center sm:p-6">
        <p className="text-sm text-co-text-muted">
          No closing was filed for {dateLabel} at this location.
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
          Return to dashboard
        </a>
      </section>
    </main>
  );
}
