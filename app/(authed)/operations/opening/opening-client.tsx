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
 * Submit gates on BOTH phases complete. POST /api/opening/submit with
 * combined entries (Phase 1 phase1-shaped + Phase 2 phase2-shaped, single
 * discriminated-union array per the lib's OpeningEntry contract).
 *
 * Form state independence (Q-B refinement): per-station tick changes
 * ONLY the `ticked` field across items in that station. countValue,
 * photoId, notes are independent fields — never touched by tick toggles.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type { OpeningCloserCountSnapshotRow } from "@/lib/opening";
import type {
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
} from "@/components/opening/OpeningPrepEntry";
import type { ManagerOption } from "@/components/opening/OverParModal";

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
  /** AGM+ at this location for over-par directedBy dropdown. */
  managers: ReadonlyArray<ManagerOption>;
  language: Language;
}

interface SubmitState {
  status: "idle" | "submitting" | "error";
  errorCode?: string;
  errorMessage?: string;
}

export function OpeningClient({
  instance,
  templateItems,
  closerSnapshots,
  managers,
  language,
}: OpeningClientProps) {
  const { t } = useTranslation();
  const router = useRouter();

  // Split templateItems by phase. Phase 2 items carry prep_meta.openingPhase2=true;
  // Phase 1 items have null prep_meta OR prep_meta without the marker.
  const { phase1Items, phase2Items } = useMemo(() => {
    const p1: ChecklistTemplateItem[] = [];
    const p2: ChecklistTemplateItem[] = [];
    for (const it of templateItems) {
      const meta = it.prepMeta as OpeningPhase2Meta | null;
      if (meta?.openingPhase2 === true) p2.push(it);
      else p1.push(it);
    }
    return { phase1Items: p1, phase2Items: p2 };
  }, [templateItems]);

  // Phase 1 form state.
  const [values, setValues] = useState<Map<string, OpeningItemFormValue>>(() => {
    const map = new Map<string, OpeningItemFormValue>();
    for (const item of phase1Items) {
      map.set(item.id, { countValue: null, photoId: null, notes: null, ticked: false, openerRecount: null });
    }
    return map;
  });

  // Phase 2 form state — C.50 redesign: openerRecount replaces openerActual.
  const [phase2Values, setPhase2Values] = useState<Map<string, OpeningPhase2FormValue>>(() => {
    const map = new Map<string, OpeningPhase2FormValue>();
    for (const item of phase2Items) {
      map.set(item.id, {
        openerRecount: null,
        openerPrepped: null,
        overPar: null,
        underPar: null,
      });
    }
    return map;
  });

  // Phase 2 section verifications — Map<sectionKey, verified-state>. Per C.50
  // §4: opener taps Verify Section to mark all items in section as
  // "ground_truth = closer_count"; per-item recount is the override path.
  // Initial state: all sections present in phase2Items, default unverified.
  const [sectionVerifications, setSectionVerifications] = useState<
    Map<string, boolean>
  >(() => {
    const map = new Map<string, boolean>();
    for (const item of phase2Items) {
      const meta = item.prepMeta as OpeningPhase2Meta | null;
      if (meta?.section) map.set(meta.section, false);
    }
    return map;
  });

  const handleSectionVerifyToggle = (sectionKey: string) => {
    setSectionVerifications((prev) => {
      const updated = new Map(prev);
      updated.set(sectionKey, !(prev.get(sectionKey) ?? false));
      return updated;
    });
  };

  // Convert closerSnapshots Record (RSC boundary) to Map for component-internal
  // use. Map.get() is more idiomatic for per-item lookups in phase2Complete +
  // OpeningPrepEntry. Memoized to stable reference; updates only when prop
  // changes (which happens on Server Component re-render).
  const closerSnapshotsMap = useMemo(
    () => new Map(Object.entries(closerSnapshots)),
    [closerSnapshots],
  );

  // Active phase (locked Sub-decision (b): always start at "verification").
  const [activePhase, setActivePhase] = useState<"verification" | "prep">("verification");

  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [showMissingCountErrors, setShowMissingCountErrors] = useState(false);
  const [showMissingPhase2Errors, setShowMissingPhase2Errors] = useState(false);

  // C.54 §2.C — opener attestation when any Phase 1 spot-check item has
  // NULL-source provenance (closer_count IS NULL AND opener entered recount).
  // Captured via the inline attestation prompt below; threaded to the
  // /api/opening/submit/phase1 body's `openerNoPriorDataAttestation` field.
  // Per Triad A 2026-05-26 ack #3: inline pre-submit surface (not a modal),
  // using Aggie's shipped `opening.phase1.attestation.*` strings.
  const [attestationReason, setAttestationReason] =
    useState<OpeningNoPriorDataReason | null>(null);

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

  // Phase 1 counters.
  const totalPhase1Items = phase1Items.length;
  const tickedCount = useMemo(() => {
    let n = 0;
    for (const v of values.values()) if (v.ticked) n += 1;
    return n;
  }, [values]);

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

  // Phase 2 counters. Counter shows informational progress (items where
  // opener_prepped is populated); the full submit gate is computed
  // separately as phase2Complete.
  const totalPhase2Items = phase2Items.length;
  const filledPhase2Count = useMemo(() => {
    let n = 0;
    for (const v of phase2Values.values()) {
      if (typeof v.openerPrepped === "number") n += 1;
    }
    return n;
  }, [phase2Values]);

  const allTicked = tickedCount === totalPhase1Items;
  const allTempsFilled = filledTempCount === totalTempItems;
  const phase1Complete = allTicked && allTempsFilled;

  // C.54 §2.B/§2.C — count of Phase 1 spot-check items where the source
  // closer_count is NULL AND the opener has entered a recount. Drives the
  // inline attestation prompt below: when count > 0, the opener MUST select
  // a reason (planned_closure | missed_or_unknown) before Phase 1 can submit.
  //
  // The iteration scope is `phase1Items` — the items that POST to /phase1.
  // Under C.53's UI restructure, spot-check items will move into this set
  // (currently they're in phase2Items; this logic is forward-prepared for the
  // restructure and is operationally inert until then).
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

  // Phase 2 submit gate per C.50 §4 — full gate check across all items:
  //   1. ground_truth resolved (section verified OR opener_recount populated)
  //   2. opener_prepped always required (universal — par-null items still need it)
  //   3. when prep_need computable AND delta != 0, reason capture required
  //      (overPar populated when delta > 0; underPar when delta < 0)
  // Server is canonical (per §8.3 lock); this client gate prevents wasted
  // round-trips but doesn't replace server validation.
  const phase2Complete = useMemo(() => {
    for (const item of phase2Items) {
      const value = phase2Values.get(item.id);
      if (!value) return false;
      const meta = item.prepMeta as OpeningPhase2Meta | null;
      const section = meta?.section ?? null;
      const sectionVerified = section
        ? (sectionVerifications.get(section) ?? false)
        : false;
      const snapshot = closerSnapshotsMap.get(item.id) ?? null;
      const closerCount = snapshot?.closerCount ?? null;
      const parValue = snapshot?.parValue ?? null;

      // Gate 1: ground_truth resolved
      const groundTruth =
        value.openerRecount !== null
          ? value.openerRecount
          : sectionVerified
            ? closerCount
            : null;
      if (groundTruth === null) return false;

      // Gate 2: opener_prepped required (always)
      if (value.openerPrepped === null) return false;

      // Gate 3: reason capture if delta != 0 (only when prep_need computable)
      if (parValue !== null) {
        const prepNeed = Math.max(0, parValue - groundTruth);
        const delta = value.openerPrepped - prepNeed;
        if (delta > 0 && value.overPar === null) return false;
        if (delta < 0 && value.underPar === null) return false;
      }
    }
    return true;
  }, [phase2Items, phase2Values, sectionVerifications, closerSnapshotsMap]);

  // Under-par freetext check — every phase2Values entry with underPar set
  // must have non-empty freeText (Step 4 RPC will reject otherwise).
  const firstUnderParMissingFreetext = useMemo(() => {
    for (const item of phase2Items) {
      const v = phase2Values.get(item.id);
      if (v?.underPar && !v.underPar.freeText.trim()) return item.label;
    }
    return null;
  }, [phase2Items, phase2Values]);

  // Phase-aware submit gates per Triad A 2026-05-26 (3c form-split).
  //   - Phase 1 submit: gate on phase1Complete + attestation (if needed).
  //   - Phase 2 submit: gate on phase2Complete + under-par freetext present.
  // The sticky-footer submit button binds to whichever gate matches activePhase.
  const phase1SubmitEnabled =
    phase1Complete &&
    (!needsAttestation || attestationReason !== null) &&
    submitState.status !== "submitting";
  const phase2SubmitEnabled =
    phase2Complete &&
    firstUnderParMissingFreetext === null &&
    submitState.status !== "submitting";
  const submitEnabled =
    activePhase === "verification" ? phase1SubmitEnabled : phase2SubmitEnabled;

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

  const handleTabClick = (target: "verification" | "prep") => {
    if (target === "prep" && !phase1Complete) return;
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
  // Submit — split per Triad A 2026-05-26 (3c integration flip)
  //
  // Phase 1 POSTs to the new /api/opening/submit/phase1 (homogeneous Phase 1
  // payload + openerNoPriorDataAttestation + sectionVerifications). Phase 2
  // POSTs to the legacy /api/opening/submit (homogeneous Phase 2 payload).
  //
  // Piece 4 (legacy route defensive branch) intercepts Phase 2 submissions
  // when the instance is in `phase1_complete` and returns a 200 with
  // `code: 'phase2_pending_next_release'` — handlePhase2Submit treats that as
  // a graceful info message (not an error).
  //
  // 5xx fallback per Triad A 2026-05-26 (fix-pass): any 5xx response from
  // /phase1 falls to `opening.error.fallback` regardless of the body code
  // (covers `actor_not_found` and other integrity-violation 500s without
  // needing dedicated i18n keys per response code).
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

    // Build Phase 2 entries — homogeneous per-phase payload (no Phase 1 entries).
    // Posts to the LEGACY /api/opening/submit route, which still dispatches via
    // submitOpening → submit_opening_atomic for Phase 2 entries. The Phase 2
    // per-phase RPC + route lands in a future commit; until then, Piece 4's
    // defensive branch in the legacy route fast-paths the phase1_complete case.
    const phase2Entries = phase2Items.map((item) => {
      const v = phase2Values.get(item.id) ?? {
        openerRecount: null,
        openerPrepped: null,
        overPar: null,
        underPar: null,
      };
      return {
        templateItemId: item.id,
        phase: "phase2" as const,
        openerPrepped: v.openerPrepped ?? 0,
        deltaVsPrepNeed: null,
        overPar: v.overPar,
        underPar: v.underPar,
      };
    });

    try {
      const res = await fetch("/api/opening/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instance.id,
          entries: phase2Entries,
          // Phase 1 owns section-verifications per C.53; Phase 2 sends empty.
          sectionVerifications: [],
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        const code = res.status >= 500 ? "fallback" : (body.code ?? "fallback");
        setSubmitState({
          status: "error",
          errorCode: code,
          errorMessage: body.message ?? "Submission failed",
        });
        return;
      }

      // Piece 4 graceful response — `phase2_pending_next_release` is a 200
      // success-shape with a discriminator. Surface as a user-visible info
      // message via the existing error banner (re-using `errorCode` slot;
      // the form's error-banner i18n lookup at opening.error.${errorCode}
      // would render the wrong key, so we set a custom phase2-pending code
      // and the banner branch below detects it).
      const successBody = (await res.json().catch(() => ({}))) as {
        code?: string;
      };
      if (successBody.code === "phase2_pending_next_release") {
        setSubmitState({
          status: "error",
          errorCode: "phase2_pending_next_release",
          errorMessage: t("opening.phase2.pending_next_release.body"),
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
          Phase 1 complete, then becomes navigable. */}
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
        <button
          type="button"
          onClick={() => handleTabClick("prep")}
          disabled={!phase1Complete}
          aria-disabled={!phase1Complete}
          aria-label={
            phase1Complete ? undefined : t("opening.phase.tab_phase2_locked_aria")
          }
          aria-current={activePhase === "prep" ? "page" : undefined}
          className={[
            "inline-flex items-center px-3 py-2",
            "text-xs font-bold uppercase tracking-[0.14em]",
            "transition focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60",
            !phase1Complete
              ? "border-b-2 border-transparent text-co-text-dim cursor-not-allowed opacity-80"
              : activePhase === "prep"
                ? "border-b-2 border-co-text text-co-text"
                : "border-b-2 border-transparent text-co-text-muted hover:text-co-text",
          ].join(" ")}
        >
          {phase1Complete
            ? t("opening.phase.tab_phase2")
            : t("opening.phase.tab_phase2_locked")}
        </button>
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
                className="h-5 w-5 accent-co-text"
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
                className="h-5 w-5 accent-co-text"
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

      {/* Phase 2: Prep entry surface (C.50 redesign) */}
      {activePhase === "prep" ? (
        <OpeningPrepEntry
          items={phase2Items}
          values={phase2Values}
          onChange={handlePhase2ItemChange}
          closerSnapshots={closerSnapshotsMap}
          sectionVerifications={sectionVerifications}
          onSectionVerifyToggle={handleSectionVerifyToggle}
          managers={managers}
          language={language}
          showMissingErrors={showMissingPhase2Errors}
        />
      ) : null}

      {/* Error / info banner — handles three shapes:
          - phase2_pending_next_release (Piece 4 graceful 200): info styling,
            renders opening.phase2.pending_next_release.body
          - generic error codes: error styling, renders opening.error.${code}
            (5xx codes fall back to opening.error.fallback per Triad A) */}
      {submitState.status === "error" ? (
        submitState.errorCode === "phase2_pending_next_release" ? (
          <div
            role="status"
            className="rounded-2xl border-2 border-co-text bg-co-gold p-4 text-sm text-co-text"
          >
            <p className="font-bold uppercase tracking-[0.12em]">
              {t("opening.phase2.pending_next_release.title")}
            </p>
            <p className="mt-1">
              {t("opening.phase2.pending_next_release.body")}
            </p>
          </div>
        ) : (
          <div
            role="alert"
            className="rounded-2xl border-2 border-co-danger bg-[#FFE4E4] p-4 text-sm text-co-text"
          >
            {t(
              `opening.error.${submitState.errorCode ?? "fallback"}` as `opening.error.fallback`,
            )}
          </div>
        )
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
                  total: totalPhase1Items,
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
                      filled: filledPhase2Count,
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
                        remaining: totalPhase1Items - tickedCount,
                      })
                    : firstMissingTempLabel
                      ? t("opening.submit.gate_disabled_temps_required", {
                          item: firstMissingTempLabel,
                        })
                      : t("opening.submit.gate_disabled_generic")
                  : !phase2Complete
                    ? t("opening.submit.gate_disabled_phase2_remaining", {
                        remaining: totalPhase2Items - filledPhase2Count,
                      })
                    : firstUnderParMissingFreetext
                      ? t("opening.submit.gate_disabled_under_par_freetext", {
                          item: firstUnderParMissingFreetext,
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
              : t("opening.submit.button_label")}
          </button>
        </div>
      </footer>
    </div>
  );
}
