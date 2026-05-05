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

import { resolveTemplateItemContent } from "@/lib/i18n/content";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
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

// formatTime imported from @/lib/i18n/format; canonical helper (Build
// #2 PR 2) consolidates 6 prior inline copies. Bonus side effect: this
// site previously used `toLocaleTimeString(undefined, ...)` (browser
// locale + browser TZ — both correct only by accident in DC); the
// canonical helper takes language explicitly + pins to operational TZ
// regardless of where the operator's browser is.

const isDataCarrying = (payload: ChecklistCompletePayload): boolean =>
  (payload.countValue !== undefined && payload.countValue !== null) ||
  (payload.photoId !== undefined && payload.photoId !== null) ||
  (payload.notes !== undefined && payload.notes !== null);

// Translation-aware role-badge helpers. Take t as a parameter so they stay
// pure functions at module scope (testable, no hook dependency); callers
// pass the t function from useTranslation().
type TFn = (key: TranslationKey, params?: Record<string, string | number>) => string;

const roleBadgeText = (t: TFn, level: number): string => {
  if (level >= 8) return t("closing.role_badge.cgs_only");
  if (level >= 7) return t("closing.role_badge.owner_plus_only");
  if (level >= 6.5) return t("closing.role_badge.moo_plus_only");
  if (level >= 6) return t("closing.role_badge.gm_plus_only");
  if (level >= 5) return t("closing.role_badge.agm_plus_only");
  if (level >= 4) return t("closing.role_badge.shift_lead_plus_only");
  return t("closing.role_badge.level_plus_only", { level });
};

const roleBadgeShort = (t: TFn, role: RoleCode): string => {
  switch (role) {
    case "cgs":
      return t("closing.role_short.cgs");
    case "owner":
      return t("closing.role_short.owner");
    case "moo":
      return t("closing.role_short.moo");
    case "gm":
      return t("closing.role_short.gm");
    case "agm":
      return t("closing.role_short.agm");
    case "catering_mgr":
      return t("closing.role_short.catering_mgr");
    case "shift_lead":
      return t("closing.role_short.shift_lead");
    case "key_holder":
      return t("closing.role_short.key_holder");
    case "trainer":
      return t("closing.role_short.trainer");
    // Note: `employee` (level 3) and `trainee` (level 2) role codes land in
    // Build #1.5 PR 6 per SPEC_AMENDMENTS.md C.32. Default returns the raw
    // role code for any future RoleCode value not yet wired in this switch.
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

const errorMessageFor = (t: TFn, err: ChecklistApiError): string => {
  const code = err.code as ChecklistErrorCode;
  switch (code) {
    case "instance_closed":
      return t("closing.error.instance_closed");
    case "single_submission_locked":
      return t("closing.error.single_submission_locked");
    case "role_level_insufficient":
      return t("closing.error.role_level_insufficient");
    case "missing_count":
      return t("closing.error.missing_count");
    case "missing_photo":
      return t("closing.error.missing_photo");
    case "pin_mismatch":
      return t("closing.error.pin_mismatch");
    case "missing_reasons":
      return t("closing.error.missing_reasons");
    case "extra_reasons":
      return t("closing.error.extra_reasons");
    case "supersede_failed":
      return t("closing.error.supersede_failed");
    case "outside_quick_window":
      // Should never surface — handled by tap-dispatch fallthrough.
      return t("closing.error.outside_quick_window");
    case "not_self":
      return t("closing.error.not_self");
    case "tag_within_quick_window":
      return t("closing.error.tag_within_quick_window");
    case "invalid_picker_candidate":
      return t("closing.error.invalid_picker_candidate");
    case "tag_hierarchy_violation":
      return t("closing.error.tag_hierarchy_violation");
    case "revocation_note_required":
      return t("closing.error.revocation_note_required");
    case "concurrent_modification":
      return t("closing.error.concurrent_modification");
    case "use_quick_revoke":
      return t("closing.error.use_quick_revoke");
    case "completion_not_found":
      return t("closing.error.completion_not_found");
    default: {
      const _exhaustive: never = code;
      void _exhaustive;
      return err.message || t("closing.error.fallback");
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
  const { t, language } = useTranslation();
  // Resolve translated display content ONCE per render (per SPEC_AMENDMENTS.md
  // C.38 system-key vs display-string discipline). Used for the row's visible
  // label, description, and ARIA attributes. The original templateItem.label
  // / description / station remain available for any system-key matching
  // (none in this component today; future grouping/lookup logic must use
  // the original fields, not `resolved`).
  const resolved = resolveTemplateItemContent(templateItem, language);
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
  //   - Tag actual completer: visible to KH+ (level >= 3, per C.41
  //     reconciliation) on completed rows authored by anyone other than
  //     self, AND interactable AND onTagActualCompleter callback wired.
  //     (Self uses the wrong_user_credited chip from the post-60s Undo
  //     expand, not this affordance.)
  const showUndo =
    isCompleted &&
    isActorCompletedBy &&
    interactable &&
    !!onRevoke &&
    !!onRevokeWithReason;
  const showTagAffordance =
    isCompleted &&
    !isActorCompletedBy &&
    actorLevel >= 3 &&
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
        prepData: null,
        autoCompleteMeta: null,
        // C.46 — optimistic cleaning-tap completion is never part of an
        // edit chain (chains are AM Prep-specific); chain-head defaults.
        originalCompletionId: null,
        editCount: 0,
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
        message: caught instanceof Error ? caught.message : t("closing.error.fallback"),
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
      setError({ code: "missing_count", message: t("closing.error.missing_count") });
      return;
    }
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && Number.isNaN(parsed)) {
      setError({ code: "invalid_payload", message: t("closing.error.invalid_number") });
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
          message: caught instanceof Error ? caught.message : t("closing.error.fallback"),
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
          message: caught instanceof Error ? caught.message : t("closing.error.fallback"),
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
        message: t("closing.error.revocation_note_required"),
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
        message: caught instanceof Error ? caught.message : t("closing.error.fallback"),
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
        message: caught instanceof Error ? caught.message : t("closing.error.fallback"),
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
        message: caught instanceof Error ? caught.message : t("closing.error.fallback"),
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
    // ARIA labels are display-only; use resolved.label for user-facing text.
    if (roleGated)
      return t("closing.row.aria_role_gated", {
        label: resolved.label,
        role_text: roleBadgeText(t, templateItem.minRoleLevel),
      });
    if (instanceLocked)
      return t("closing.row.aria_locked", { label: resolved.label, status: instanceStatus });
    if (inFlight) return t("closing.row.aria_saving", { label: resolved.label });
    if (error)
      return t("closing.row.aria_error", { label: resolved.label, error: errorMessageFor(t, error) });
    if (isCompleted && liveCompletion) {
      const who = isSelfAuthor ? t("common.you") : completionAuthor?.name ?? "—";
      const when = formatTime(liveCompletion.completedAt, language);
      const credited =
        isTagged && actualCompleterAuthor
          ? t("closing.row.aria_credited_to", {
              name: actualCompleterAuthor.isSelf ? t("common.you") : actualCompleterAuthor.name,
            })
          : "";
      return t("closing.row.aria_completed_by", {
        label: resolved.label,
        who,
        when: when ? t("closing.row.aria_at_time", { time: when }) : "",
        credited,
      });
    }
    return t("closing.row.aria_not_completed", { label: resolved.label });
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
    if (roleGated) return roleBadgeText(t, templateItem.minRoleLevel);
    if (inFlight) return t("common.saving");
    if (error) return errorMessageFor(t, error);
    return null;
  })();

  // Below-row meta stack (for completed rows without transient state).
  const showMetaStack = isCompleted && !inFlight && !error && !roleGated;
  const metaPrimaryText = (() => {
    if (!showMetaStack || !liveCompletion) return null;
    const who = isSelfAuthor ? t("common.you") : completionAuthor?.name ?? "—";
    const when = formatTime(liveCompletion.completedAt, language);
    const countSuffix =
      liveCompletion.countValue !== null && liveCompletion.countValue !== undefined
        ? `${liveCompletion.countValue}° · `
        : "";
    return `${countSuffix}${who}${when ? ` · ${when}` : ""}`;
  })();
  const taggedAnnotationText = (() => {
    if (!showMetaStack || !isTagged || !actualCompleterAuthor) return null;
    const who = actualCompleterAuthor.isSelf ? t("common.you") : actualCompleterAuthor.name;
    return t("closing.row.credited_to", { name: who });
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
              {resolved.label}
            </span>
            {resolved.description ? (
              <span className="text-[11px] text-co-text-dim line-clamp-2">
                {resolved.description}
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
          aria-label={t("closing.expand.aria_details", { label: resolved.label })}
        >
          {templateItem.expectsCount ? (
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
                {t("closing.expand.count_label")}
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={countDraft}
                onChange={(e) => setCountDraft(e.target.value)}
                placeholder={t("closing.expand.count_placeholder")}
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
                {t("closing.expand.photo_label")}
              </span>
              <button
                type="button"
                onClick={() =>
                  setError({
                    code: "photo_not_wired",
                    message: t("closing.error.photo_not_wired"),
                  })
                }
                className="
                  mt-1 inline-flex min-h-[48px] items-center justify-center rounded-md
                  border-2 border-dashed border-co-border-2 bg-white px-4 text-sm font-semibold text-co-text-dim
                "
              >
                {t("closing.expand.photo_stub")}
              </button>
            </div>
          ) : null}

          <label className="mt-3 block">
            <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
              {t("closing.expand.notes_label")}
            </span>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={2}
              placeholder={t("closing.expand.notes_placeholder")}
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
              {inFlight ? t("common.saving") : isCompleted ? t("closing.expand.update") : t("closing.expand.save")}
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
              {t("common.cancel")}
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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={t("closing.row.aria_undo")}
      className="
        shrink-0 inline-flex min-h-[48px] min-w-[64px] items-center justify-center rounded-lg
        border-2 border-co-border bg-co-surface px-3
        text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted
        transition hover:border-co-cta/60 hover:text-co-cta active:bg-co-surface-2
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50
      "
    >
      {t("closing.row.undo")}
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
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={t("closing.row.aria_tag")}
      className="
        shrink-0 inline-flex min-h-[48px] min-w-[64px] items-center justify-center rounded-lg
        border-2 border-co-border bg-co-surface px-3
        text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-muted
        transition hover:border-co-gold-deep hover:text-co-text active:bg-co-surface-2
        focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        disabled:cursor-not-allowed disabled:opacity-50
      "
    >
      {t("closing.row.tag")}
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
  const { t } = useTranslation();
  return (
    <div
      className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
      role="region"
      aria-label={t("closing.three_chip.heading")}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
        {t("closing.three_chip.heading")}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <Chip onClick={() => onChip("wrong_user_credited")} disabled={disabled}>
          {t("closing.three_chip.wrong_user_credited")}
        </Chip>
        <Chip onClick={() => onChip("not_actually_done")} disabled={disabled}>
          {t("closing.three_chip.not_actually_done")}
        </Chip>
        <Chip onClick={() => onChip("other")} disabled={disabled}>
          {t("closing.three_chip.other")}
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
          {t("common.cancel")}
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
  const { t } = useTranslation();
  return (
    <div
      className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
      role="region"
      aria-label={t("closing.note_other.aria_label")}
    >
      <label className="block">
        <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
          {t("closing.note_other.label")}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={t("closing.note_other.placeholder")}
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
          {disabled ? t("common.saving") : t("closing.note_other.submit")}
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
          {t("common.cancel")}
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
  const { t } = useTranslation();
  const headingText =
    mode === "picker_self_credit"
      ? t("closing.picker.self_credit_heading")
      : t("closing.picker.kh_tag_heading");
  const emptyText =
    mode === "picker_self_credit"
      ? t("closing.picker.empty_self_credit")
      : t("closing.picker.empty_kh_tag");

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
        <div className="mt-2 text-sm text-co-text-dim">{t("common.loading")}</div>
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
                  {roleBadgeShort(t, c.role)}
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
          {t("common.cancel")}
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
  const { t } = useTranslation();
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
        aria-label={existingNote ? t("closing.notes_edit.edit") : t("closing.notes_edit.add")}
      >
        {existingNote ? t("closing.notes_edit.edit") : t("closing.notes_edit.add")}
      </button>
    );
  }

  return (
    <div
      className="mt-1 rounded-lg border border-co-border-2 bg-co-surface-2 p-3"
      role="region"
      aria-label={t("closing.notes_edit.aria_label")}
    >
      <textarea
        value={notesDraft}
        onChange={(e) => setNotesDraft(e.target.value)}
        rows={2}
        placeholder={t("closing.notes_edit.placeholder")}
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
          {inFlight ? t("common.saving") : t("closing.notes_edit.save_button")}
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
          {t("common.cancel")}
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
