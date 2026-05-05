"use client";

/**
 * ReportReferenceItem — Build #2 PR 1, closing-client report-reference
 * rendering.
 *
 * Renders closing template items where templateItem.reportReferenceType
 * is non-null (per SPEC_AMENDMENTS.md C.42 + migration 0036). These items
 * are auto-completed when their source report submits — closer can't tick
 * them directly. The display surface is fundamentally different from
 * ChecklistItem (no tap-to-complete, no Undo/peer-tag, no count/notes
 * input), so this is a separate component rather than a branch inside
 * ChecklistItem (which is already 1500+ lines with a complex state
 * machine).
 *
 * Three rendering states:
 *
 *   1. Live auto-complete (live completion exists with auto_complete_meta):
 *      - Filled co-success (Brand Green) check circle — distinct from
 *        cleaning's Mustard fill so closer immediately knows "this came
 *        from a report, not a tap"
 *      - Item label normal weight + dim treatment matching cleaning's
 *        completed state
 *      - Inline attribution subtitle: "Submitted by {name} at {time}"
 *      - cursor-default (no tap interaction)
 *
 *   2. Empty pending (no completion AND not read-only):
 *      - Empty circle (same shape as cleaning's not-yet-completed state)
 *      - Item label
 *      - Italic subtitle: "Pending — submit from the dashboard"
 *      - Tap navigates to /operations/am-prep?location=<id> (saves the
 *        closer a step vs forcing dashboard navigation)
 *      - cursor-pointer + hover affordance
 *
 *   3. Empty pending (no completion AND read-only):
 *      - Same visual as state 2 (empty circle + pending subtitle) but
 *        non-interactive. Closing has been finalized; the report-reference
 *        item was flagged as incomplete with a reason in checklist_
 *        incomplete_reasons. Reason text is captured at finalize time;
 *        rendering it here is left to the parent (closing-client surfaces
 *        incomplete-reasons in the Review section, not inline on rows).
 *      - cursor-default
 *
 * SYSTEM-KEY DISCIPLINE per C.38: matching/grouping uses original
 * (English) templateItem fields; resolveTemplateItemContent provides the
 * translated display labels. The component reads `resolved.label` for the
 * row label; ARIA labels also use the translated label.
 *
 * Walk-Out Verification gate is unaffected: report-reference items live
 * in the Closing Manager station, never Walk-Out Verification. The
 * walkOutVerificationComplete derivation in closing-client filters by
 * station === "Walk-Out Verification" (system-key match), which never
 * matches a report-reference item.
 */

import Link from "next/link";

import type { ChecklistChainEntry } from "@/lib/checklists";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import { formatChainAttribution, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { ChecklistCompletion, ChecklistTemplateItem } from "@/lib/types";

interface ReportReferenceItemProps {
  templateItem: ChecklistTemplateItem;
  /** Live (non-superseded, non-revoked) completion, or null. */
  completion: ChecklistCompletion | null;
  /**
   * Pre-resolved completer name (parent does the users-table join).
   * For auto-complete rows, this is the report submitter (e.g., the
   * person who submitted AM Prep that auto-completed this item).
   */
  completionAuthor?: { name: string; isSelf: boolean } | null;
  /** Location id — used to build the tap-to-navigate href on empty state. */
  locationId: string;
  /** Read-only override — disables empty-state tap when closing is finalized. */
  readOnly: boolean;
  /**
   * C.46 — full AM Prep submission chain (head + updates) for chained
   * attribution rendering. Empty/null when chain not loaded or single-entry
   * (legacy single-author rendering applies).
   */
  chainAttribution?: ChecklistChainEntry[] | null;
  /**
   * C.46 — caller-computed predicate per A2: KH+ at any time OR original
   * submitter while closing not finalized. Drives Edit affordance rendering.
   */
  canEdit?: boolean;
}

export function ReportReferenceItem({
  templateItem,
  completion,
  completionAuthor,
  locationId,
  readOnly,
  chainAttribution,
  canEdit = false,
}: ReportReferenceItemProps) {
  const { t, language } = useTranslation();
  const resolved = resolveTemplateItemContent(templateItem, language);

  const isAutoCompleted = completion !== null && completion.autoCompleteMeta !== null;
  const editHref = `/operations/am-prep?location=${locationId}&edit=true`;

  // ─── State 1: Live auto-complete ──────────────────────────────────────────

  if (isAutoCompleted && completion) {
    // C.46 — chain rendering: 2+ entries → comma-separated chain via shared
    // formatter; 1 entry / no chain → existing single-author rendering.
    const hasChain = chainAttribution !== undefined && chainAttribution !== null && chainAttribution.length >= 2;
    const submitterName = hasChain
      ? chainAttribution![0]!.submitterName
      : completionAuthor?.name ?? "—";
    const time = formatTime(completion.completedAt, language);
    const attribution = hasChain
      ? formatChainAttribution(chainAttribution!, language, t)
      : t("closing.report_ref.attribution", {
          name: submitterName,
          time,
        });
    const ariaLabel = hasChain
      ? t("closing.report_ref.complete_aria_chain", {
          label: resolved.label,
          attribution,
        })
      : t("closing.report_ref.complete_aria", {
          label: resolved.label,
          name: submitterName,
          time,
        });

    return (
      <div
        role="status"
        aria-label={ariaLabel}
        className="
          group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5
          min-h-[56px]
          border border-co-border bg-co-surface-2/60
          cursor-default
        "
      >
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center">
          <AutoCompleteCheckIcon />
        </span>
        <span className="flex flex-1 flex-col items-start gap-0.5 min-w-0">
          <span className="text-sm font-semibold leading-tight text-co-text-muted">
            {resolved.label}
          </span>
          <span className="text-[11px] text-co-text-dim">{attribution}</span>
        </span>
        {/* C.46 A2 — Edit affordance for KH+ users + original submitters
            while access is valid. Secondary text-link styling (Edit is
            correction action, not primary). */}
        {canEdit ? (
          <Link
            href={editHref}
            aria-label={t("closing.report_ref.edit_link_aria", {
              name: submitterName,
            })}
            className="
              shrink-0 text-[11px] font-bold uppercase tracking-[0.12em]
              text-co-text-muted transition hover:text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/40
              rounded-md px-2 py-1.5 -mr-1
            "
          >
            {t("closing.report_ref.edit_link")}
          </Link>
        ) : null}
      </div>
    );
  }

  // ─── State 2 + 3: Empty pending (interactive when !readOnly) ──────────────

  const subtitleText = t("closing.report_ref.empty_subtitle");
  const tapHref = `/operations/am-prep?location=${locationId}`;

  // Tappable when the closing is still open (closer can navigate to AM
  // Prep and submit it from there).
  if (!readOnly) {
    const ariaLabel = t("closing.report_ref.tap_to_submit_aria", {
      label: resolved.label,
    });
    return (
      <Link
        href={tapHref}
        aria-label={ariaLabel}
        className="
          group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5
          min-h-[56px]
          border border-co-border bg-co-surface
          transition hover:border-co-gold-deep hover:bg-co-surface-2 active:bg-co-surface-2
          focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          cursor-pointer
        "
      >
        <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center">
          <EmptyCircleIcon />
        </span>
        <span className="flex flex-1 flex-col items-start gap-0.5 min-w-0">
          <span className="text-sm font-semibold leading-tight text-co-text">
            {resolved.label}
          </span>
          <span className="text-[11px] italic text-co-text-dim">{subtitleText}</span>
        </span>
      </Link>
    );
  }

  // Read-only empty state — closing has been finalized without this report
  // being submitted. The incomplete-reason captured at finalize time lives
  // on checklist_incomplete_reasons + is surfaced by closing-client's
  // Review section; this row stays minimal (no inline reason rendering).
  const readOnlyAriaLabel = t("closing.report_ref.empty_aria", { label: resolved.label });
  return (
    <div
      role="status"
      aria-label={readOnlyAriaLabel}
      className="
        group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5
        min-h-[56px]
        border border-co-border bg-co-surface
        opacity-70 cursor-default
      "
    >
      <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center">
        <EmptyCircleIcon />
      </span>
      <span className="flex flex-1 flex-col items-start gap-0.5 min-w-0">
        <span className="text-sm font-semibold leading-tight text-co-text">
          {resolved.label}
        </span>
        <span className="text-[11px] italic text-co-text-dim">{subtitleText}</span>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-complete check icon — Brand Green (co-success) filled circle with
 * white check. Distinct from cleaning's Mustard tick so closer immediately
 * recognizes the row was auto-completed from a report submission.
 */
function AutoCompleteCheckIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="text-co-success"
    >
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path
        d="M7 12.5L10.5 16L17 9"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Empty-circle icon — same visual shape as ChecklistItem's empty circle
 * (per cleaning convention) but local to this module per the
 * "components stay self-contained" pattern.
 */
function EmptyCircleIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="text-co-text-dim"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}
