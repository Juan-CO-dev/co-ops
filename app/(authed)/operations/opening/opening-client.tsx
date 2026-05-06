"use client";

/**
 * Opening Phase 1 form orchestrator — Build #3 PR 2.
 *
 * Top-level client component owning the form state Map keyed by
 * templateItemId. Renders 10 station cards in display_order. Sticky
 * footer surfaces the two-counter submit gate per Q-C lock:
 *   "{ticked}/44 verified · {temps}/8 temp readings entered · {state}"
 *
 * Submit: POST /api/opening/submit. On success, route reloads (Server
 * Component re-renders into the read-only banner branch via
 * `instance.status='confirmed'`).
 *
 * Form state independence (Q-B refinement): per-station tick changes
 * ONLY the `ticked` field across items in that station. countValue,
 * photoId, notes are independent fields — never touched by tick toggles.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
import type {
  ChecklistInstance,
  ChecklistTemplateItem,
} from "@/lib/types";

import { OpeningVerificationStation } from "@/components/opening/OpeningVerificationStation";
import type { OpeningItemFormValue } from "@/components/opening/OpeningChecklistItem";

interface OpeningClientProps {
  instance: ChecklistInstance;
  templateItems: ChecklistTemplateItem[];
  language: Language;
}

interface SubmitState {
  status: "idle" | "submitting" | "error";
  errorCode?: string;
  errorMessage?: string;
}

export function OpeningClient({ instance, templateItems, language }: OpeningClientProps) {
  const { t } = useTranslation();
  const router = useRouter();

  // Initial form state: every item starts with all fields null + unticked.
  // Phase 6 will add prior-completion-derived initial values when edit
  // resumption lands; PR 2 always starts fresh.
  const [values, setValues] = useState<Map<string, OpeningItemFormValue>>(() => {
    const map = new Map<string, OpeningItemFormValue>();
    for (const item of templateItems) {
      map.set(item.id, { countValue: null, photoId: null, notes: null, ticked: false });
    }
    return map;
  });

  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });
  const [showMissingCountErrors, setShowMissingCountErrors] = useState(false);

  // Group items by station — same pattern as closing-client.tsx (insertion-order Map).
  const stationGroups = useMemo(() => {
    const groups = new Map<string, ChecklistTemplateItem[]>();
    for (const it of templateItems) {
      const key = it.station ?? "—";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(it);
    }
    return groups;
  }, [templateItems]);

  // Counters for the sticky footer.
  const totalItems = templateItems.length;
  const tickedCount = useMemo(() => {
    let n = 0;
    for (const v of values.values()) if (v.ticked) n += 1;
    return n;
  }, [values]);

  const totalTempItems = useMemo(
    () => templateItems.filter((it) => it.expectsCount).length,
    [templateItems],
  );
  const filledTempCount = useMemo(() => {
    let n = 0;
    for (const item of templateItems) {
      if (!item.expectsCount) continue;
      const v = values.get(item.id);
      if (v?.countValue !== null && v?.countValue !== undefined) n += 1;
    }
    return n;
  }, [templateItems, values]);

  const allTicked = tickedCount === totalItems;
  const allTempsFilled = filledTempCount === totalTempItems;
  const submitEnabled = allTicked && allTempsFilled && submitState.status !== "submitting";

  // First missing-temp item label (for the "Temp reading required for [X]"
  // hint when ticked but missing temp).
  const firstMissingTempLabel = useMemo(() => {
    for (const item of templateItems) {
      if (!item.expectsCount) continue;
      const v = values.get(item.id);
      if (v?.ticked && (v?.countValue === null || v?.countValue === undefined)) {
        return item.label;
      }
    }
    return null;
  }, [templateItems, values]);

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
      return;
    }

    setSubmitState({ status: "submitting" });

    const entries = templateItems.map((item) => {
      const v = values.get(item.id) ?? {
        countValue: null,
        photoId: null,
        notes: null,
        ticked: false,
      };
      return {
        templateItemId: item.id,
        countValue: v.countValue,
        photoId: v.photoId,
        notes: v.notes,
      };
    });

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

      {/* Phase tabs (PR 2: Phase 1 only; Phase 2 disabled) */}
      <div className="flex gap-1.5 border-b-2 border-co-border-2">
        <span
          className="
            inline-flex items-center border-b-2 border-co-text px-3 py-2
            text-xs font-bold uppercase tracking-[0.14em] text-co-text
          "
        >
          {t("opening.phase.tab_phase1")}
        </span>
        <span
          aria-disabled
          title={t("opening.phase.tab_phase2_tooltip")}
          className="
            inline-flex items-center px-3 py-2
            text-xs font-bold uppercase tracking-[0.14em] text-co-text-faint cursor-not-allowed
          "
        >
          {t("opening.phase.tab_phase2_disabled")}
        </span>
      </div>

      {/* Station cards */}
      {Array.from(stationGroups.entries()).map(([station, items]) => (
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
      ))}

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
                  total: totalItems,
                })}
              </span>
              {" · "}
              <span className="font-bold text-co-text">
                {t("opening.submit.counter_temps", {
                  filled: filledTempCount,
                  total: totalTempItems,
                })}
              </span>
            </p>
            <p className="text-[11px] text-co-text-dim">
              {submitEnabled
                ? t("opening.submit.gate_ready")
                : !allTicked
                  ? t("opening.submit.gate_disabled_items_remaining", {
                      remaining: totalItems - tickedCount,
                    })
                  : firstMissingTempLabel
                    ? t("opening.submit.gate_disabled_temps_required", {
                        item: firstMissingTempLabel,
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
