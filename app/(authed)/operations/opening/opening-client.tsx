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
import type { CloserEstimateSnapshot } from "@/lib/opening";
import type {
  ChecklistInstance,
  ChecklistTemplateItem,
  OpeningPhase2Meta,
} from "@/lib/types";

import { OpeningVerificationStation } from "@/components/opening/OpeningVerificationStation";
import type { OpeningItemFormValue } from "@/components/opening/OpeningChecklistItem";
import {
  OpeningPrepEntry,
  type OpeningPrepEntryFormValue,
} from "@/components/opening/OpeningPrepEntry";
import type { ManagerOption } from "@/components/opening/OverParModal";

interface OpeningClientProps {
  instance: ChecklistInstance;
  templateItems: ChecklistTemplateItem[];
  /** Closer-estimate snapshots resolved server-side (Step 7 page.tsx). */
  closerSnapshots: Record<string, CloserEstimateSnapshot | null>;
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
      map.set(item.id, { countValue: null, photoId: null, notes: null, ticked: false });
    }
    return map;
  });

  // Phase 2 form state.
  const [phase2Values, setPhase2Values] = useState<Map<string, OpeningPrepEntryFormValue>>(() => {
    const map = new Map<string, OpeningPrepEntryFormValue>();
    for (const item of phase2Items) {
      map.set(item.id, {
        openerActual: null,
        openerPrepped: null,
        overPar: null,
        underPar: null,
      });
    }
    return map;
  });

  // Active phase (locked Sub-decision (b): always start at "verification").
  const [activePhase, setActivePhase] = useState<"verification" | "prep">("verification");

  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [showMissingCountErrors, setShowMissingCountErrors] = useState(false);
  const [showMissingPhase2Errors, setShowMissingPhase2Errors] = useState(false);

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

  // Phase 2 counters.
  const totalPhase2Items = phase2Items.length;
  const filledPhase2Count = useMemo(() => {
    let n = 0;
    for (const v of phase2Values.values()) {
      if (typeof v.openerActual === "number" && typeof v.openerPrepped === "number") {
        n += 1;
      }
    }
    return n;
  }, [phase2Values]);

  const allTicked = tickedCount === totalPhase1Items;
  const allTempsFilled = filledTempCount === totalTempItems;
  const phase1Complete = allTicked && allTempsFilled;
  const phase2Complete = filledPhase2Count === totalPhase2Items;

  // Under-par freetext check — every phase2Values entry with underPar set
  // must have non-empty freeText (Step 4 RPC will reject otherwise).
  const firstUnderParMissingFreetext = useMemo(() => {
    for (const item of phase2Items) {
      const v = phase2Values.get(item.id);
      if (v?.underPar && !v.underPar.freeText.trim()) return item.label;
    }
    return null;
  }, [phase2Items, phase2Values]);

  const submitEnabled =
    phase1Complete &&
    phase2Complete &&
    firstUnderParMissingFreetext === null &&
    submitState.status !== "submitting";

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
    next: OpeningPrepEntryFormValue,
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
        const current = updated.get(item.id) ?? {
          countValue: null,
          photoId: null,
          notes: null,
          ticked: false,
        };
        // Q-B refinement: ONLY change `ticked`. countValue / photoId / notes
        // persist through tick state changes.
        updated.set(item.id, { ...current, ticked });
      }
      return updated;
    });
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    if (!submitEnabled) {
      setShowMissingCountErrors(true);
      setShowMissingPhase2Errors(true);
      return;
    }

    setSubmitState({ status: "submitting" });

    // Marshal Phase 1 entries with phase: "phase1" + Phase 2 entries with
    // phase: "phase2" + phase2 sub-object. Single discriminated-union array
    // matches lib/opening.ts OpeningEntry contract (Step 4).
    const phase1Entries = phase1Items.map((item) => {
      const v = values.get(item.id) ?? {
        countValue: null,
        photoId: null,
        notes: null,
        ticked: false,
      };
      return {
        templateItemId: item.id,
        phase: "phase1" as const,
        countValue: v.countValue,
        photoId: v.photoId,
        notes: v.notes,
      };
    });

    const phase2Entries = phase2Items.map((item) => {
      const v = phase2Values.get(item.id) ?? {
        openerActual: null,
        openerPrepped: null,
        overPar: null,
        underPar: null,
      };
      return {
        templateItemId: item.id,
        phase: "phase2" as const,
        phase2: {
          openerActual: v.openerActual ?? 0,
          openerPrepped: v.openerPrepped ?? 0,
          overPar: v.overPar,
          underPar: v.underPar,
          closerEstimateSnapshot: closerSnapshots[item.id] ?? null,
        },
      };
    });

    const entries = [...phase1Entries, ...phase2Entries];

    try {
      const res = await fetch("/api/opening/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: instance.id, entries }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          code?: string;
          message?: string;
        };
        const code = body.code ?? "fallback";
        setSubmitState({
          status: "error",
          errorCode: code,
          errorMessage: body.message ?? "Submission failed",
        });
        return;
      }

      // Success — server re-render branches to read-only.
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
            />
          ))
        : null}

      {/* Phase 2: Prep entry surface */}
      {activePhase === "prep" ? (
        <OpeningPrepEntry
          items={phase2Items}
          values={phase2Values}
          onChange={handlePhase2ItemChange}
          closerSnapshots={closerSnapshots}
          managers={managers}
          language={language}
          showMissingErrors={showMissingPhase2Errors}
        />
      ) : null}

      {/* Error banner */}
      {submitState.status === "error" ? (
        <div
          role="alert"
          className="rounded-2xl border-2 border-co-danger bg-[#FFE4E4] p-4 text-sm text-co-text"
        >
          {t(
            `opening.error.${submitState.errorCode ?? "fallback"}` as `opening.error.fallback`,
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
            <p className="text-[11px] text-co-text-dim">
              {submitEnabled
                ? t("opening.submit.gate_ready")
                : !allTicked
                  ? t("opening.submit.gate_disabled_items_remaining", {
                      remaining: totalPhase1Items - tickedCount,
                    })
                  : firstMissingTempLabel
                    ? t("opening.submit.gate_disabled_temps_required", {
                        item: firstMissingTempLabel,
                      })
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
