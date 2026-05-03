"use client";

/**
 * ChecklistItem — Module #1 Build #1 step 6.
 *
 * Renders one row in a checklist instance UI. Designed for the cleaning-
 * phase Closing Checklist (50 rows × 10 stations); reusable by Opening
 * (build #3) and Prep (build #2) once those land.
 *
 * Visual model: row, not card. Left-edge interactive icon (≥48×48 tap
 * target), label center-left, completion meta right-aligned. Station
 * grouping is the parent page's job — this component knows nothing about
 * grouping.
 *
 * State hierarchy (7 states; the spec said 7, this component renders 6 —
 * the `superseded` state is collapsed per design review since the live-
 * completion-only render is the operationally meaningful view; supersede
 * history is a synthesis-view concern):
 *
 *   - not-yet-completable-by-role: actor.level < templateItem.minRoleLevel.
 *     Lock icon, dimmed row, role badge in meta slot ("AGM+ only"). Not
 *     interactive.
 *   - not-yet-completed: open circle icon, full-color label, no meta.
 *     Tap-anywhere-on-row affordance.
 *   - completed-by-self: filled Mustard circle with check, label dimmed,
 *     meta = "you · 2:14 PM". Tap to re-complete (supersedes prior).
 *   - completed-by-other: filled co-surface-2 circle with dim check,
 *     label dimmed, meta = "JC · 2:14 PM". Re-complete still available
 *     to anyone meeting min_role_level.
 *   - in-flight: subtle co-gold-deep border pulse, spinner inside the
 *     left icon, row temporarily non-interactive.
 *   - errored: co-cta (brand Red) left-edge accent, error message in
 *     meta slot, "Retry" affordance. Auto-clears on successful retry.
 *
 * Optimistic vs pessimistic save (per Module #1 design review):
 *   - Optimistic for plain completions (no count / photo / notes).
 *   - Pessimistic for data-carrying completions (count, photo, notes).
 *   - Rule: if any of (countValue, photoId, notes) is non-null in the
 *     payload, save is pessimistic. The data IS the point of the action,
 *     so the row should reflect the saved value, not the pending intent.
 *
 * API ownership: hybrid — this component owns visual lifecycle
 * (optimistic flip, in-flight, rollback, retry) but the parent owns the
 * actual API call via the async onComplete callback. The parent injects
 * instanceId + actor via closure inside the callback. Component stays
 * pure-ish (props in, callback out).
 *
 * Notes-edit reuses the supersede flow per SPEC_AMENDMENTS.md C.22 —
 * editing a note on a completed item creates a new completion that
 * supersedes the prior. Acceptable write multiplier for v1.
 *
 * Photo input is stubbed — `expects_photo: true` items show a "Take
 * photo" affordance that surfaces "Photo capture wires in Build #4"
 * when tapped. The validation gate (expects_photo + null photoId →
 * blocked) is real now so we don't ship a silent no-photo path.
 */

import { useEffect, useState } from "react";

import type { ChecklistCompletion, ChecklistStatus, ChecklistTemplateItem } from "@/lib/types";

// Mirror of the API error shape produced by app/api/checklist/_helpers.ts
// mapChecklistError(). Parent passes errors through verbatim from the API
// response. The `code` field is the switch discriminator — never the
// human-readable message.
export interface ChecklistApiError {
  code: string;
  message: string;
  /** Carried on supersede_failed responses — both completion ids. */
  newCompletionId?: string;
  priorCompletionId?: string;
  /** Carried on role_level_insufficient responses. */
  required?: number;
  actual?: number;
  /** Carried on missing/extra reasons responses (not used in this component). */
  missingTemplateItemIds?: string[];
  extraTemplateItemIds?: string[];
}

export type ChecklistCompletePayload = {
  templateItemId: string;
  countValue?: number | null;
  photoId?: string | null;
  notes?: string | null;
};

export type ChecklistCompleteResult =
  | { completion: ChecklistCompletion }
  | { error: ChecklistApiError };

interface ChecklistItemProps {
  templateItem: ChecklistTemplateItem;
  /** Live (non-superseded) completion for this item, or null. */
  completion: ChecklistCompletion | null;
  /** Resolved by parent via users join — kept off the component to avoid a fetch per row. */
  completionAuthor?: { name: string; isSelf: boolean } | null;
  /** Caller's role level — drives the role-gate visual + interaction state. */
  actorLevel: number;
  /** Instance status — disables interaction when not 'open'. */
  instanceStatus: ChecklistStatus;
  /**
   * Read-only override. When true, the row is strictly non-interactive
   * regardless of instance status. Used by surfaces that present a
   * historical or restricted view (e.g., yesterday's unconfirmed closing,
   * already-confirmed instance review). Status reflects reality;
   * readOnly reflects intent — both can be set independently.
   */
  readOnly?: boolean;
  /**
   * Async callback. Parent fires the API call.
   * Returns { completion } on success, { error } on failure.
   * Component handles optimistic-flip, in-flight, rollback, retry locally.
   */
  onComplete: (payload: ChecklistCompletePayload) => Promise<ChecklistCompleteResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const formatTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

const initialsFor = (name: string): string => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
};

const isDataCarrying = (payload: ChecklistCompletePayload): boolean =>
  (payload.countValue !== undefined && payload.countValue !== null) ||
  (payload.photoId !== undefined && payload.photoId !== null) ||
  (payload.notes !== undefined && payload.notes !== null);

const roleBadgeText = (level: number): string => {
  // Compact label for the meta slot when the row is role-gated. Sticks to
  // the four levels actually present in foundation closing templates.
  if (level >= 8) return "CGS only";
  if (level >= 7) return "Owner+ only";
  if (level >= 6.5) return "MoO+ only";
  if (level >= 6) return "GM+ only";
  if (level >= 5) return "AGM+ only";
  if (level >= 4) return "Shift Lead+ only";
  return `Level ${level}+ only`;
};

// Closed set of ChecklistError codes from lib/checklists.ts. The exhaustive
// switch in errorMessageFor() relies on this union — adding a new code in
// Build #2/3/4 surfaces as a compile error on the assertNever line until
// the switch is updated.
type ChecklistErrorCode =
  | "instance_closed"
  | "single_submission_locked"
  | "role_level_insufficient"
  | "missing_count"
  | "missing_photo"
  | "pin_mismatch"
  | "missing_reasons"
  | "extra_reasons"
  | "supersede_failed";

// Maps an API error code to a user-facing message. Switch logic uses the
// stable `code` field (not the human message — those are tuning copy).
const errorMessageFor = (err: ChecklistApiError): string => {
  const code = err.code as ChecklistErrorCode;
  switch (code) {
    case "instance_closed":
      return "This checklist is already confirmed.";
    case "single_submission_locked":
      return "This template is locked after first submission.";
    case "role_level_insufficient":
      return "Your role can't complete this item.";
    case "missing_count":
      return "Enter a count value first.";
    case "missing_photo":
      return "Take a photo first.";
    case "pin_mismatch":
      return "PIN didn't match.";
    case "missing_reasons":
      return "Reasons required for incomplete items.";
    case "extra_reasons":
      return "Reasons supplied for completed items.";
    case "supersede_failed":
      return "Save partially failed — tap to retry.";
    default: {
      // Exhaustiveness guard: adding a new ChecklistErrorCode without
      // updating this switch becomes a compile error here. For runtime
      // codes outside the closed set (component-internal stubs like
      // `photo_not_wired`, or any unknown string from the API),
      // err.code falls through to this branch — we surface err.message
      // so the user still sees something meaningful.
      const _exhaustive: never = code;
      void _exhaustive;
      return err.message || "Save failed — tap to retry.";
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ChecklistItem({
  templateItem,
  completion,
  completionAuthor,
  actorLevel,
  instanceStatus,
  readOnly = false,
  onComplete,
}: ChecklistItemProps) {
  // Local state for optimistic flip / in-flight / error. The "live" view
  // is (localCompletion ?? completion) — local takes precedence during
  // an optimistic flip; reverts to prop on error rollback.
  const [localCompletion, setLocalCompletion] = useState<ChecklistCompletion | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<ChecklistApiError | null>(null);

  // Expand state for count / notes inputs.
  const [expanded, setExpanded] = useState(false);
  const [countDraft, setCountDraft] = useState<string>("");
  const [notesDraft, setNotesDraft] = useState<string>("");

  // Reset local state if parent supplies a fresh completion (e.g., after a
  // successful pessimistic save the parent re-renders us with the new prop).
  // Relies on parent always providing a fresh completion ID after save —
  // lib/checklists.ts (getOrCreateInstance, completeItem, confirmInstance)
  // honors this contract by inserting new rows rather than mutating in
  // place. If a future code path mutates an existing completion's fields
  // without changing its id, this effect won't fire and local optimistic
  // state would not clear — an issue worth re-validating then.
  useEffect(() => {
    setLocalCompletion(null);
    setError(null);
  }, [completion?.id]);

  const liveCompletion = localCompletion ?? completion;
  const isCompleted = liveCompletion !== null;
  const isSelfAuthor = completionAuthor?.isSelf === true;
  const roleGated = actorLevel < templateItem.minRoleLevel;
  const instanceLocked = instanceStatus !== "open";
  const interactable = !roleGated && !instanceLocked && !readOnly && !inFlight;

  // ─── Save flow ────────────────────────────────────────────────────────────

  const performSave = async (payload: ChecklistCompletePayload) => {
    const dataCarrying = isDataCarrying(payload);
    setError(null);

    if (!dataCarrying) {
      // Optimistic — synthesize a tentative completion immediately.
      // completedBy uses a sentinel string ("__optimistic__") since
      // ChecklistCompletion.completedBy is `string` (non-nullable) per
      // lib/types.ts. The value is never read for identity — render
      // logic gets self-vs-other coloring from props.completionAuthor.
      const optimistic: ChecklistCompletion = {
        id: `optimistic-${Date.now()}`,
        instanceId: completion?.instanceId ?? "",
        templateItemId: templateItem.id,
        completedBy: "__optimistic__",
        completedAt: new Date().toISOString(),
        countValue: null,
        photoId: null,
        notes: null,
        supersededAt: null,
        supersededBy: null,
        // Revoke / tag fields per SPEC_AMENDMENTS.md C.28 — always null on a
        // fresh optimistic completion. PR 2 wires the actual revoke/tag UI;
        // here we just satisfy the type contract.
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
        revocationNote: null,
        actualCompleterId: null,
        actualCompleterTaggedAt: null,
        actualCompleterTaggedBy: null,
      };
      setLocalCompletion(optimistic);
    }

    setInFlight(true);
    try {
      const result = await onComplete(payload);
      if ("error" in result) {
        setError(result.error);
        // Rollback the optimistic flip; for pessimistic saves there's
        // nothing to roll back since we never set localCompletion.
        if (!dataCarrying) setLocalCompletion(null);
      } else {
        // Success: clear local optimistic; the parent will pass the real
        // completion via props on its next render. For pessimistic saves
        // the same — parent owns the post-save state.
        setLocalCompletion(null);
        setExpanded(false);
        setCountDraft("");
        setNotesDraft("");
      }
    } catch (caught) {
      // Network / unexpected — synthesize a generic error.
      setError({
        code: "unknown",
        message: caught instanceof Error ? caught.message : "Save failed",
      });
      if (!dataCarrying) setLocalCompletion(null);
    } finally {
      setInFlight(false);
    }
  };

  const handleRowTap = () => {
    if (!interactable) return;

    // Data-carrying items: open the expand panel instead of saving directly.
    if (templateItem.expectsCount || templateItem.expectsPhoto) {
      setExpanded((prev) => !prev);
      // Pre-fill drafts from the existing completion if we're editing.
      if (!expanded && liveCompletion) {
        setCountDraft(
          liveCompletion.countValue !== null ? String(liveCompletion.countValue) : "",
        );
        setNotesDraft(liveCompletion.notes ?? "");
      }
      return;
    }

    // Plain item: save (or re-complete on tap of an already-completed row).
    void performSave({ templateItemId: templateItem.id });
  };

  const handleCountSave = () => {
    const trimmed = countDraft.trim();
    if (templateItem.expectsCount && trimmed === "") {
      setError({
        code: "missing_count",
        message: "Enter a count value first.",
      });
      return;
    }
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && Number.isNaN(parsed)) {
      setError({
        code: "invalid_payload",
        message: "Enter a valid number.",
      });
      return;
    }

    void performSave({
      templateItemId: templateItem.id,
      countValue: parsed,
      notes: notesDraft.trim() === "" ? null : notesDraft.trim(),
    });
  };

  const handleNotesEditSave = () => {
    // Notes-only edit on a completed plain item — reuses supersede flow
    // per SPEC_AMENDMENTS.md C.22. Pessimistic since notes is data.
    void performSave({
      templateItemId: templateItem.id,
      notes: notesDraft.trim() === "" ? null : notesDraft.trim(),
    });
  };

  // ─── ARIA + visual computation ────────────────────────────────────────────

  const ariaLabel = (() => {
    if (roleGated) return `${templateItem.label} — ${roleBadgeText(templateItem.minRoleLevel)}`;
    if (instanceLocked) return `${templateItem.label} — instance ${instanceStatus}`;
    if (inFlight) return `${templateItem.label} — saving`;
    if (error) return `${templateItem.label} — ${errorMessageFor(error)}`;
    if (isCompleted && liveCompletion) {
      const who = isSelfAuthor ? "you" : completionAuthor?.name ?? "another user";
      const when = formatTime(liveCompletion.completedAt);
      return `${templateItem.label} — completed by ${who}${when ? ` at ${when}` : ""}`;
    }
    return `${templateItem.label} — not completed`;
  })();

  const leftIcon = (() => {
    if (roleGated) return <LockIcon />;
    if (inFlight) return <SpinnerIcon />;
    if (error) return <ErrorIcon />;
    if (isCompleted) return <CheckIcon filled selfAuthored={isSelfAuthor} />;
    return <EmptyCircleIcon />;
  })();

  const metaText = (() => {
    if (roleGated) return roleBadgeText(templateItem.minRoleLevel);
    if (inFlight) return "Saving…";
    if (error) return errorMessageFor(error);
    if (isCompleted && liveCompletion) {
      const who = isSelfAuthor ? "you" : completionAuthor?.name ?? "—";
      const when = formatTime(liveCompletion.completedAt);
      const countSuffix =
        liveCompletion.countValue !== null && liveCompletion.countValue !== undefined
          ? `${liveCompletion.countValue}° · `
          : "";
      return `${countSuffix}${who}${when ? ` · ${when}` : ""}`;
    }
    return null;
  })();

  // ─── Row classes ─────────────────────────────────────────────────────────

  const rowClasses = [
    // Base layout
    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
    "min-h-[56px]", // ≥48 tap target with margin
    "border border-co-border bg-co-surface",
    "transition",
    // Interactive states (only when interactable)
    interactable ? "hover:border-co-gold-deep hover:bg-co-surface-2 active:bg-co-surface-2" : "",
    interactable ? "focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60" : "",
    // Disabled-feeling states
    roleGated ? "opacity-60 cursor-not-allowed" : "",
    instanceLocked ? "opacity-70 cursor-not-allowed" : "",
    readOnly ? "opacity-70 cursor-default" : "",
    inFlight ? "ring-2 ring-co-gold-deep cursor-wait" : "",
    error ? "border-co-cta/60" : "",
    // Completed visual treatment
    isCompleted && !error ? "bg-co-surface-2/60" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleRowTap}
        disabled={!interactable && !error}
        aria-label={ariaLabel}
        aria-pressed={isCompleted}
        className={rowClasses}
      >
        {/* Left-edge icon zone — ≥48×48 hit area */}
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center"
        >
          {leftIcon}
        </span>

        {/* Label + optional description */}
        <span className="flex flex-1 flex-col items-start gap-0.5 min-w-0">
          <span
            className={[
              "text-sm font-semibold leading-tight text-co-text",
              isCompleted && !error ? "text-co-text-muted" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {templateItem.label}
          </span>
          {templateItem.description ? (
            <span className="text-[11px] text-co-text-dim line-clamp-2">
              {templateItem.description}
            </span>
          ) : null}
        </span>

        {/* Meta slot */}
        {metaText ? (
          <span
            className={[
              "shrink-0 text-[11px] font-medium tabular-nums",
              error ? "text-co-cta" : "text-co-text-dim",
            ].join(" ")}
          >
            {metaText}
          </span>
        ) : null}
      </button>

      {/* Expand panel for data-carrying items (count + notes) */}
      {expanded && (templateItem.expectsCount || templateItem.expectsPhoto) ? (
        <div
          className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
          role="region"
          aria-label={`${templateItem.label} details`}
        >
          {templateItem.expectsCount ? (
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
                Count
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={countDraft}
                onChange={(e) => setCountDraft(e.target.value)}
                placeholder="e.g. 38"
                className="
                  mt-1 w-full rounded-md border-2 border-co-border bg-white px-3 py-2
                  text-base text-co-text
                  focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40
                "
              />
            </label>
          ) : null}

          {templateItem.expectsPhoto ? (
            <div className="mt-3">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
                Photo
              </span>
              {/* Stub — PhotoUploader wires in Build #4. */}
              <button
                type="button"
                onClick={() =>
                  setError({
                    code: "photo_not_wired",
                    message: "Photo capture coming soon.",
                  })
                }
                className="
                  mt-1 inline-flex min-h-[48px] items-center justify-center rounded-md
                  border-2 border-dashed border-co-border-2 bg-white px-4 text-sm font-semibold text-co-text-dim
                "
              >
                Photo capture coming soon
              </button>
            </div>
          ) : null}

          <label className="mt-3 block">
            <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
              Notes (optional)
            </span>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={2}
              placeholder="Anything noteworthy?"
              className="
                mt-1 w-full rounded-md border-2 border-co-border bg-white px-3 py-2
                text-sm text-co-text
                focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40
              "
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleCountSave}
              disabled={inFlight}
              className="
                inline-flex min-h-[48px] flex-1 items-center justify-center rounded-md
                bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
                transition hover:bg-co-gold-deep
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-wait disabled:opacity-60
              "
            >
              {inFlight ? "Saving…" : isCompleted ? "Update" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              disabled={inFlight}
              className="
                inline-flex min-h-[48px] items-center justify-center rounded-md
                border-2 border-co-border bg-white px-4 text-sm font-semibold text-co-text-muted
                transition hover:border-co-border-2
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/40
                disabled:cursor-wait disabled:opacity-60
              "
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Notes-edit panel for completed plain items (not data-carrying) */}
      {!expanded && isCompleted && !templateItem.expectsCount && !templateItem.expectsPhoto && interactable ? (
        <NotesEditAffordance
          completion={liveCompletion}
          notesDraft={notesDraft}
          setNotesDraft={setNotesDraft}
          inFlight={inFlight}
          onSave={handleNotesEditSave}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function NotesEditAffordance({
  completion,
  notesDraft,
  setNotesDraft,
  inFlight,
  onSave,
}: {
  completion: ChecklistCompletion | null;
  notesDraft: string;
  setNotesDraft: (s: string) => void;
  inFlight: boolean;
  onSave: () => void;
}) {
  const [open, setOpen] = useState(false);
  const existingNote = completion?.notes ?? null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setNotesDraft(existingNote ?? "");
          setOpen(true);
        }}
        className="
          ml-15 mt-1 inline-flex h-8 items-center px-2 text-[11px] text-co-text-dim
          underline-offset-2 hover:text-co-text-muted hover:underline
          focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/40
        "
        aria-label={existingNote ? "Edit note" : "Add note"}
      >
        {existingNote ? "Edit note" : "Add note"}
      </button>
    );
  }

  return (
    <div
      className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
      role="region"
      aria-label="Edit note"
    >
      <textarea
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        rows={2}
        placeholder="Anything noteworthy?"
        className="
          w-full rounded-md border-2 border-co-border bg-white px-3 py-2
          text-sm text-co-text
          focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40
        "
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            onSave();
            setOpen(false);
          }}
          disabled={inFlight}
          className="
            inline-flex min-h-[48px] flex-1 items-center justify-center rounded-md
            bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
            transition hover:bg-co-gold-deep
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            disabled:cursor-wait disabled:opacity-60
          "
        >
          {inFlight ? "Saving…" : "Save note"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={inFlight}
          className="
            inline-flex min-h-[48px] items-center justify-center rounded-md
            border-2 border-co-border bg-white px-4 text-sm font-semibold text-co-text-muted
            transition hover:border-co-border-2
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/40
            disabled:cursor-wait disabled:opacity-60
          "
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons (inline SVG — no external dep)
// ─────────────────────────────────────────────────────────────────────────────

function EmptyCircleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2" className="text-co-border-2" />
    </svg>
  );
}

function CheckIcon({ filled, selfAuthored }: { filled: boolean; selfAuthored: boolean }) {
  if (!filled) return <EmptyCircleIcon />;
  const fillColor = selfAuthored ? "#FFE560" : "var(--co-surface-2)";
  const strokeColor = selfAuthored ? "var(--co-text)" : "var(--co-text-muted)";
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <circle cx="14" cy="14" r="12" fill={fillColor} stroke={strokeColor} strokeWidth="2" />
      <path
        d="M9 14.5l3.5 3.5L19 11"
        stroke={strokeColor}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden className="text-co-text-faint">
      <rect x="7" y="13" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 13v-2a4 4 0 1 1 8 0v2"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden className="animate-spin text-co-gold-deep">
      <circle cx="14" cy="14" r="11" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <path
        d="M25 14a11 11 0 0 0-11-11"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden className="text-co-cta">
      <circle cx="14" cy="14" r="12" stroke="currentColor" strokeWidth="2" />
      <path d="M14 8v7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="14" cy="19" r="1.25" fill="currentColor" />
    </svg>
  );
}
