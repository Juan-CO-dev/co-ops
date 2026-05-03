"use client";

/**
 * ChecklistItem — Module #1 Build #1 step 6, extended Build #1.5 PR 2.
 *
 * Build #1.5 PR 2 adds revoke + accountability tagging affordances per
 * SPEC_AMENDMENTS.md C.28's two-window architecture. Locked design
 * decisions for the UI:
 *
 *   #1 Inline placement (not a toast or modal)
 *   #2 Always labeled "Undo" regardless of elapsed time. Behavior changes
 *      silently based on elapsed: < 60s = silent revoke (optimistic);
 *      >= 60s = expand reveals three chips. Stable label, stable position.
 *   #3 Inline expand for picker UX (matches #1).
 *   #4 Three chips visible at once on post-60s expand.
 *   #5 Revoked rows revert to not-yet-completed visually (forensic record
 *      lives in audit + DB, not UI).
 *   #6+#8 Both attributions visible on tagged rows. Original completer at
 *      standard styling; "credited to [name]" annotation in Mustard-deep
 *      accent below. Subtle, no visual shame on the original tap.
 *   #7 Picker excludes self for wrong_user_credited self-correction.
 *      KH+ peer-correction picker shows all candidates including original
 *      completer.
 *   #9 Notes-edit affordance untouched — separate first-class affordance,
 *      semantically distinct from completion correction (per C.27).
 *   #10 Picker shows name + role badge, alphabetical sort (server provides).
 *   No PIN re-entry for revoke/tag — routine ops, not finalization.
 *
 *   Optimistic vs pessimistic per affordance:
 *     - Silent revoke (within 60s): optimistic, fast revert
 *     - Structured revoke (post-60s with reason): pessimistic
 *     - Tag actual completer: pessimistic (picker scope + hierarchy can fail)
 *
 * Tap-handler resilience: client uses completion.completedAt + 60s as the
 * dispatch heuristic. On server-side `outside_quick_window` from the silent
 * path (clock skew, request latency), gracefully fall through to revealing
 * the three-chip expand. Same UX, no error toast.
 *
 * Layout change vs Build #1: meta moves below the row top-line for completed
 * rows, freeing the right slot for the Undo button. Keeps the row top-line
 * clean: tick + label + Undo. Meta + tagged annotation stack indented under
 * the label. Role-gated rows keep the badge in the right slot (state, not
 * metadata); in-flight / error keep status text on the right (transient).
 *
 * State hierarchy (unchanged from Build #1, plus revoked rendering):
 *
 *   - not-yet-completable-by-role: lock icon, dimmed row, role badge.
 *   - not-yet-completed: open circle, full-color label, no meta. (Also
 *     the visual rendered when `revoked` is true — full revert per #5.)
 *   - completed-by-self: filled Mustard circle, label dimmed, meta below.
 *     If actor === completed_by, the Undo button renders on the right.
 *   - completed-by-other: filled co-surface-2 circle. KH+ actors see a
 *     "Tag actual completer" affordance instead of Undo (Undo is self-only).
 *   - in-flight: spinner, row temporarily non-interactive.
 *   - errored: brand Red accent, error message in meta slot, Retry.
 *
 * API ownership: hybrid — component owns visual lifecycle and
 * optimistic/pessimistic flow; parent owns the actual API calls via the
 * async callback props. Parent injects instanceId + actor via closure.
 */

import { useEffect, useState } from "react";

import type {
  ChecklistCompletion,
  ChecklistRevocationReason,
  ChecklistStatus,
  ChecklistTemplateItem,
} from "@/lib/types";
import type { RoleCode } from "@/lib/roles";

// Mirror of the API error shape produced by app/api/checklist/_helpers.ts
// mapChecklistError(). Parent passes errors through verbatim from the API
// response. The `code` field is the switch discriminator — never the
// human-readable message.
export interface ChecklistApiError {
  code: string;
  message: string;
  newCompletionId?: string;
  priorCompletionId?: string;
  required?: number;
  actual?: number;
  missingTemplateItemIds?: string[];
  extraTemplateItemIds?: string[];
  // Revoke / tag (per SPEC_AMENDMENTS.md C.28)
  completion_id?: string;
  elapsed_ms?: number;
  remaining_ms?: number;
  proposed_actual_completer_id?: string;
  reason?: string;
  current_tagger_level?: number;
  attempted_replacer_level?: number;
  operation?: string;
  field?: string;
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

export type ChecklistRevokeResult =
  | { revoked: true; completion: ChecklistCompletion }
  | { error: ChecklistApiError };

export type ChecklistTagResult =
  | { tagged: true; completion: ChecklistCompletion; replacedPriorTag: boolean }
  | { error: ChecklistApiError };

export interface PickerCandidateView {
  id: string;
  name: string;
  role: RoleCode;
  level: number;
}

export type ChecklistPickerResult =
  | { candidates: PickerCandidateView[] }
  | { error: ChecklistApiError };

interface ChecklistItemProps {
  templateItem: ChecklistTemplateItem;
  /** Live (non-superseded, non-revoked) completion for this item, or null. */
  completion: ChecklistCompletion | null;
  /** Resolved by parent via users join — kept off the component to avoid a fetch per row. */
  completionAuthor?: { name: string; isSelf: boolean } | null;
  /**
   * Resolved by parent. When `completion.actualCompleterId` is non-null,
   * this carries the actual completer's display name for the
   * "credited to [name]" annotation. Null when no tag is set.
   */
  actualCompleterAuthor?: { name: string; isSelf: boolean } | null;
  /** Caller's role level — drives the role-gate visual + interaction state. */
  actorLevel: number;
  /** Caller's user id — drives self-vs-peer logic for revoke and tag affordances. */
  actorUserId: string;
  /** Instance status — disables interaction when not 'open'. */
  instanceStatus: ChecklistStatus;
  /** Read-only override (per Build #1 step 9). */
  readOnly?: boolean;
  /** Async completion callback (existing). */
  onComplete: (payload: ChecklistCompletePayload) => Promise<ChecklistCompleteResult>;
  /**
   * Async silent-revoke callback (within 60s, self-only). Fires
   * POST /api/checklist/completions/[id]/revoke. Component owns the
   * optimistic flip; on success, the row reverts to not-yet-completed.
   * On `outside_quick_window` error, component falls through to the
   * three-chip expand without surfacing a user-facing error.
   */
  onRevoke?: (completionId: string) => Promise<ChecklistRevokeResult>;
  /**
   * Async structured-revoke callback (post-60s, self-only). Fires
   * POST /api/checklist/completions/[id]/revoke-with-reason.
   * Pessimistic — UI commits on server confirmation.
   */
  onRevokeWithReason?: (
    completionId: string,
    payload: { reason: "not_actually_done" | "other"; note?: string | null },
  ) => Promise<ChecklistRevokeResult>;
  /**
   * Async tag-actual-completer callback (post-60s, KH+ OR self). Fires
   * POST /api/checklist/completions/[id]/tag-actual-completer. Pessimistic.
   */
  onTagActualCompleter?: (
    completionId: string,
    actualCompleterId: string,
  ) => Promise<ChecklistTagResult>;
  /**
   * Async picker-candidates loader. Fires
   * GET /api/checklist/completions/[id]/picker-candidates. Component
   * triggers this on demand when wrong_user_credited or KH+ "Tag actual
   * completer" expands; result is cached in local state until the expand
   * closes.
   */
  onLoadPickerCandidates?: (completionId: string) => Promise<ChecklistPickerResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const QUICK_WINDOW_MS = 60_000;

const formatTime = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
};

const isDataCarrying = (payload: ChecklistCompletePayload): boolean =>
  (payload.countValue !== undefined && payload.countValue !== null) ||
  (payload.photoId !== undefined && payload.photoId !== null) ||
  (payload.notes !== undefined && payload.notes !== null);

const roleBadgeText = (level: number): string => {
  if (level >= 8) return "CGS only";
  if (level >= 7) return "Owner+ only";
  if (level >= 6.5) return "MoO+ only";
  if (level >= 6) return "GM+ only";
  if (level >= 5) return "AGM+ only";
  if (level >= 4) return "Shift Lead+ only";
  return `Level ${level}+ only`;
};

const roleBadgeShort = (role: RoleCode): string => {
  switch (role) {
    case "cgs":
      return "CGS";
    case "owner":
      return "Owner";
    case "moo":
      return "MoO";
    case "gm":
      return "GM";
    case "agm":
      return "AGM";
    case "catering_mgr":
      return "Catering Mgr";
    case "shift_lead":
      return "SL";
    case "key_holder":
      return "KH";
    case "trainer":
      return "Trainer";
    // Note: `employee` (level 3) and `trainee` (level 2) role codes land in
    // Build #1.5 PR 6 per SPEC_AMENDMENTS.md C.32. Picker scope filtering
    // (level >= min_role_level) will allow them to surface here once the
    // enum + login tile work lands. The default branch handles any future
    // RoleCode added to lib/roles.ts that isn't yet wired in this switch.
    default:
      return role;
  }
};

// Closed set of ChecklistError codes from lib/checklists.ts.
type ChecklistErrorCode =
  | "instance_closed"
  | "single_submission_locked"
  | "role_level_insufficient"
  | "missing_count"
  | "missing_photo"
  | "pin_mismatch"
  | "missing_reasons"
  | "extra_reasons"
  | "supersede_failed"
  // Build #1.5 PR 1 additions (per SPEC_AMENDMENTS.md C.28)
  | "outside_quick_window"
  | "not_self"
  | "tag_within_quick_window"
  | "invalid_picker_candidate"
  | "tag_hierarchy_violation"
  | "revocation_note_required"
  | "concurrent_modification"
  | "use_quick_revoke"
  | "completion_not_found";

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
    case "outside_quick_window":
      // Should never surface — handled by tap-dispatch fallthrough.
      return "Pick a reason for the undo.";
    case "not_self":
      return "You can only undo your own taps.";
    case "tag_within_quick_window":
      return "Wait a moment, then try again.";
    case "invalid_picker_candidate":
      return "That person can't be tagged here.";
    case "tag_hierarchy_violation":
      return "Can't override a more senior tag.";
    case "revocation_note_required":
      return "Add a note first.";
    case "concurrent_modification":
      return "Just modified by someone else — try again.";
    case "use_quick_revoke":
      // Handled by tap-dispatch fallthrough; never surfaces.
      return "Use Undo instead.";
    case "completion_not_found":
      return "This item was just modified — refresh.";
    default: {
      const _exhaustive: never = code;
      void _exhaustive;
      return err.message || "Save failed — tap to retry.";
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type ExpandMode = "none" | "three_chip" | "picker_self_credit" | "picker_kh_tag" | "note_other";

export function ChecklistItem({
  templateItem,
  completion,
  completionAuthor,
  actualCompleterAuthor,
  actorLevel,
  actorUserId,
  instanceStatus,
  readOnly = false,
  onComplete,
  onRevoke,
  onRevokeWithReason,
  onTagActualCompleter,
  onLoadPickerCandidates,
}: ChecklistItemProps) {
  // Local state for optimistic flip / in-flight / error.
  const [localCompletion, setLocalCompletion] = useState<ChecklistCompletion | null>(null);
  // Optimistic-revoke flag: when true, render as not-yet-completed even if
  // `completion` prop still carries the row. Set on successful silent revoke;
  // reset by the useEffect when parent provides a fresh completion (typically
  // null after revoke). On error, restored to false to roll back.
  const [revoked, setRevoked] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<ChecklistApiError | null>(null);

  // Expand state for count / notes inputs (existing).
  const [expanded, setExpanded] = useState(false);
  const [countDraft, setCountDraft] = useState<string>("");
  const [notesDraft, setNotesDraft] = useState<string>("");

  // Revoke / tag expand state.
  const [expandMode, setExpandMode] = useState<ExpandMode>("none");
  const [otherNoteDraft, setOtherNoteDraft] = useState<string>("");
  const [pickerCandidates, setPickerCandidates] = useState<PickerCandidateView[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Reset local state when parent supplies a fresh completion (id change).
  useEffect(() => {
    setLocalCompletion(null);
    setRevoked(false);
    setError(null);
    setExpandMode("none");
    setOtherNoteDraft("");
    setPickerCandidates(null);
  }, [completion?.id]);

  const propCompletion = completion;
  const liveCompletion = revoked ? null : (localCompletion ?? propCompletion);
  const isCompleted = liveCompletion !== null;
  const isSelfAuthor = completionAuthor?.isSelf === true;
  const isActorCompletedBy = liveCompletion?.completedBy === actorUserId;
  const isTagged = liveCompletion?.actualCompleterId != null;
  const roleGated = actorLevel < templateItem.minRoleLevel;
  const instanceLocked = instanceStatus !== "open";
  const interactable = !roleGated && !instanceLocked && !readOnly && !inFlight;

  // Affordance visibility:
  //   - Undo: visible when row is completed by self AND interactable AND
  //     onRevoke/onRevokeWithReason callbacks wired.
  //   - Tag actual completer: visible to KH+ (level >= 4) on completed rows
  //     authored by anyone other than self, AND interactable AND
  //     onTagActualCompleter callback wired. (Self uses the wrong_user_credited
  //     chip from the post-60s Undo expand, not this affordance.)
  const showUndo =
    isCompleted &&
    isActorCompletedBy &&
    interactable &&
    !!onRevoke &&
    !!onRevokeWithReason;
  const showTagAffordance =
    isCompleted &&
    !isActorCompletedBy &&
    actorLevel >= 4 &&
    interactable &&
    !!onTagActualCompleter &&
    !!onLoadPickerCandidates;

  // ─── Save flow (existing completion path, unchanged) ──────────────────────

  const performSave = async (payload: ChecklistCompletePayload) => {
    const dataCarrying = isDataCarrying(payload);
    setError(null);

    if (!dataCarrying) {
      const optimistic: ChecklistCompletion = {
        id: `optimistic-${Date.now()}`,
        instanceId: completion?.instanceId ?? "",
        templateItemId: templateItem.id,
        completedBy: actorUserId,
        completedAt: new Date().toISOString(),
        countValue: null,
        photoId: null,
        notes: null,
        supersededAt: null,
        supersededBy: null,
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
        if (!dataCarrying) setLocalCompletion(null);
      } else {
        setLocalCompletion(null);
        setExpanded(false);
        setCountDraft("");
        setNotesDraft("");
      }
    } catch (caught) {
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

    if (templateItem.expectsCount || templateItem.expectsPhoto) {
      setExpanded((prev) => !prev);
      if (!expanded && liveCompletion) {
        setCountDraft(
          liveCompletion.countValue !== null ? String(liveCompletion.countValue) : "",
        );
        setNotesDraft(liveCompletion.notes ?? "");
      }
      return;
    }

    void performSave({ templateItemId: templateItem.id });
  };

  const handleCountSave = () => {
    const trimmed = countDraft.trim();
    if (templateItem.expectsCount && trimmed === "") {
      setError({ code: "missing_count", message: "Enter a count value first." });
      return;
    }
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && Number.isNaN(parsed)) {
      setError({ code: "invalid_payload", message: "Enter a valid number." });
      return;
    }
    void performSave({
      templateItemId: templateItem.id,
      countValue: parsed,
      notes: notesDraft.trim() === "" ? null : notesDraft.trim(),
    });
  };

  const handleNotesEditSave = () => {
    void performSave({
      templateItemId: templateItem.id,
      notes: notesDraft.trim() === "" ? null : notesDraft.trim(),
    });
  };

  // ─── Undo / revoke / tag flow (Build #1.5 PR 2) ───────────────────────────

  /**
   * Heuristic: client uses live completion's completedAt + 60s as initial
   * dispatch. On `outside_quick_window` from server (clock skew, latency),
   * gracefully fall through to revealing the three-chip expand.
   */
  const handleUndoClick = async () => {
    if (!liveCompletion || !onRevoke) return;
    setError(null);

    const elapsedMs = Date.now() - new Date(liveCompletion.completedAt).getTime();

    if (elapsedMs < QUICK_WINDOW_MS) {
      // Silent path — optimistic revert.
      setRevoked(true);
      setInFlight(true);
      try {
        const result = await onRevoke(liveCompletion.id);
        if ("error" in result) {
          if (result.error.code === "outside_quick_window") {
            // Server says window already closed — fall through silently.
            setRevoked(false);
            setExpandMode("three_chip");
          } else {
            setRevoked(false);
            setError(result.error);
          }
        }
        // On success: leave revoked=true; useEffect will reset when parent
        // re-renders with completion.id changing (or completion=null).
      } catch (caught) {
        setRevoked(false);
        setError({
          code: "unknown",
          message: caught instanceof Error ? caught.message : "Undo failed",
        });
      } finally {
        setInFlight(false);
      }
      return;
    }

    // Past window — reveal the three-chip expand.
    setExpandMode("three_chip");
  };

  const handleChipSelect = async (chip: "wrong_user_credited" | "not_actually_done" | "other") => {
    if (!liveCompletion) return;
    setError(null);

    if (chip === "wrong_user_credited") {
      // Self wrong_user_credited: open the picker (server-side scope, then
      // client-side self-exclusion per design lock #7).
      setExpandMode("picker_self_credit");
      await loadPickerOnce();
      return;
    }

    if (chip === "not_actually_done") {
      if (!onRevokeWithReason) return;
      setInFlight(true);
      try {
        const result = await onRevokeWithReason(liveCompletion.id, {
          reason: "not_actually_done",
        });
        if ("error" in result) {
          setError(result.error);
        } else {
          setRevoked(true);
          setExpandMode("none");
        }
      } catch (caught) {
        setError({
          code: "unknown",
          message: caught instanceof Error ? caught.message : "Revoke failed",
        });
      } finally {
        setInFlight(false);
      }
      return;
    }

    if (chip === "other") {
      // Reveal note textarea; submit happens via handleOtherNoteSubmit.
      setExpandMode("note_other");
      setOtherNoteDraft("");
    }
  };

  const handleOtherNoteSubmit = async () => {
    if (!liveCompletion || !onRevokeWithReason) return;
    const note = otherNoteDraft.trim();
    if (note.length === 0) {
      setError({
        code: "revocation_note_required",
        message: "Add a note first.",
        completion_id: liveCompletion.id,
      });
      return;
    }
    setError(null);
    setInFlight(true);
    try {
      const result = await onRevokeWithReason(liveCompletion.id, {
        reason: "other",
        note,
      });
      if ("error" in result) {
        setError(result.error);
      } else {
        setRevoked(true);
        setExpandMode("none");
        setOtherNoteDraft("");
      }
    } catch (caught) {
      setError({
        code: "unknown",
        message: caught instanceof Error ? caught.message : "Revoke failed",
      });
    } finally {
      setInFlight(false);
    }
  };

  const handleTagAffordanceClick = async () => {
    if (!liveCompletion) return;
    setError(null);
    setExpandMode("picker_kh_tag");
    await loadPickerOnce();
  };

  const loadPickerOnce = async () => {
    if (!liveCompletion || !onLoadPickerCandidates) return;
    if (pickerCandidates !== null) return; // cached for this expand session
    setPickerLoading(true);
    try {
      const result = await onLoadPickerCandidates(liveCompletion.id);
      if ("error" in result) {
        setError(result.error);
        setPickerCandidates([]);
      } else {
        setPickerCandidates(result.candidates);
      }
    } catch (caught) {
      setError({
        code: "unknown",
        message: caught instanceof Error ? caught.message : "Picker load failed",
      });
      setPickerCandidates([]);
    } finally {
      setPickerLoading(false);
    }
  };

  const handlePickerSelect = async (actualCompleterId: string) => {
    if (!liveCompletion || !onTagActualCompleter) return;
    setError(null);
    setInFlight(true);
    try {
      const result = await onTagActualCompleter(liveCompletion.id, actualCompleterId);
      if ("error" in result) {
        setError(result.error);
      } else {
        // Pessimistic — parent will pass new completion via props with
        // actualCompleterId set; useEffect resets local state on id change.
        // For tag, the completion id stays the same (UPDATE, not insert),
        // so we manually update localCompletion to reflect the tag immediately.
        setLocalCompletion(result.completion);
        setExpandMode("none");
        setPickerCandidates(null);
      }
    } catch (caught) {
      setError({
        code: "unknown",
        message: caught instanceof Error ? caught.message : "Tag failed",
      });
    } finally {
      setInFlight(false);
    }
  };

  const handleExpandCancel = () => {
    setExpandMode("none");
    setOtherNoteDraft("");
    setPickerCandidates(null);
    setError(null);
  };

  // Self-exclusion for the wrong_user_credited self-correction picker per
  // design lock #7. KH+ peer-correction picker shows all candidates.
  const visiblePickerCandidates =
    pickerCandidates === null
      ? null
      : expandMode === "picker_self_credit"
        ? pickerCandidates.filter((c) => c.id !== actorUserId)
        : pickerCandidates;

  // ─── ARIA + visual computation ────────────────────────────────────────────

  const ariaLabel = (() => {
    if (roleGated) return `${templateItem.label} — ${roleBadgeText(templateItem.minRoleLevel)}`;
    if (instanceLocked) return `${templateItem.label} — instance ${instanceStatus}`;
    if (inFlight) return `${templateItem.label} — saving`;
    if (error) return `${templateItem.label} — ${errorMessageFor(error)}`;
    if (isCompleted && liveCompletion) {
      const who = isSelfAuthor ? "you" : completionAuthor?.name ?? "another user";
      const when = formatTime(liveCompletion.completedAt);
      const taggedSuffix =
        isTagged && actualCompleterAuthor
          ? `, credited to ${actualCompleterAuthor.isSelf ? "you" : actualCompleterAuthor.name}`
          : "";
      return `${templateItem.label} — completed by ${who}${when ? ` at ${when}` : ""}${taggedSuffix}`;
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

  // Right-slot text (only for state, not metadata).
  const rightSlotText = (() => {
    if (roleGated) return roleBadgeText(templateItem.minRoleLevel);
    if (inFlight) return "Saving…";
    if (error) return errorMessageFor(error);
    return null;
  })();

  // Below-row meta stack (for completed rows without transient state).
  const showMetaStack = isCompleted && !inFlight && !error && !roleGated;
  const metaPrimaryText = (() => {
    if (!showMetaStack || !liveCompletion) return null;
    const who = isSelfAuthor ? "you" : completionAuthor?.name ?? "—";
    const when = formatTime(liveCompletion.completedAt);
    const countSuffix =
      liveCompletion.countValue !== null && liveCompletion.countValue !== undefined
        ? `${liveCompletion.countValue}° · `
        : "";
    return `${countSuffix}${who}${when ? ` · ${when}` : ""}`;
  })();
  const taggedAnnotationText = (() => {
    if (!showMetaStack || !isTagged || !actualCompleterAuthor) return null;
    const who = actualCompleterAuthor.isSelf ? "you" : actualCompleterAuthor.name;
    return `→ credited to ${who}`;
  })();
  // Inline notes display (per SPEC_AMENDMENTS.md C.29). Renders editorial
  // commentary stored on the live completion when present. Italicized + muted
  // — italics signal "editorial, not data"; the multi-tier visibility model
  // (public vs managerial per C.27) is still deferred and will distinguish
  // tiers via color/weight when it lands. Renders LAST in the meta stack so
  // structural info (tag annotation) reads before editorial commentary.
  const noteText = (() => {
    if (!showMetaStack || !liveCompletion) return null;
    const trimmed = liveCompletion.notes?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  })();

  // ─── Row classes ─────────────────────────────────────────────────────────

  const rowClasses = [
    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left",
    "min-h-[56px]",
    "border border-co-border bg-co-surface",
    "transition",
    interactable ? "hover:border-co-gold-deep hover:bg-co-surface-2 active:bg-co-surface-2" : "",
    interactable ? "focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60" : "",
    roleGated ? "opacity-60 cursor-not-allowed" : "",
    instanceLocked ? "opacity-70 cursor-not-allowed" : "",
    readOnly ? "opacity-70 cursor-default" : "",
    inFlight ? "ring-2 ring-co-gold-deep cursor-wait" : "",
    error ? "border-co-cta/60" : "",
    isCompleted && !error ? "bg-co-surface-2/60" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="w-full">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={handleRowTap}
          disabled={!interactable && !error}
          aria-label={ariaLabel}
          aria-pressed={isCompleted}
          className={`flex-1 ${rowClasses}`}
        >
          <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center">
            {leftIcon}
          </span>

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

          {rightSlotText ? (
            <span
              className={[
                "shrink-0 text-[11px] font-medium tabular-nums",
                error ? "text-co-cta" : "text-co-text-dim",
              ].join(" ")}
            >
              {rightSlotText}
            </span>
          ) : null}
        </button>

        {/* Right-side action affordances (Undo / Tag) — sibling of row button. */}
        {showUndo ? (
          <UndoButton onClick={handleUndoClick} disabled={inFlight || expandMode !== "none"} />
        ) : showTagAffordance ? (
          <TagAffordanceButton
            onClick={handleTagAffordanceClick}
            disabled={inFlight || expandMode !== "none"}
          />
        ) : null}
      </div>

      {/* Below-row meta stack — completer/time + credited-to annotation + inline notes (C.29).
          tabular-nums is scoped to metaPrimaryText only (the timestamp line) instead of the
          wrapper, since tag annotation and notes carry no numerals that benefit from tabular
          alignment — applying it broadly would force monospace-digit width on text that
          shouldn't have it. */}
      {(metaPrimaryText || taggedAnnotationText || noteText) ? (
        <div className="ml-15 mt-1 flex flex-col gap-0.5 text-[11px] leading-tight">
          {metaPrimaryText ? (
            <span className="tabular-nums text-co-text-dim">{metaPrimaryText}</span>
          ) : null}
          {taggedAnnotationText ? (
            <span className="font-semibold text-co-gold-deep">{taggedAnnotationText}</span>
          ) : null}
          {noteText ? (
            <span className="italic text-co-text-muted">{noteText}</span>
          ) : null}
        </div>
      ) : null}

      {/* Expand panel for data-carrying items (count + notes) — unchanged. */}
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

      {/* Three-chip expand — post-60s Undo path. */}
      {expandMode === "three_chip" ? (
        <ThreeChipExpand
          onChip={handleChipSelect}
          onCancel={handleExpandCancel}
          disabled={inFlight}
        />
      ) : null}

      {/* "Other" reason — note textarea. */}
      {expandMode === "note_other" ? (
        <OtherNotePanel
          note={otherNoteDraft}
          setNote={setOtherNoteDraft}
          onSubmit={handleOtherNoteSubmit}
          onCancel={handleExpandCancel}
          disabled={inFlight}
        />
      ) : null}

      {/* Picker (used by both wrong_user_credited self-correction and KH+ tag). */}
      {expandMode === "picker_self_credit" || expandMode === "picker_kh_tag" ? (
        <PickerExpand
          loading={pickerLoading}
          candidates={visiblePickerCandidates ?? []}
          mode={expandMode}
          onSelect={handlePickerSelect}
          onCancel={handleExpandCancel}
          disabled={inFlight}
        />
      ) : null}

      {/* Notes-edit affordance (existing) — unchanged per design lock #9. */}
      {expandMode === "none" &&
      !expanded &&
      isCompleted &&
      !templateItem.expectsCount &&
      !templateItem.expectsPhoto &&
      interactable ? (
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
// Sub-components — Build #1 (existing) + Build #1.5 PR 2 additions
// ─────────────────────────────────────────────────────────────────────────────

function UndoButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Undo this completion"
      className="
        shrink-0 inline-flex min-h-[48px] min-w-[64px] items-center justify-center rounded-lg
        border-2 border-co-border bg-co-surface px-3
        text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted
        transition hover:border-co-cta/60 hover:text-co-cta active:bg-co-surface-2
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50
      "
    >
      Undo
    </button>
  );
}

function TagAffordanceButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  // Label is always "Tag" regardless of whether a prior tag exists. User
  // intent ("I want to attribute this work") is the constant; whether the
  // system has a prior tag is implementation detail. Mirrors the Undo
  // button's stable-label rule (per design lock #2).
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Tag actual completer"
      className="
        shrink-0 inline-flex min-h-[48px] min-w-[64px] items-center justify-center rounded-lg
        border-2 border-co-border bg-co-surface px-3
        text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted
        transition hover:border-co-gold-deep hover:text-co-text active:bg-co-surface-2
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50
      "
    >
      Tag
    </button>
  );
}

function ThreeChipExpand({
  onChip,
  onCancel,
  disabled,
}: {
  onChip: (chip: "wrong_user_credited" | "not_actually_done" | "other") => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
      role="region"
      aria-label="Choose undo reason"
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
        What happened?
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <Chip onClick={() => onChip("wrong_user_credited")} disabled={disabled}>
          Wrong person credited
        </Chip>
        <Chip onClick={() => onChip("not_actually_done")} disabled={disabled}>
          Not actually done
        </Chip>
        <Chip onClick={() => onChip("other")} disabled={disabled}>
          Other (note required)
        </Chip>
      </div>
      <div className="mt-2 flex">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="
            inline-flex min-h-[40px] items-center px-3 text-[11px] font-semibold text-co-text-dim
            underline-offset-2 hover:text-co-text-muted hover:underline
            focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/40
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Chip({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="
        inline-flex min-h-[48px] items-center justify-start rounded-lg
        border-2 border-co-border bg-white px-4 text-left
        text-sm font-semibold text-co-text
        transition hover:border-co-gold-deep hover:bg-co-surface
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50
      "
    >
      {children}
    </button>
  );
}

function OtherNotePanel({
  note,
  setNote,
  onSubmit,
  onCancel,
  disabled,
}: {
  note: string;
  setNote: (s: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
      role="region"
      aria-label="Add note for undo"
    >
      <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
          Note (required)
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Briefly explain"
          className="
            mt-1 w-full rounded-md border-2 border-co-border bg-white px-3 py-2
            text-sm text-co-text
            focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40
          "
          autoFocus
        />
      </label>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || note.trim().length === 0}
          className="
            inline-flex min-h-[48px] flex-1 items-center justify-center rounded-md
            bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
            transition hover:bg-co-gold-deep
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          {disabled ? "Saving…" : "Submit undo"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="
            inline-flex min-h-[48px] items-center justify-center rounded-md
            border-2 border-co-border bg-white px-4 text-sm font-semibold text-co-text-muted
            transition hover:border-co-border-2
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/40
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PickerExpand({
  loading,
  candidates,
  mode,
  onSelect,
  onCancel,
  disabled,
}: {
  loading: boolean;
  candidates: PickerCandidateView[];
  mode: "picker_self_credit" | "picker_kh_tag";
  onSelect: (id: string) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const headingText =
    mode === "picker_self_credit" ? "Who actually did this?" : "Tag actual completer";
  const emptyText =
    mode === "picker_self_credit"
      ? "No other candidates available right now."
      : "No candidates available right now.";

  return (
    <div
      className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
      role="region"
      aria-label={headingText}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
        {headingText}
      </div>
      {loading ? (
        <div className="mt-2 text-sm text-co-text-dim">Loading…</div>
      ) : candidates.length === 0 ? (
        <div className="mt-2 text-sm text-co-text-dim">{emptyText}</div>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {candidates.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                disabled={disabled}
                className="
                  flex w-full min-h-[48px] items-center justify-between gap-3 rounded-lg
                  border-2 border-co-border bg-white px-4 text-left
                  transition hover:border-co-gold-deep hover:bg-co-surface
                  focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                  disabled:cursor-not-allowed disabled:opacity-50
                "
              >
                <span className="text-sm font-semibold text-co-text">{c.name}</span>
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
                  {roleBadgeShort(c.role)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="
            inline-flex min-h-[40px] items-center px-3 text-[11px] font-semibold text-co-text-dim
            underline-offset-2 hover:text-co-text-muted hover:underline
            focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/40
            disabled:cursor-not-allowed disabled:opacity-50
          "
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

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

// ─── Icons (inline SVG — unchanged from Build #1) ──────────────────────────

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

// Marker prop reference to silence react/no-unused-prop-types if linting later.
// ChecklistRevocationReason is imported transitively through ChecklistCompletion;
// keeping the type re-export wired for downstream consumers.
export type { ChecklistRevocationReason };
