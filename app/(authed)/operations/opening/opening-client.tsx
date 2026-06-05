"use client";

/**
 * Opening Phase 1 + Phase 2 form orchestrator — Build #3 PR 2 + PR 3.
 *
 * Top-level client component owning two form-state Maps:
 *   - `values` — Phase 1 verification (existing PR 2 shape; per-station
 *     tick + temp + photo + notes)
 *   - `phase2Values` — Phase 2 prep entry (Step 6 — three-values per item +
 *     over/under-par captures)
 *
 * Phase navigation per locked Q1: hard gate. Phase 2 tab disabled until
 * Phase 1 complete (allTicked && allTempsFilled). Backward navigation
 * always allowed once Phase 2 unlocked.
 *
 * Submit is per-phase. Phase 1 POSTs to /api/opening/submit/phase1. Phase 2
 * uses the SPLIT two-route flow: per-item prep writes persist on blur via
 * /api/opening/prep/item, then finalize POSTs only { instanceId } to
 * /api/opening/submit/phase2 (no entries).
 *
 * Form state independence (Q-B refinement): per-station tick changes
 * ONLY the `ticked` field across items in that station. countValue,
 * photoId, notes are independent fields — never touched by tick toggles.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language, TranslationKey, TranslationParams } from "@/lib/i18n/types";
import type { OpeningCloserCountSnapshotRow } from "@/lib/opening";
import type {
  ChecklistCompletion,
  ChecklistInstance,
  ChecklistTemplateItem,
  OpeningNoPriorDataReason,
  OpeningPhase2Meta,
} from "@/lib/types";

import { OpeningVerificationStation } from "@/components/opening/OpeningVerificationStation";
import type { OpeningItemFormValue } from "@/components/opening/OpeningChecklistItem";
import {
  OpeningPrepEntry,
  type OpeningPhase2FormValue,
  type Phase2IncompleteReason,
  type Phase2RevokeOutcome,
  type Phase2RevokeReason,
  type Phase2SaveState,
} from "@/components/opening/OpeningPrepEntry";
import {
  isOverParReasonCategory,
  type ManagerOption,
  type OverParCapture,
} from "@/components/opening/OverParModal";
import {
  isUnderParReasonCategory,
  type UnderParCapture,
} from "@/components/opening/UnderParModal";

interface OpeningClientProps {
  instance: ChecklistInstance;
  templateItems: ChecklistTemplateItem[];
  /**
   * Closer-count snapshots from the persisted opening_closer_count_snapshots
   * table (loaded by page.tsx via loadOpeningCloserCountSnapshots, post-C.50).
   * Frozen at instance create time per C.44 snapshot universe locking.
   *
   * Wire shape: Record (plain object) for Server-Component → Client boundary
   * serialization (Maps don't survive JSON serialization). Converted to Map
   * internally via useMemo for OpeningPrepEntry consumption.
   */
  closerSnapshots: Record<string, OpeningCloserCountSnapshotRow>;
  /**
   * Fix #7 — distinct verified section_keys read back from
   * opening_section_verifications (loadOpeningSectionVerifications). Seeds the
   * sectionVerifications Map from SERVER TRUTH (opener A's persisted verify
   * rows) rather than deriving all-true from verificationLocked. A plain
   * string[] (not a Map) because section-verify is set-membership and an array
   * survives the RSC→client JSON boundary directly.
   */
  verifiedSections: ReadonlyArray<string>;
  /**
   * Live (non-superseded, non-revoked) completions for this instance, loaded by
   * loadOpeningState. Under dual-membership an openingPhase2 item carries TWO
   * live rows once Phase 2 saves exist — a phase1 row (prep_data ? 'phase1')
   * and a phase2 row (prep_data ? 'phase2'). The phase2Values seed filters to
   * the phase2 rows ONLY (see readPhase2SaveState); the phase1 `values` seed
   * reads no completions, so it can never pick up a phase2 row.
   */
  completions: ReadonlyArray<ChecklistCompletion>;
  /** AGM+ at this location for over-par directedBy dropdown. */
  managers: ReadonlyArray<ManagerOption>;
  /**
   * Map<users.id, display name> for per-row save attribution. Merges
   * loadOpeningState's persisted-saver authors with the current actor (so a
   * fresh-session save resolves a name immediately, before any re-load).
   */
  saverNames: Record<string, string>;
  language: Language;
}

interface SubmitState {
  status: "idle" | "submitting" | "error";
  errorCode?: string;
  errorMessage?: string;
  // Interpolation params for the error banner's i18n lookup (e.g. {count} for
  // opening.error.phase2_incomplete). Undefined for codes without placeholders.
  errorParams?: TranslationParams;
}

/**
 * Shape of a persisted Phase 2 save, as written by save_phase2_item_atomic
 * (migration 0056) into completions.prep_data->'phase2'. snake_case mirrors the
 * RPC's jsonb_build_object exactly. NOT modeled by lib/types.ts PrepData (which
 * only covers the AM-Prep inputs/snapshot shape), so it's defined locally for
 * the hydration seed. Review Gate #1: this is the persisted-row → form-value
 * contract Triad A scrutinizes before Lane B.
 *
 * Forward-bind (Triad A, Review Gate #1): promote this to lib/types.ts as a
 * PrepData union arm ({ inputs, snapshot } | { phase2 }) when the verify-then-
 * prep primitive is designed — NOT now. Widening PrepData mid-build forces every
 * existing consumer to handle the new arm; local is correct for Lane A, the
 * promotion belongs to the primitive-design pass.
 */
interface OpeningPhase2SaveState {
  phase: 2;
  closer_count: number | null;
  spot_check_status: string | null;
  opener_recount: number | null;
  ground_truth_count: number | null;
  prep_need: number | null;
  opener_prepped: number | null;
  delta_vs_prep_need: number | null;
  over_under_status: "at_par" | "over_prep" | "under_prep";
  over_under_reason_category: string | null;
  over_under_reason_text: string | null;
  directed_by: string | null;
  saved_at: string;
  saved_by: string;
}

/**
 * Explicit prep_data ? 'phase2' filter. Under dual-membership an openingPhase2
 * item carries a phase1 row AND a phase2 row once saves exist; this guard
 * returns non-null ONLY for the phase2 row, so the phase2Values seed can never
 * incidentally hydrate from a phase1 completion.
 */
function readPhase2SaveState(prepData: unknown): OpeningPhase2SaveState | null {
  if (prepData == null || typeof prepData !== "object") return null;
  if (!("phase2" in prepData)) return null;
  const p2 = (prepData as { phase2: unknown }).phase2;
  if (p2 == null || typeof p2 !== "object") return null;
  return p2 as OpeningPhase2SaveState;
}

/**
 * True when a completion is the Phase 2 (prep-beat) row of a dual-membership
 * item — i.e. its prep_data carries a 'phase2' sub-object. The Phase 1 `values`
 * seed (Finding D hydration) uses this to EXCLUDE phase2 rows: a spot-check
 * openingPhase2 item carries both a phase1 row and a phase2 row once prep saves
 * exist, and only the phase1 row's persisted temp/notes/recount may seed the
 * verification form.
 */
function isPhase2Row(prepData: unknown): boolean {
  return (
    prepData != null && typeof prepData === "object" && "phase2" in prepData
  );
}

/**
 * Read the persisted opener_recount out of a completion's prep_data->'phase1'
 * sub-object (the 8-key spot-check contract written by submit_opening_atomic,
 * migration 0053). Returns null when the completion carries no phase1 sub-object
 * — non-spot-check items store prep_data = null and never have a recount. Mirrors
 * readPhase2SaveState's untyped-boundary discipline: prep_data->phase1 is NOT
 * modeled by lib/types.ts PrepData, so it's read defensively here.
 */
function readPhase1OpenerRecount(prepData: unknown): number | null {
  if (prepData == null || typeof prepData !== "object") return null;
  if (!("phase1" in prepData)) return null;
  const p1 = (prepData as { phase1: unknown }).phase1;
  if (p1 == null || typeof p1 !== "object") return null;
  const recount = (p1 as { opener_recount?: unknown }).opener_recount;
  return typeof recount === "number" ? recount : null;
}

/**
 * C.53 Commit B residual fix — read the PERSISTED Phase 1 ground-truth out of a
 * completion's prep_data->'phase1' sub-object (the 8-key spot-check contract).
 * Returns the `ground_truth_count` + `prep_need` the Phase 1 RPC computed and
 * persisted at submit (migration 0055). Phase 2's delta MUST be computed from
 * THESE values, not re-derived client-side: the Phase 2 RPC reads prep_need
 * straight from this sub-object and never recomputes (0056 lines 168-169), so
 * sourcing the client delta from the same persisted numbers makes client and
 * server agree BY CONSTRUCTION across all three cases (captured+verify,
 * recount-on-captured+verify, NULL-source-recount+verify). Returns null when the
 * completion carries no phase1 sub-object (non-spot-check item, or pre-submit).
 * Same untyped-boundary discipline as readPhase1OpenerRecount: prep_data->phase1
 * is not modeled by lib/types.ts PrepData, so each field is read defensively.
 */
function readPhase1Resolved(
  prepData: unknown,
): { groundTruth: number | null; prepNeed: number | null } | null {
  if (prepData == null || typeof prepData !== "object") return null;
  if (!("phase1" in prepData)) return null;
  const p1 = (prepData as { phase1: unknown }).phase1;
  if (p1 == null || typeof p1 !== "object") return null;
  const gt = (p1 as { ground_truth_count?: unknown }).ground_truth_count;
  const pn = (p1 as { prep_need?: unknown }).prep_need;
  return {
    groundTruth: typeof gt === "number" ? gt : null,
    prepNeed: typeof pn === "number" ? pn : null,
  };
}

/**
 * Map a persisted phase2 save onto the controlled form value. The numeric beats
 * (openerRecount, openerPrepped) always hydrate. The over/under capture is
 * reconstructed from over_under_status, but the persisted reason category is an
 * UNTYPED text column — so it's validated at the boundary against the canonical
 * vocabulary (isOver/UnderParReasonCategory, derived from the modals' REASON_
 * OPTIONS). An unrecognized category does NOT get blind-cast in: the capture is
 * left null (forcing the operator to re-pick, since the numeric that triggered
 * over/under still hydrates) and a console.warn makes the bad value observable
 * rather than silently swallowed. (Review Gate #1 required fix.)
 */
function saveStateToFormValue(
  s: OpeningPhase2SaveState,
  itemId: string,
): OpeningPhase2FormValue {
  let overPar: OverParCapture | null = null;
  if (s.over_under_status === "over_prep") {
    const cat = s.over_under_reason_category;
    if (cat != null && isOverParReasonCategory(cat)) {
      overPar = {
        reasonCategory: cat,
        directedBy: s.directed_by,
        freeText: s.over_under_reason_text,
      };
    } else {
      console.warn(
        `[opening] Phase 2 hydration: invalid over-par reasonCategory ${JSON.stringify(
          cat,
        )} on item ${itemId} (saved_at=${s.saved_at}); leaving capture unset for re-pick.`,
      );
    }
  }

  let underPar: UnderParCapture | null = null;
  if (s.over_under_status === "under_prep") {
    const cat = s.over_under_reason_category;
    if (cat != null && isUnderParReasonCategory(cat)) {
      underPar = {
        reasonCategory: cat,
        freeText: s.over_under_reason_text ?? "",
      };
    } else {
      console.warn(
        `[opening] Phase 2 hydration: invalid under-par reasonCategory ${JSON.stringify(
          cat,
        )} on item ${itemId} (saved_at=${s.saved_at}); leaving capture unset for re-pick.`,
      );
    }
  }

  return {
    openerRecount: s.opener_recount,
    openerPrepped: s.opener_prepped,
    overPar,
    underPar,
  };
}

/**
 * Serialize the persistable beats of a Phase 2 form value into a stable string
 * for value-diff dedup. Mirrors the /api/opening/prep/item route body shape
 * exactly: openerPrepped + the over/under captures, in the same field order the
 * route validates. openerRecount is intentionally EXCLUDED — recount is a
 * Phase 1 (verify-beat) concern, not in the route body, and a recount change
 * alone must not trigger a Phase 2 save. Used both to seed savedSignature from a
 * hydrated save and to compute the current signature at dispatch time, so the
 * two are computed by the identical code path and can be compared safely.
 */
function phase2Signature(v: OpeningPhase2FormValue): string {
  return JSON.stringify({
    openerPrepped: v.openerPrepped,
    overPar: v.overPar
      ? {
          reasonCategory: v.overPar.reasonCategory,
          directedBy: v.overPar.directedBy,
          freeText: v.overPar.freeText,
        }
      : null,
    underPar: v.underPar
      ? {
          reasonCategory: v.underPar.reasonCategory,
          freeText: v.underPar.freeText,
        }
      : null,
  });
}

export function OpeningClient({
  instance,
  templateItems,
  closerSnapshots,
  verifiedSections,
  completions,
  managers,
  saverNames,
  language,
}: OpeningClientProps) {
  const { t } = useTranslation();
  const router = useRouter();

  // ── Server-truth gates (C.53 Commit B — server-state-is-truth) ─────────────
  // instance.status is authoritative for phase + verification state; these are
  // NEVER derived from local form state. 'open' is the SOLE pre-Phase-1 status
  // (migration 0054), so any non-'open' status means Phase 1 has landed
  // server-side. Three gates fall out of it, hoisted here so the useState
  // initializers below (sectionVerifications seed) can read them:
  //   - phase1AlreadySubmitted: the Phase 1 submit is spent (double-submit
  //     guard — router.refresh() re-renders this client in place with the new
  //     status prop but does NOT reset its useState, so the guard must be
  //     status-derived, not a spinner reset).
  //   - verificationLocked: the Phase 1 verify beat is once-per-instance. A
  //     second opener whose form is empty must see it DONE and CANNOT
  //     re-tick/re-verify (Finding A).
  //   - phase2AlreadyFinalized: Phase 2 finalize is spent (status past
  //     phase1_complete) — the finalize button must show "already finalized"
  //     and MUST NOT fire a doomed /api/opening/submit/phase2 (Finding C).
  const phase1AlreadySubmitted = instance.status !== "open";
  const verificationLocked = phase1AlreadySubmitted;
  const phase2AlreadyFinalized =
    instance.status !== "open" && instance.status !== "phase1_complete";

  // Convert closerSnapshots Record (RSC boundary) to a Map for per-item lookups.
  // Memoized to a stable reference; updates only when the prop changes (Server
  // Component re-render). Relocated above the phase split (C.53 §10) because the
  // split predicate now reads it — see below.
  const closerSnapshotsMap = useMemo(
    () => new Map(Object.entries(closerSnapshots)),
    [closerSnapshots],
  );

  // Fix #7 — verified section_keys as a Set for O(1) membership in the
  // sectionVerifications seed (path (a): section-verify row exists).
  const verifiedSectionsSet = useMemo(
    () => new Set(verifiedSections),
    [verifiedSections],
  );

  // Split templateItems by phase — dual-membership, NOT mutually exclusive.
  // Every shift is verify-then-prep: an openingPhase2 item is VERIFIED in Phase 1
  // (verify beat — establishes ground truth) AND PREPPED in Phase 2 (prep beat —
  // opening prep against par). Same item, two beats, two coexisting completions.
  //
  // - phase2Items (prep beat): EVERY openingPhase2 item.
  // - phase1Items (verify beat): spot-check items (in the closer-count-snapshot
  //   universe) + all non-openingPhase2 items. closerSnapshotsMap.has(it.id) is
  //   the same discriminator handlePhase1Submit uses to serialize spot-check
  //   fields. In practice every openingPhase2 item is snapshot-bearing, so
  //   phase1Items is identical to the pre-fix set — this revives the prep beat
  //   without altering Phase 1 behavior.
  const { phase1Items, phase2Items } = useMemo(() => {
    const p1: ChecklistTemplateItem[] = [];
    const p2: ChecklistTemplateItem[] = [];
    for (const it of templateItems) {
      const meta = it.prepMeta as OpeningPhase2Meta | null;
      const isOpeningPhase2 = meta?.openingPhase2 === true;
      const isSpotCheck = closerSnapshotsMap.has(it.id);
      if (isOpeningPhase2) p2.push(it);
      if (isSpotCheck || !isOpeningPhase2) p1.push(it);
    }
    return { phase1Items: p1, phase2Items: p2 };
  }, [templateItems, closerSnapshotsMap]);

  // Phase 1 form state — hydrated from persisted phase1 completions so a SECOND
  // opener on a verification-locked instance SEES opener A's recorded values
  // (Finding D). The fridge temp reading lives in the top-level countValue
  // column; the spot-check recount lives in prep_data->phase1.opener_recount;
  // discrepancy notes/photo live in their top-level columns. None of these can
  // be derived from verificationLocked the way `ticked` can — they MUST be read
  // back from the completion, or the second opener faces an empty field and is
  // forced to re-enter a value that's already once-per-instance committed.
  //
  // On an 'open' instance (first opener, pre-submit) there are no phase1
  // completions, so the seed yields a blank form — unchanged from prior
  // behavior. The phase2 row of a dual-membership item is excluded via
  // isPhase2Row so it can never seed this verification map.
  const [values, setValues] = useState<Map<string, OpeningItemFormValue>>(() => {
    const phase1ByItem = new Map<string, ChecklistCompletion>();
    for (const c of completions) {
      if (isPhase2Row(c.prepData)) continue;
      phase1ByItem.set(c.templateItemId, c);
    }
    const map = new Map<string, OpeningItemFormValue>();
    for (const item of phase1Items) {
      const c = phase1ByItem.get(item.id);
      map.set(
        item.id,
        c
          ? {
              countValue: c.countValue,
              photoId: c.photoId,
              notes: c.notes,
              ticked: true,
              openerRecount: readPhase1OpenerRecount(c.prepData),
            }
          : { countValue: null, photoId: null, notes: null, ticked: false, openerRecount: null },
      );
    }
    return map;
  });

  // Phase 2 form state — C.50 redesign: openerRecount replaces openerActual.
  // Hydrated from persisted phase2 completions so a returning prepper sees their
  // prior saves (Lane A). The seed filters completions to phase2 rows ONLY via
  // readPhase2SaveState (explicit prep_data ? 'phase2' guard) — under dual-
  // membership the same item also carries a phase1 row, which must never seed
  // this map. Items with no phase2 save start blank.
  const [phase2Values, setPhase2Values] = useState<Map<string, OpeningPhase2FormValue>>(() => {
    const savedByItem = new Map<string, OpeningPhase2SaveState>();
    for (const c of completions) {
      const save = readPhase2SaveState(c.prepData);
      if (save) savedByItem.set(c.templateItemId, save);
    }
    const map = new Map<string, OpeningPhase2FormValue>();
    for (const item of phase2Items) {
      const saved = savedByItem.get(item.id);
      map.set(
        item.id,
        saved
          ? saveStateToFormValue(saved, item.id)
          : { openerRecount: null, openerPrepped: null, overPar: null, underPar: null },
      );
    }
    return map;
  });

  // Phase 2 template-item lookup — the dispatcher needs the item's section +
  // snapshot to replicate the row's savability gate before POSTing.
  const phase2ItemById = useMemo(() => {
    const map = new Map<string, ChecklistTemplateItem>();
    for (const item of phase2Items) map.set(item.id, item);
    return map;
  }, [phase2Items]);

  // C.53 Commit B residual fix — persisted Phase 1 ground-truth keyed by
  // templateItemId. Built from completions carrying a prep_data->'phase1' sub-
  // object (written by the Phase 1 RPC at submit; present on the verification
  // completion row, and on completions a second opener loads post-submit). Both
  // the Phase 2 render (OpeningPrepEntry → PrepEntryRow) AND the save dispatcher
  // (handlePhase2ItemSave) source ground_truth/prep_need from THIS map so the
  // client delta matches the server delta by construction. A phase2 row is
  // skipped here — it carries no phase1 sub-object — but the SAME item's phase1
  // row supplies the entry, so dual-membership items resolve correctly.
  const phase1ResolvedByItem = useMemo(() => {
    const map = new Map<
      string,
      { groundTruth: number | null; prepNeed: number | null }
    >();
    for (const c of completions) {
      const resolved = readPhase1Resolved(c.prepData);
      if (resolved) map.set(c.templateItemId, resolved);
    }
    return map;
  }, [completions]);

  // SINGLE SOURCE OF TRUTH for per-row save state (Juan's pre-commit proof).
  // This ONE Map drives BOTH the per-row badges (passed to OpeningPrepEntry as
  // `saveStates`) AND the finalize outstanding-count (savedPhase2Count /
  // outstandingCount below) — the badge and the finalize gate read the same Map
  // so they can never disagree. Seeded from the SAME phase2 completions the
  // phase2Values hydration uses (readPhase2SaveState), so a returning prepper's
  // already-persisted items render "saved" and don't inflate the outstanding
  // count. Items with no persisted phase2 save start "unsaved".
  const [saveStates, setSaveStates] = useState<Map<string, Phase2SaveState>>(() => {
    const savedByItem = new Map<string, OpeningPhase2SaveState>();
    // completions.id of each live phase2 row, keyed by templateItemId — the
    // revoke POST target a returning prepper needs to revert an already-saved row.
    const idByItem = new Map<string, string>();
    for (const c of completions) {
      const save = readPhase2SaveState(c.prepData);
      if (save) {
        savedByItem.set(c.templateItemId, save);
        idByItem.set(c.templateItemId, c.id);
      }
    }
    const map = new Map<string, Phase2SaveState>();
    for (const item of phase2Items) {
      const saved = savedByItem.get(item.id);
      if (saved) {
        map.set(item.id, {
          status: "saved",
          savedById: saved.saved_by,
          savedAt: saved.saved_at,
          errorCode: null,
          incompleteReason: null,
          savedSignature: phase2Signature(saveStateToFormValue(saved, item.id)),
          completionId: idByItem.get(item.id) ?? null,
        });
      } else {
        map.set(item.id, {
          status: "unsaved",
          savedById: null,
          savedAt: null,
          errorCode: null,
          incompleteReason: null,
          savedSignature: null,
          completionId: null,
        });
      }
    }
    return map;
  });

  // Section verifications — Map<sectionKey, verified-state>. Per C.50 §4: opener
  // taps Verify Section to mark all items in section as "ground_truth =
  // closer_count"; per-item recount is the override path.
  //
  // Fix #7 — seed from SERVER TRUTH, not from derivation. The prior seed set
  // every section to `verificationLocked` (all-true once Phase 1 landed), which
  // read correct for a second opener only by coincidence — it was a derived
  // value, not the persisted verify state. A section is verified-for-display via
  // TWO independent resolution paths, both of which mean "resolved":
  //   (a) section-verify  — opener tapped Verify Section → a row exists in
  //       opening_section_verifications (verifiedSectionsSet, the new loader).
  //   (b) per-item recount — every NULL-source item in the section was resolved
  //       by its own Phase-1 recount (no section-verify row is written on this
  //       path). Read off the now-hydrated Phase-1 `values` map.
  // Seeding NAIVELY from path (a) alone (row exists ⇒ verified, else not) would
  // WRONGLY mark a recount-resolved section unverified, which would then strip
  // a CAPTURED item sharing that section of its closer_count ground-truth path
  // (see handlePhase2ItemSave) — trading the derived bug for a re-gating one.
  // Honoring both paths avoids that.
  const [sectionVerifications, setSectionVerifications] = useState<
    Map<string, boolean>
  >(() => {
    // Group spot-check phase1 items by section. Phase 2 carries these items too
    // under dual-membership, but section-verify state belongs to the verify
    // beat, so iterate phase1Items.
    const bySection = new Map<string, ChecklistTemplateItem[]>();
    for (const item of phase1Items) {
      if (!closerSnapshotsMap.has(item.id)) continue;
      const meta = item.prepMeta as OpeningPhase2Meta | null;
      if (!meta?.section) continue;
      const list = bySection.get(meta.section) ?? [];
      list.push(item);
      bySection.set(meta.section, list);
    }

    const map = new Map<string, boolean>();
    for (const [section, items] of bySection) {
      // Path (a): a persisted section-verify row exists.
      const hasVerifyRow = verifiedSectionsSet.has(section);

      // Path (b): every NULL-source item in the section was recount-resolved.
      // NULL-source = snapshot exists with closer_count IS NULL (tri-state:
      // closerCount === null). The `length > 0` guard is load-bearing: a
      // CAPTURED-ONLY section (no NULL-source items) must NOT read as
      // recount-resolved via `[].every()` (vacuous-true) — such sections can be
      // verified ONLY via path (a), since they have no recount to infer from.
      //
      // C.53 Commit B Decision A — unreachable by verify-required gate, retained
      // as defense. Under verify-required, Phase 1 cannot submit without a
      // section-verify row, so any post-submit section that resolved also has a
      // persisted verify row (path a) — path (b) never contributes a `true` that
      // path (a) wouldn't. Pre-submit, recounts aren't yet persisted into
      // `values` (they live in prep_data.phase1, hydrated only post-submit), so
      // this `every()` is false at seed. The branch is kept as a defensive seed
      // in case the gate ever re-admits a recount-only resolution path.
      const nullSourceItems = items.filter(
        (it) => closerSnapshotsMap.get(it.id)?.closerCount === null,
      );
      const allNullSourceResolved =
        nullSourceItems.length > 0 &&
        nullSourceItems.every(
          (it) => (values.get(it.id)?.openerRecount ?? null) !== null,
        );

      map.set(section, hasVerifyRow || allNullSourceResolved);
    }
    return map;
  });

  const handleSectionVerifyToggle = (sectionKey: string) => {
    // Finding A — the verify beat is once-per-instance. Once Phase 1 has landed
    // (verificationLocked), section-verify is read-only: a second opener cannot
    // toggle it. Server truth, not local form state, owns this state.
    if (verificationLocked) return;
    setSectionVerifications((prev) => {
      const updated = new Map(prev);
      updated.set(sectionKey, !(prev.get(sectionKey) ?? false));
      return updated;
    });
  };

  // Active phase. Initialised from SERVER TRUTH (instance.status), not local
  // form state: if Phase 1 already landed server-side ('open' is the sole
  // pre-submit status per migration 0054), EVERY user — including a second
  // opener whose form is empty — lands on Phase 2 rather than being forced to
  // re-verify. A still-'open' instance starts at "verification" as before.
  // (Scope: this handles "instance already phase1_complete → everyone to Phase
  // 2." The concurrent-mid-Phase-1 case — two users both on an 'open' instance
  // — is deliberately deferred.)
  const [activePhase, setActivePhase] = useState<"verification" | "prep">(
    instance.status === "open" ? "verification" : "prep",
  );

  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [showMissingCountErrors, setShowMissingCountErrors] = useState(false);
  const [showMissingPhase2Errors, setShowMissingPhase2Errors] = useState(false);

  // C.54 §2.C — opener attestation when any Phase 1 spot-check item has
  // NULL-source provenance (closer_count IS NULL AND opener entered recount).
  // Captured via the inline attestation prompt below; threaded to the
  // /api/opening/submit/phase1 body's `openerNoPriorDataAttestation` field.
  // Per Triad A 2026-05-26 ack #3: inline pre-submit surface (not a modal),
  // using Aggie's shipped `opening.phase1.attestation.*` strings.
  //
  // Finding D (persisted-value hydration) — seed from the per-instance persisted
  // attestation (checklist_instances.opener_no_prior_data_reason, C.54 §4) rather
  // than null. The attestation is a persisted VALUE, not a derivable boolean: once
  // the Finding D `values` hydration populates openerRecount for a second opener,
  // needsAttestation flips true and the prompt re-renders on the verification tab —
  // it must show opener A's recorded reason (read-only via verificationLocked
  // below), NOT an empty required prompt the second opener can't satisfy. On a
  // fresh 'open' instance the column is null, so the first opener still starts
  // unselected.
  const [attestationReason, setAttestationReason] =
    useState<OpeningNoPriorDataReason | null>(instance.openerNoPriorDataReason);

  // Group Phase 1 items by station — same pattern as closing-client.tsx.
  const stationGroups = useMemo(() => {
    const groups = new Map<string, ChecklistTemplateItem[]>();
    for (const it of phase1Items) {
      const key = it.station ?? "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    return groups;
  }, [phase1Items]);

  // C.53 §10 — partition Phase 1 items. Spot-check items (in the closer-count-
  // snapshot universe) are resolved via section-verify/recount, NOT the tick
  // affordance; the rest are cleanliness/temp tick rows. Splitting here lets the
  // tick gate scope to tickItems (below) and the spot-check gate scope to
  // spotCheckItems (spotCheckResolved, below) without cross-contamination.
  const { tickItems, spotCheckItems } = useMemo(() => {
    const ticks: ChecklistTemplateItem[] = [];
    const spots: ChecklistTemplateItem[] = [];
    for (const it of phase1Items) {
      if (closerSnapshotsMap.has(it.id)) spots.push(it);
      else ticks.push(it);
    }
    return { tickItems: ticks, spotCheckItems: spots };
  }, [phase1Items, closerSnapshotsMap]);

  // Phase 1 tick counters — scoped to tickItems so spot-check rows (which are
  // never "ticked"; they resolve via recount/section-verify) don't inflate the
  // denominator and strand the "all ticked" gate.
  const totalTickItems = tickItems.length;
  const tickedCount = useMemo(() => {
    let n = 0;
    for (const item of tickItems) {
      if (values.get(item.id)?.ticked) n += 1;
    }
    return n;
  }, [tickItems, values]);

  const totalTempItems = useMemo(
    () => phase1Items.filter((it) => it.expectsCount).length,
    [phase1Items],
  );
  const filledTempCount = useMemo(() => {
    let n = 0;
    for (const item of phase1Items) {
      if (!item.expectsCount) continue;
      const v = values.get(item.id);
      if (v?.countValue !== null && v?.countValue !== undefined) n += 1;
    }
    return n;
  }, [phase1Items, values]);

  // Phase 2 finalize counters — derived from the SINGLE save-state Map, NOT from
  // client form-validity. savedPhase2Count counts items whose server-persisted
  // save state is "saved"; outstandingCount is the gap to the full item set. The
  // finalize gate reads outstandingCount === 0, so finalize unlocks only once
  // every prep item is persisted server-side (per locked Sub-decision (c)).
  const totalPhase2Items = phase2Items.length;
  const savedPhase2Count = useMemo(() => {
    let n = 0;
    for (const s of saveStates.values()) {
      if (s.status === "saved") n += 1;
    }
    return n;
  }, [saveStates]);
  const outstandingCount = totalPhase2Items - savedPhase2Count;

  const allTicked = tickedCount === totalTickItems;
  const allTempsFilled = filledTempCount === totalTempItems;

  // C.54 §2.B/§2.C — count of Phase 1 spot-check items where the source
  // closer_count is NULL AND the opener has entered a recount. Drives the
  // inline attestation prompt below: when count > 0, the opener MUST select
  // a reason (planned_closure | missed_or_unknown) before Phase 1 can submit.
  //
  // The iteration scope is `phase1Items` — the items that POST to /phase1.
  // Under C.53 §10 the spot-check items now live in this set (absorbed by the
  // phase split above), so this attestation logic is live for them.
  const nullSourceItemCount = useMemo(() => {
    let count = 0;
    for (const item of phase1Items) {
      const snapshot = closerSnapshotsMap.get(item.id);
      if (!snapshot) continue; // non-spot-check item
      if (snapshot.closerCount !== null) continue; // captured closer count
      const v = values.get(item.id);
      if (v?.openerRecount !== null && v?.openerRecount !== undefined) {
        count += 1;
      }
    }
    return count;
  }, [phase1Items, values, closerSnapshotsMap]);

  const needsAttestation = nullSourceItemCount > 0;

  // C.53 §10 + Commit B Decision A — Phase 1 spot-check resolution gate.
  // Decision A: section-verify is REQUIRED to submit Phase 1. The prior gate
  // accepted EITHER a verified section OR a per-item recount; the recount
  // disjunct is dropped, so every spot-check section must be section-verified.
  // NULL-source items still require a per-item recount FIRST — that recount is
  // what un-disables the section's verify button (sectionHasUnrecountedNull in
  // OpeningVerificationStation mirrors the RPC's null_source_requires_recount) —
  // but the recount alone no longer resolves the gate; the section must then be
  // verified. Lane B HAS landed: OpeningVerificationStation renders
  // OpeningSectionVerify for spot-check stations, so section-verify is reachable
  // on the Phase 1 tab (the old "until Lane B lands" note was stale).
  //
  // Defensive assertion (non-crashing, Triad A confirmed): a spot-check item
  // whose prep_meta.section is null has no section key to verify against, so
  // under verify-required it would wedge submit forever. Rather than crash or
  // silently wedge, we console.error the offending ids and surface a distinct
  // template_misconfigured block reason (the footer hint maps it to a
  // "contact a manager" message). Seed reality has no null-section spot-check
  // items; this guards a future template-authoring mistake.
  const { spotCheckResolved, spotCheckBlockReason } = useMemo<{
    spotCheckResolved: boolean;
    spotCheckBlockReason: "template_misconfigured" | "verify_sections" | null;
  }>(() => {
    const nullSectionItemIds: string[] = [];
    let allVerified = true;
    for (const item of spotCheckItems) {
      const meta = item.prepMeta as OpeningPhase2Meta | null;
      const section = meta?.section ?? null;
      if (section === null) {
        nullSectionItemIds.push(item.id);
        allVerified = false;
        continue;
      }
      if (!(sectionVerifications.get(section) ?? false)) allVerified = false;
    }
    if (nullSectionItemIds.length > 0) {
      console.error(
        `[opening] Template misconfiguration: spot-check item(s) with a null ` +
          `prep_meta.section cannot be section-verified and would wedge Phase 1 ` +
          `submit under verify-required. Item ids: ${nullSectionItemIds.join(", ")}`,
      );
      return {
        spotCheckResolved: false,
        spotCheckBlockReason: "template_misconfigured",
      };
    }
    return {
      spotCheckResolved: allVerified,
      spotCheckBlockReason: allVerified ? null : "verify_sections",
    };
  }, [spotCheckItems, sectionVerifications]);

  const phase1Complete = allTicked && allTempsFilled && spotCheckResolved;

  // Phase-aware submit gates per Triad A 2026-05-26 (3c form-split).
  //   - Phase 1 submit: gate on phase1Complete + attestation (if needed).
  //   - Phase 2 finalize: gate on server-persisted save state — finalize unlocks
  //     only when outstandingCount === 0 (every prep item persisted). This reads
  //     the SINGLE save-state Map, NOT client form-validity, so the gate can't
  //     disagree with the per-row badges (locked Sub-decision (c)).
  // The sticky-footer submit button binds to whichever gate matches activePhase.
  // (phase1AlreadySubmitted / verificationLocked / phase2AlreadyFinalized are
  // hoisted to the top of the component as the server-truth gates.)
  //
  // Phase 2 availability is SERVER TRUTH, never local form-validity. Once Phase
  // 1 has landed (status moved off 'open'), the prep tab is open to everyone —
  // a second opener with an empty form must NOT be re-gated behind
  // phase1Complete (their browser never ticked Phase 1, but the instance is
  // past it). phase1Complete stays bound to the Phase 1 *submit* gate below,
  // where this browser's form-validity is exactly what matters.
  const phase2Available = phase1AlreadySubmitted;
  const phase1SubmitEnabled =
    phase1Complete &&
    (!needsAttestation || attestationReason !== null) &&
    submitState.status !== "submitting" &&
    !phase1AlreadySubmitted;
  // Finding C — finalize is valid ONLY from server status phase1_complete. On
  // an already-finalized instance (phase2_complete or beyond) the saved rows
  // make outstandingCount === 0, which WITHOUT this status gate would re-enable
  // the button and fire a doomed /submit/phase2 (server returns
  // phase2_not_eligible). Gating on instance.status === "phase1_complete" is the
  // exact valid finalize window — 'open' (Phase 1 not done) and post-finalize
  // statuses both correctly disable it. handlePhase2Submit early-returns on
  // !phase2SubmitEnabled, so this also closes the doomed-call path.
  const phase2SubmitEnabled =
    instance.status === "phase1_complete" &&
    outstandingCount === 0 &&
    submitState.status !== "submitting";
  const submitEnabled =
    activePhase === "verification" ? phase1SubmitEnabled : phase2SubmitEnabled;

  // Status-driven spinner reset (React "adjust state when a prop changes"
  // pattern — react.dev/learn/you-might-not-need-an-effect). handlePhase1Submit
  // intentionally leaves submitState 'submitting' through router.refresh()
  // (work is in flight); this clears it the moment the refreshed status prop
  // arrives (open → non-open). Resetting on the arriving status — NOT
  // synchronously in the success handler — is what prevents a re-enable flicker
  // during the refresh round-trip: the phase1AlreadySubmitted gate above and
  // this reset settle in the same render pass, so the button never passes
  // through an enabled state. Adjusting during render (not in an effect) avoids
  // a cascading-render commit; on reload of an already-submitted instance the
  // init makes prevInstanceStatus === status, so this is a no-op.
  const [prevInstanceStatus, setPrevInstanceStatus] = useState(instance.status);
  if (instance.status !== prevInstanceStatus) {
    const wasOpen = prevInstanceStatus === "open";
    setPrevInstanceStatus(instance.status);
    if (phase1AlreadySubmitted && submitState.status === "submitting") {
      setSubmitState({ status: "idle" });
    }
    // On the same-session open → non-open transition (this user just submitted
    // Phase 1), advance them to Phase 2 in the same render pass the status
    // arrives — they don't re-click the now-unlocked tab. Server truth, not
    // form state, drives the advance.
    if (wasOpen && phase2Available) {
      setActivePhase("prep");
    }
  }

  // First missing-temp item label (for the "Temp reading required for [X]"
  // hint when ticked but missing temp).
  const firstMissingTempLabel = useMemo(() => {
    for (const item of phase1Items) {
      if (!item.expectsCount) continue;
      const v = values.get(item.id);
      if (v?.ticked && (v?.countValue === null || v?.countValue === undefined)) {
        return item.label;
      }
    }
    return null;
  }, [phase1Items, values]);

  const handlePhase2ItemChange = (
    templateItemId: string,
    next: OpeningPhase2FormValue,
  ) => {
    setPhase2Values((prev) => {
      const updated = new Map(prev);
      updated.set(templateItemId, next);
      return updated;
    });
  };

  // Per-row save dispatcher (C.53 Commit B Lane B). Fires on openerPrepped blur
  // and on over/under modal save. Takes the explicit value to persist (avoids a
  // stale closure over phase2Values). The savability pre-gate IS the coalescing
  // mechanism: a blur while a required reason is still missing is a no-op, so
  // the only dispatch that lands is the one that follows the modal save.
  const handlePhase2ItemSave = async (
    templateItemId: string,
    valueToSave: OpeningPhase2FormValue,
  ) => {
    const item = phase2ItemById.get(templateItemId);
    if (!item) return;

    const meta = item.prepMeta as OpeningPhase2Meta | null;
    const section = meta?.section ?? null;
    const sectionVerified = section
      ? (sectionVerifications.get(section) ?? false)
      : false;
    const snapshot = closerSnapshotsMap.get(templateItemId) ?? null;
    const closerCount = snapshot?.closerCount ?? null;
    const parValue = snapshot?.parValue ?? null;

    // Marks a row "incomplete" — a calm, directive nudge telling the prepper the
    // prerequisite blocking the save (NOT an error; see Phase2IncompleteReason).
    // Preserves any prior saved attribution so a saved-then-edited row keeps its
    // history fields while the badge shows the next step. "incomplete" is NOT
    // "saved", so it never decrements outstandingCount — the badge/gate
    // single-Map invariant holds (finalize stays blocked until the row saves).
    const markIncomplete = (reason: Phase2IncompleteReason) => {
      setSaveStates((prev) => {
        const updated = new Map(prev);
        const prior = prev.get(templateItemId);
        updated.set(templateItemId, {
          status: "incomplete",
          savedById: prior?.savedById ?? null,
          savedAt: prior?.savedAt ?? null,
          errorCode: null,
          incompleteReason: reason,
          savedSignature: prior?.savedSignature ?? null,
          completionId: prior?.completionId ?? null,
        });
        return updated;
      });
    };

    // Savability gate — mirror the row's render-time gates. Bail (no-op) until
    // the row holds a server-acceptable payload, so we never POST something the
    // RPC would 422/400. An untouched/blank row (no prep amount) stays "unsaved";
    // a started row blocked on a prerequisite (ground truth / reason) goes
    // "incomplete" so the prepper isn't left with a mute dead-spot. opener_prepped
    // is checked FIRST so a genuinely blank row reads "unsaved", not "incomplete".
    if (valueToSave.openerPrepped === null) return;
    // C.53 Commit B residual fix — source ground_truth + prep_need from the
    // PERSISTED Phase 1 contract so this pre-gate's delta matches the server's
    // delta by construction (the server reads prep_need straight from
    // prep_data.phase1, never recomputes). Defensive fallback to the old client
    // derivation only when no phase1 row exists yet. This also closes the
    // NULL-source finalize wedge: a NULL-source-recounted item has a persisted
    // non-null ground_truth, so the `needs_ground_truth` bail no longer fires
    // (closerCount is null but the recount lives in prep_data.phase1), the row
    // POSTs, and outstandingCount can reach 0.
    const resolved = phase1ResolvedByItem.get(templateItemId) ?? null;
    const groundTruth =
      resolved?.groundTruth ??
      (valueToSave.openerRecount !== null
        ? valueToSave.openerRecount
        : sectionVerified
          ? closerCount
          : null);
    if (groundTruth === null) {
      markIncomplete("needs_ground_truth");
      return;
    }
    if (parValue !== null) {
      const prepNeed = resolved?.prepNeed ?? Math.max(0, parValue - groundTruth);
      const delta = valueToSave.openerPrepped - prepNeed;
      if (delta > 0 && valueToSave.overPar === null) {
        markIncomplete("needs_reason");
        return;
      }
      if (delta < 0 && valueToSave.underPar === null) {
        markIncomplete("needs_reason");
        return;
      }
    }
    if (valueToSave.underPar && !valueToSave.underPar.freeText.trim()) {
      markIncomplete("needs_reason");
      return;
    }

    // Value-diff guard — skip the round-trip when the persisted value is already
    // current. Reads the same Map the badge renders from.
    const newSig = phase2Signature(valueToSave);
    const current = saveStates.get(templateItemId);
    if (current?.status === "saved" && current.savedSignature === newSig) return;

    // Optimistic "saving" — preserve prior saved attribution so a re-save shows
    // "saving" without dropping the existing "saved by" line if it fails.
    setSaveStates((prev) => {
      const updated = new Map(prev);
      const prior = prev.get(templateItemId);
      updated.set(templateItemId, {
        status: "saving",
        savedById: prior?.savedById ?? null,
        savedAt: prior?.savedAt ?? null,
        errorCode: null,
        incompleteReason: null,
        savedSignature: prior?.savedSignature ?? null,
        completionId: prior?.completionId ?? null,
      });
      return updated;
    });

    try {
      const res = await fetch("/api/opening/prep/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instance.id,
          entry: {
            templateItemId,
            openerPrepped: valueToSave.openerPrepped,
            overPar: valueToSave.overPar,
            underPar: valueToSave.underPar,
          },
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        const errorCode = res.status >= 500 ? "fallback" : (body.code ?? "fallback");
        setSaveStates((prev) => {
          const updated = new Map(prev);
          const prior = prev.get(templateItemId);
          updated.set(templateItemId, {
            status: "failed",
            savedById: prior?.savedById ?? null,
            savedAt: prior?.savedAt ?? null,
            errorCode,
            incompleteReason: null,
            savedSignature: prior?.savedSignature ?? null,
            completionId: prior?.completionId ?? null,
          });
          return updated;
        });
        return;
      }

      const body = (await res.json().catch(() => ({}))) as {
        completion?: { completedBy?: string; completedAt?: string };
        completionId?: string;
      };
      setSaveStates((prev) => {
        const updated = new Map(prev);
        updated.set(templateItemId, {
          status: "saved",
          savedById: body.completion?.completedBy ?? null,
          savedAt: body.completion?.completedAt ?? null,
          errorCode: null,
          incompleteReason: null,
          savedSignature: newSig,
          completionId: body.completionId ?? null,
        });
        return updated;
      });
    } catch {
      setSaveStates((prev) => {
        const updated = new Map(prev);
        const prior = prev.get(templateItemId);
        updated.set(templateItemId, {
          status: "failed",
          savedById: prior?.savedById ?? null,
          savedAt: prior?.savedAt ?? null,
          errorCode: "network",
          incompleteReason: null,
          savedSignature: prior?.savedSignature ?? null,
          completionId: prior?.completionId ?? null,
        });
        return updated;
      });
    }
  };

  // Per-item revoke dispatcher (C.53 Commit B Lane D §8.4). Two-step "server
  // decides the window" flow: the FIRST call sends no reason. The lib decides
  // silent (<60s self-revert, no audit row) vs structured (post-window / KH+,
  // reason required) — the CLIENT never predicts the boundary (clock skew, 60s
  // edge). A silent revoke returns 200 here. A structured revoke with no reason
  // returns 422 reason_required — a deliberate SIGNAL (not a malformed-request
  // error), surfaced as { status: "needs_reason" } so the row opens the reason
  // modal and re-dispatches with reason + note.
  const handlePhase2ItemRevoke = async (
    templateItemId: string,
    reason?: Phase2RevokeReason | null,
    note?: string | null,
  ): Promise<Phase2RevokeOutcome> => {
    const completionId = saveStates.get(templateItemId)?.completionId ?? null;
    // No live completion to revoke (row never saved, or raced gone). The badge
    // is already non-"saved", so there's nothing to undo client-side.
    if (completionId === null) return { status: "error", code: "revoke_conflict" };

    try {
      const res = await fetch("/api/opening/prep/item/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instance.id,
          completionId,
          reason: reason ?? null,
          note: note ?? null,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        // 422 reason_required is the lib's unambiguous "structured revoke needs
        // a reason" signal → open the reason modal. The code is self-sufficient;
        // we no longer infer the path from field-presence (that was the fragile
        // part — it conflated a genuine malformed-request 4xx with the path
        // signal). All other non-ok responses are real errors.
        if (res.status === 422 && body.code === "reason_required") {
          return { status: "needs_reason" };
        }
        const code = res.status >= 500 ? "fallback" : (body.code ?? "fallback");
        return { status: "error", code };
      }

      const body = (await res.json().catch(() => ({}))) as {
        path?: "silent" | "structured";
      };

      // Post-revoke Map reset (Juan's check #1): the row returns to "unsaved" —
      // NOT "incomplete"/blank — so outstandingCount re-blocks finalize via the
      // single-Map invariant. completionId clears (the revoked row is gone).
      setSaveStates((prev) => {
        const updated = new Map(prev);
        updated.set(templateItemId, {
          status: "unsaved",
          savedById: null,
          savedAt: null,
          errorCode: null,
          incompleteReason: null,
          savedSignature: null,
          completionId: null,
        });
        return updated;
      });
      // Clear the prep entry so the re-opened row is empty, but preserve
      // openerRecount — that's a Phase 1 verify-beat value, not part of the
      // revoked Phase 2 write.
      setPhase2Values((prev) => {
        const updated = new Map(prev);
        const cur = prev.get(templateItemId);
        updated.set(templateItemId, {
          openerRecount: cur?.openerRecount ?? null,
          openerPrepped: null,
          overPar: null,
          underPar: null,
        });
        return updated;
      });

      return { status: "revoked", path: body.path ?? "structured" };
    } catch {
      return { status: "error", code: "network" };
    }
  };

  const handleTabClick = (target: "verification" | "prep") => {
    if (target === "prep" && !phase2Available) return;
    setActivePhase(target);
  };

  // ---------------------------------------------------------------------------
  // Mutators
  // ---------------------------------------------------------------------------

  const handleItemChange = (templateItemId: string, next: OpeningItemFormValue) => {
    setValues((prev) => {
      const updated = new Map(prev);
      updated.set(templateItemId, next);
      return updated;
    });
  };

  const handleStationTickChange = (
    stationItems: ChecklistTemplateItem[],
    ticked: boolean,
  ) => {
    setValues((prev) => {
      const updated = new Map(prev);
      for (const item of stationItems) {
        // Fix-pass 2026-05-26: default-value fallback now includes
        // `openerRecount: null` to satisfy OpeningItemFormValue contract
        // (Aggie's WIP added the slot but missed this fallback site).
        const current = updated.get(item.id) ?? {
          countValue: null,
          photoId: null,
          notes: null,
          ticked: false,
          openerRecount: null,
        };
        // Q-B refinement: ONLY change `ticked`. countValue / photoId / notes /
        // openerRecount persist through tick state changes.
        updated.set(item.id, { ...current, ticked });
      }
      return updated;
    });
  };

  // ---------------------------------------------------------------------------
  // Submit — two routes, one per phase.
  //
  // Phase 1 POSTs to /api/opening/submit/phase1 (homogeneous Phase 1 payload +
  // openerNoPriorDataAttestation + sectionVerifications).
  //
  // Phase 2 uses the SPLIT (Question A) two-route flow: per-item prep writes
  // already persist on blur via /api/opening/prep/item (handlePhase2ItemSave →
  // save_phase2_item_atomic). FINALIZE therefore carries NO entries — it POSTs
  // only { instanceId } to /api/opening/submit/phase2, which reads the persisted
  // completions back, validates Model Y completeness, recomputes deltas, and
  // advances phase1_complete → phase2_complete.
  //
  // 5xx fallback per Triad A 2026-05-26 (fix-pass): any 5xx response falls to
  // `opening.error.fallback` regardless of the body code (covers
  // `actor_not_found` and other integrity-violation 500s without needing
  // dedicated i18n keys per response code).
  // ---------------------------------------------------------------------------

  const handlePhase1Submit = async () => {
    if (!phase1SubmitEnabled) {
      setShowMissingCountErrors(true);
      return;
    }

    setSubmitState({ status: "submitting" });

    // Build Phase 1 entries — homogeneous per-phase payload (no Phase 2 entries).
    // Spot-check fields are populated when the item is in the closer-count-
    // snapshot universe; the RPC re-derives the persisted spot_check_status
    // value, so the client just sends the best-guess discriminator.
    const phase1Entries = phase1Items.map((item) => {
      const v = values.get(item.id) ?? {
        countValue: null,
        photoId: null,
        notes: null,
        ticked: false,
        openerRecount: null,
      };
      const isSpotCheck = closerSnapshotsMap.has(item.id);
      const snapshotCloserCount = isSpotCheck
        ? closerSnapshotsMap.get(item.id)!.closerCount
        : null;
      return {
        templateItemId: item.id,
        phase: "phase1" as const,
        countValue: v.countValue,
        photoId: v.photoId,
        notes: v.notes,
        spotCheckStatus: isSpotCheck
          ? v.openerRecount !== null || snapshotCloserCount === null
            ? ("flagged_recount" as const)
            : ("matched_via_section_verify" as const)
          : null,
        openerRecount: v.openerRecount,
        groundTruthCount: null,
        prepNeed: null,
      };
    });

    // Section verifications — top-level field per migration 0055. Phase 1 owns
    // section-verification under C.53; Phase 2 does NOT re-send these.
    const sectionVerificationsPayload = Array.from(
      sectionVerifications.entries(),
    )
      .filter(([, verified]) => verified)
      .map(([sectionKey]) => ({ sectionKey, verified: true }));

    try {
      const res = await fetch("/api/opening/submit/phase1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instance.id,
          entries: phase1Entries,
          sectionVerifications: sectionVerificationsPayload,
          openerNoPriorDataAttestation: attestationReason,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        // 5xx fallback per Triad A: any 5xx → opening.error.fallback (covers
        // OpeningActorNotFoundError integrity case + other server-side
        // unexpected paths). 4xx → use the body code for specific i18n key.
        const code = res.status >= 500 ? "fallback" : (body.code ?? "fallback");
        setSubmitState({
          status: "error",
          errorCode: code,
          errorMessage: body.message ?? "Submission failed",
        });
        return;
      }

      // Success — server re-render advances instance.status to phase1_complete.
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitState({
        status: "error",
        errorCode: "network",
        errorMessage: msg,
      });
    }
  };

  const handlePhase2Submit = async () => {
    if (!phase2SubmitEnabled) {
      setShowMissingPhase2Errors(true);
      return;
    }

    setSubmitState({ status: "submitting" });

    // SPLIT (Question A) finalize — NO entries. Per-item prep writes already
    // persisted on blur via /api/opening/prep/item; this call carries only the
    // instance id. The server reads the persisted completions back, validates
    // Model Y completeness, recomputes deltas, dispatches under-prep
    // notifications, and advances phase1_complete → phase2_complete.
    try {
      const res = await fetch("/api/opening/submit/phase2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: instance.id }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
          missing_count?: number;
        };
        const code = res.status >= 500 ? "fallback" : (body.code ?? "fallback");
        setSubmitState({
          status: "error",
          errorCode: code,
          errorMessage: body.message ?? "Submission failed",
          // phase2_incomplete carries {count} — defense-in-depth race guard
          // (the finalize button is gated on outstandingCount === 0, so this
          // only fires if another device un-saved a row mid-flight).
          errorParams:
            code === "phase2_incomplete" && body.missing_count !== undefined
              ? { count: body.missing_count }
              : undefined,
        });
        return;
      }

      // Genuine success — server re-render branches to read-only / next phase.
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitState({
        status: "error",
        errorCode: "network",
        errorMessage: msg,
      });
    }
  };

  // Phase-aware dispatcher kept as `handleSubmit` for minimal render-code
  // changes — the sticky-footer button onClick binds here and routes by
  // activePhase.
  const handleSubmit = async () => {
    if (activePhase === "verification") {
      await handlePhase1Submit();
    } else {
      await handlePhase2Submit();
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4 pb-32">
      {/* Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          {t("opening.page.label")}
        </p>
        <h2 className="mt-1 text-2xl font-extrabold leading-tight text-co-text">
          {t("opening.page.title")}
        </h2>
        <p className="mt-1 text-sm text-co-text-muted">{t("opening.page.subtitle")}</p>
      </div>

      {/* Phase tabs — Phase 1 always navigable; Phase 2 hard-gated until
          Phase 1 complete, then becomes navigable. The Phase 2 tab is shown
          only when phase2Items is non-empty (defensive guard for a template
          with zero openingPhase2 items). */}
      <div className="flex gap-1.5 border-b-2 border-co-border-2">
        <button
          type="button"
          onClick={() => handleTabClick("verification")}
          aria-current={activePhase === "verification" ? "page" : undefined}
          className={[
            "inline-flex items-center px-3 py-2",
            "text-xs font-bold uppercase tracking-[0.14em]",
            "transition focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60",
            activePhase === "verification"
              ? "border-b-2 border-co-text text-co-text"
              : "border-b-2 border-transparent text-co-text-muted hover:text-co-text",
          ].join(" ")}
        >
          {t("opening.phase.tab_phase1")}
        </button>
        {phase2Items.length > 0 ? (
          <button
            type="button"
            onClick={() => handleTabClick("prep")}
            disabled={!phase2Available}
            aria-disabled={!phase2Available}
            aria-label={
              phase2Available ? undefined : t("opening.phase.tab_phase2_locked_aria")
            }
            aria-current={activePhase === "prep" ? "page" : undefined}
            className={[
              "inline-flex items-center px-3 py-2",
              "text-xs font-bold uppercase tracking-[0.14em]",
              "transition focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60",
              !phase2Available
                ? "border-b-2 border-transparent text-co-text-dim cursor-not-allowed opacity-80"
                : activePhase === "prep"
                  ? "border-b-2 border-co-text text-co-text"
                  : "border-b-2 border-transparent text-co-text-muted hover:text-co-text",
            ].join(" ")}
          >
            {phase2Available
              ? t("opening.phase.tab_phase2")
              : t("opening.phase.tab_phase2_locked")}
          </button>
        ) : null}
      </div>

      {/* Phase 1: Station cards */}
      {activePhase === "verification"
        ? Array.from(stationGroups.entries()).map(([station, items]) => (
            <OpeningVerificationStation
              key={station}
              station={station}
              items={items}
              values={values}
              onChange={handleItemChange}
              onStationTickChange={handleStationTickChange}
              language={language}
              showMissingCountErrors={showMissingCountErrors}
              closerSnapshotsMap={closerSnapshotsMap}
              sectionVerifications={sectionVerifications}
              onSectionVerifyToggle={handleSectionVerifyToggle}
              verificationLocked={verificationLocked}
            />
          ))
        : null}

      {/* C.54 §2.C inline attestation prompt — pre-submit surface that fires
          when any Phase 1 spot-check item has NULL-source provenance
          (closer_count IS NULL AND opener entered recount). Per Triad A
          2026-05-26 ack #3: inline, not a separate modal component; uses
          Aggie's shipped opening.phase1.attestation.* strings.

          Visible only on the Phase 1 tab (activePhase === "verification") to
          avoid surfacing it when the opener is on the Phase 2 tab. The
          attestationReason captured here threads into the /phase1 POST body's
          openerNoPriorDataAttestation field; the Phase 1 submit gate
          (phase1SubmitEnabled) additionally requires attestationReason !== null
          when needsAttestation is true. */}
      {activePhase === "verification" && needsAttestation ? (
        <section
          role="region"
          aria-label={t("opening.phase1.attestation.title")}
          className="rounded-2xl border-2 border-co-danger bg-[#FFE4E4] p-4 sm:p-5"
        >
          <h3 className="text-base font-extrabold uppercase tracking-[0.14em] text-co-text">
            {t("opening.phase1.attestation.title")}
          </h3>
          <p className="mt-1 text-sm text-co-text">
            {t("opening.phase1.attestation.subtitle", {
              count: nullSourceItemCount,
            })}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <label className="flex items-center gap-3 text-sm font-medium text-co-text">
              <input
                type="radio"
                name="opener_no_prior_data_reason"
                value="planned_closure"
                checked={attestationReason === "planned_closure"}
                onChange={() => setAttestationReason("planned_closure")}
                disabled={verificationLocked}
                className="h-5 w-5 accent-co-text disabled:cursor-not-allowed disabled:opacity-70"
              />
              {t("opening.phase1.attestation.option.planned_closure")}
            </label>
            <label className="flex items-center gap-3 text-sm font-medium text-co-text">
              <input
                type="radio"
                name="opener_no_prior_data_reason"
                value="missed_or_unknown"
                checked={attestationReason === "missed_or_unknown"}
                onChange={() => setAttestationReason("missed_or_unknown")}
                disabled={verificationLocked}
                className="h-5 w-5 accent-co-text disabled:cursor-not-allowed disabled:opacity-70"
              />
              {t("opening.phase1.attestation.option.missed_or_unknown")}
            </label>
          </div>
          {attestationReason !== null ? (
            <p className="mt-3 text-xs font-medium text-co-text">
              {t("opening.phase1.attestation.captured", {
                reason: t(
                  `opening.phase1.attestation.option.${attestationReason}` as
                    | "opening.phase1.attestation.option.planned_closure"
                    | "opening.phase1.attestation.option.missed_or_unknown",
                ),
              })}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Phase 2: Prep entry surface (C.50 redesign). Gated on phase2Items.length
          as a defensive guard so a template with zero openingPhase2 items can't
          render an empty prep surface even if activePhase were "prep". */}
      {activePhase === "prep" && phase2Items.length > 0 ? (
        <OpeningPrepEntry
          items={phase2Items}
          values={phase2Values}
          onChange={handlePhase2ItemChange}
          saveStates={saveStates}
          saverNames={saverNames}
          onSaveItem={handlePhase2ItemSave}
          onRevokeItem={handlePhase2ItemRevoke}
          closerSnapshots={closerSnapshotsMap}
          phase1ResolvedByItem={phase1ResolvedByItem}
          sectionVerifications={sectionVerifications}
          onSectionVerifyToggle={handleSectionVerifyToggle}
          managers={managers}
          language={language}
          showMissingErrors={showMissingPhase2Errors}
        />
      ) : null}

      {/* Error banner — renders opening.error.${code} (5xx codes fall back to
          opening.error.fallback per Triad A). phase2_incomplete carries a
          {count} param threaded through submitState.errorParams. */}
      {submitState.status === "error" ? (
        <div
          role="alert"
          className="rounded-2xl border-2 border-co-danger bg-[#FFE4E4] p-4 text-sm text-co-text"
        >
          {t(
            `opening.error.${submitState.errorCode ?? "fallback"}` as TranslationKey,
            submitState.errorParams,
          )}
        </div>
      ) : null}

      {/* Sticky footer — two-counter format per Q-C lock */}
      <footer
        className="
          fixed bottom-0 left-0 right-0 z-40 border-t-2 border-co-border bg-co-surface
          px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] sm:px-6
        "
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium text-co-text-muted">
              <span className="font-bold text-co-text">
                {t("opening.submit.counter_verified", {
                  ticked: tickedCount,
                  total: totalTickItems,
                })}
              </span>
              {" · "}
              <span className="font-bold text-co-text">
                {t("opening.submit.counter_temps", {
                  filled: filledTempCount,
                  total: totalTempItems,
                })}
              </span>
              {totalPhase2Items > 0 ? (
                <>
                  {" · "}
                  <span className="font-bold text-co-text">
                    {t("opening.submit.counter_phase2_entries", {
                      filled: savedPhase2Count,
                      total: totalPhase2Items,
                    })}
                  </span>
                </>
              ) : null}
            </p>
            {/* Phase-aware gate hint per 3c form-split. On the Phase 1 tab,
                surface Phase 1 blockers (ticks, temps, attestation). On the
                Phase 2 tab, surface Phase 2 blockers (entries, under-par
                freetext). When attestation is required but not yet captured,
                the inline prompt above is the actionable surface — the
                sticky-footer hint falls to gate_disabled_generic since
                duplicate messaging would be noise. */}
            <p className="text-[11px] text-co-text-dim">
              {submitEnabled
                ? t("opening.submit.gate_ready")
                : activePhase === "verification"
                  ? !allTicked
                    ? t("opening.submit.gate_disabled_items_remaining", {
                        remaining: totalTickItems - tickedCount,
                      })
                    : firstMissingTempLabel
                      ? t("opening.submit.gate_disabled_temps_required", {
                          item: firstMissingTempLabel,
                        })
                      : !spotCheckResolved
                        ? spotCheckBlockReason === "template_misconfigured"
                          ? t(
                              "opening.submit.gate_disabled_template_misconfigured",
                            )
                          : t("opening.submit.gate_disabled_verify_sections")
                        : t("opening.submit.gate_disabled_generic")
                  : phase2AlreadyFinalized
                    ? t("opening.finalize.already_finalized")
                    : outstandingCount > 0
                      ? t("opening.finalize.gate_outstanding", {
                          count: outstandingCount,
                        })
                      : t("opening.submit.gate_disabled_generic")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!submitEnabled}
            className={[
              "inline-flex min-h-[48px] items-center justify-center rounded-md px-6",
              "text-sm font-bold uppercase tracking-[0.12em]",
              "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
              submitEnabled
                ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
                : "border-2 border-co-border-2 bg-co-surface text-co-text-faint cursor-not-allowed",
            ].join(" ")}
          >
            {submitState.status === "submitting"
              ? t("opening.submit.submitting")
              : activePhase === "verification"
                ? t("opening.submit.button_label")
                : phase2AlreadyFinalized
                  ? t("opening.finalize.button_label_finalized")
                  : outstandingCount > 0
                    ? t("opening.finalize.button_label_outstanding", {
                        count: outstandingCount,
                      })
                    : t("opening.finalize.button_label")}
          </button>
        </div>
      </footer>
    </div>
  );
}
