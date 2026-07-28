"use client";

/**
 * PackChainWizard — the class-aware guided chain builder (SKU top-tier PR-B,
 * council 2026-07-28). Replaces the legacy quick-pack fields in SkuBuilder's
 * Section B for an UNCHAINED SKU (add OR unchained-edit): every SKU speaks ONE
 * pack language — the chain — asked in plain manager questions, STOPPING SOONER
 * for non-raw classes.
 *
 * The flow, per container level (D8 — one active question block at a time;
 * answered levels collapse to summary lines):
 *   Q1 "What does it come in?"  → the level label (free text + datalist of
 *      pack-format suggestions). Safe default: "container"/"inner" — NEVER a
 *      measure-unit label (the BC label-collision class, caught twice).
 *   Q2 "How many per?"          → the containsQty for that level.
 *   Branch: "Another container inside?" → recurse (a new level) — OR terminate.
 *
 * Termination is CLASS-AWARE and AUTOMATIC (the manager never picks raw-vs-not):
 *   raw               → "How big is each?" oz amount + measure (+ avg oz per
 *                        each when the measure is count/volume — raw feeds
 *                        depletion/cost so its leaf MUST be oz-resolvable).
 *   packaging / misc  → a bare count leaf: leaf labeled "inner" CONTAINS the
 *                        count measure "each", qty 1. No size, no avg.
 *   cleaning          → the bare count leaf too, plus an OPT-IN "Add a size?"
 *                        that swaps it for a weight/volume size leaf (bleach
 *                        128 oz/jug — skippable).
 *
 * ≤3-question save cap (6AM-risk law): the shortest valid save is
 * Q1 + Q2 + terminal. Deeper depth is user-chosen recursion.
 *
 * PURE-PRESENTATIONAL: local useState only (D9 — no localStorage/URL). Emits a
 * StarterChainLevel[] (index-linked) via onChange; the parent (SkuBuilder)
 * submits it through the SAME validated write path PR-A built — no new chain
 * writer here, so firstLabelMeasureCollision binds automatically.
 */

import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { RegistryOption, MeasureUnitOption } from "@/lib/admin/skus";
import type { SkuClass } from "@/lib/admin/catalog-shared";
import type { StarterChainLevel } from "@/lib/admin/catalog-shared";
import { defaultWizardLevelLabel } from "@/lib/admin/catalog-shared";

/** The count-dim measure a non-raw bare count leaf terminates in (seed 10/14).
 *  Default level LABELS come from defaultWizardLevelLabel (catalog-shared):
 *  distinct PER DEPTH — an all-default multi-level chain must never repeat a
 *  label (UNIQUE(sku_id,label) → duplicate_label) — and never a measure word. */
const COUNT_LEAF_MEASURE = "each";

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

/** A committed container level (points at the next level down). */
interface ContainerStep {
  label: string;
  qty: string;
}

/**
 * Compact wizard question block. `title` is the plain-language question; the
 * children are the inputs. Answered levels render via SummaryLine instead.
 */
function QuestionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-co-border-2 bg-co-surface p-3">
      <p className="text-sm font-bold text-co-text">{title}</p>
      {children}
    </div>
  );
}

function SummaryLine({ text }: { text: string }) {
  return (
    <div className="rounded-md border-2 border-co-border-2 px-2 py-1.5 text-xs text-co-text">
      {text}
    </div>
  );
}

export function PackChainWizard({
  skuClass,
  packFormats,
  measureUnits,
  avgOzPerEach,
  onAvgOzPerEachChange,
  busy,
  onChange,
}: {
  skuClass: SkuClass;
  /** Pack-format registry — datalist suggestions for the root label question. */
  packFormats: RegistryOption[];
  measureUnits: MeasureUnitOption[];
  /** The SKU-level avg oz per each (raw count/volume leaf). Controlled by the
   *  parent so it rides the SAME submission the chain does. String form. */
  avgOzPerEach: string;
  onAvgOzPerEachChange: (v: string) => void;
  busy: boolean;
  /** Emits the assembled chain (index-linked) or null when not yet valid. */
  onChange: (chain: StarterChainLevel[] | null) => void;
}) {
  const { t } = useTranslation();

  // Committed container levels (root first). The active question builds the
  // CURRENT level (index = committed.length). A leaf terminates the chain.
  const [committed, setCommitted] = useState<ContainerStep[]>([]);
  // The active level's in-progress label + qty.
  const [label, setLabel] = useState("");
  const [qty, setQty] = useState("");
  // Terminal answers (set once the manager reaches the leaf question).
  const [terminated, setTerminated] = useState(false);
  const [leafSize, setLeafSize] = useState(""); // raw / cleaning-opt-in size amount
  const [leafMeasure, setLeafMeasure] = useState(""); // raw / cleaning-opt-in measure
  // Cleaning opt-in: has the manager chosen to add a weight/volume size?
  const [cleaningAddSize, setCleaningAddSize] = useState(false);

  const isNonRaw = skuClass !== "raw";
  const selectedMeasure = measureUnits.find((m) => m.label === leafMeasure) ?? null;
  const leafIsNonWeight = selectedMeasure != null && selectedMeasure.dimension !== "weight";

  const defaultLabelFor = defaultWizardLevelLabel;

  // ── Assemble the emitted chain from current state (pure) ──────────────────
  const assembled: StarterChainLevel[] | null = useMemo(() => {
    if (!terminated) return null;

    const containerLevels: StarterChainLevel[] = committed.map((c, i) => ({
      label: c.label.trim() || defaultLabelFor(i),
      containsQty: Number(c.qty),
      containsIndex: i + 1, // points at the next level down
      containsMeasureUnit: null,
    }));

    // The active (current) level is the one being terminated. Its label/qty are
    // the CONTAINER wrapping the leaf when raw+size or cleaning+size; for a bare
    // count leaf the current level IS the count-leaf container.
    const curIndex = committed.length;
    const curLabel = label.trim() || defaultLabelFor(curIndex);
    const curQty = Number(qty);

    if (isNonRaw && !(skuClass === "cleaning" && cleaningAddSize)) {
      // Bare count leaf: the current level holds `curQty` of the count measure.
      // (packaging / misc always; cleaning when the size opt-in is OFF.)
      if (!Number.isFinite(curQty) || curQty <= 0) return null;
      const countLeaf: StarterChainLevel = {
        label: curLabel,
        containsQty: curQty,
        containsIndex: null,
        containsMeasureUnit: COUNT_LEAF_MEASURE,
      };
      return [...containerLevels, countLeaf];
    }

    // Size leaf (raw always; cleaning when opt-in ON): the current level is a
    // CONTAINER holding `curQty` of a final leaf that measures `leafSize`
    // `leafMeasure`. Two levels are appended for the terminal step.
    const size = Number(leafSize);
    const measure = leafMeasure.trim();
    if (!Number.isFinite(curQty) || curQty <= 0) return null;
    if (!Number.isFinite(size) || size <= 0 || measure === "") return null;

    const containerOfLeaf: StarterChainLevel = {
      label: curLabel,
      containsQty: curQty,
      containsIndex: curIndex + 1, // points at the size leaf we append next
      containsMeasureUnit: null,
    };
    const sizeLeaf: StarterChainLevel = {
      // Depth-distinct default: at leaf depth curIndex+1 this can never repeat
      // the container-of-leaf's default (curIndex) or any committed level's.
      label: defaultLabelFor(curIndex + 1),
      containsQty: size,
      containsIndex: null,
      containsMeasureUnit: measure,
    };
    return [...containerLevels, containerOfLeaf, sizeLeaf];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, label, qty, terminated, leafSize, leafMeasure, cleaningAddSize, skuClass]);

  // Push the assembled chain up whenever it changes (controlled-child sync).
  useEffect(() => {
    onChange(assembled);
    // onChange is stable enough (parent passes an inline cb); we key on the
    // assembled value, which is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembled]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const qtyValid = Number.isFinite(Number(qty)) && Number(qty) > 0;

  const packFormatListId = "pack-format-suggestions";

  const addAnotherContainer = () => {
    if (!qtyValid) return;
    setCommitted((c) => [...c, { label, qty }]);
    setLabel("");
    setQty("");
    setTerminated(false);
  };

  const terminate = () => {
    if (!qtyValid) return;
    setTerminated(true);
  };

  const editFrom = (index: number) => {
    // Re-open a committed level: drop it + everything below, restore its values
    // into the active question, and un-terminate.
    setCommitted((c) => c.slice(0, index));
    const step = committed[index];
    if (step) {
      setLabel(step.label);
      setQty(step.qty);
    }
    setTerminated(false);
  };

  const resetTerminal = () => {
    setTerminated(false);
    setCleaningAddSize(false);
    setLeafSize("");
    setLeafMeasure("");
  };

  const curIndex = committed.length;

  return (
    <div className="flex flex-col gap-3">
      <datalist id={packFormatListId}>
        {packFormats.map((p) => (
          <option key={p.id} value={p.label} />
        ))}
      </datalist>

      {/* Class hint (reuses the PR-A class-hint keys). */}
      <p className="text-xs text-co-text-muted">
        {t(`admin.skus.class_hint.${skuClass}` as TranslationKey)}
      </p>

      {/* Answered container levels collapse to summary lines (D8). */}
      {committed.length > 0 ? (
        <div className="flex flex-col gap-1">
          {committed.map((c, i) => (
            <button
              key={i}
              type="button"
              disabled={busy}
              onClick={() => editFrom(i)}
              className="text-left"
              aria-label={t("admin.skus.wizard.edit_level")}
            >
              <SummaryLine
                text={`${i + 1}. ${c.label.trim() || defaultLabelFor(i)} · ${t("admin.skus.wizard.holds", { n: c.qty })}`}
              />
            </button>
          ))}
        </div>
      ) : null}

      {!terminated ? (
        <>
          {/* Q1 + Q2 for the current level. */}
          <QuestionBlock
            title={curIndex === 0 ? t("admin.skus.wizard.q_comes_in") : t("admin.skus.wizard.q_inside")}
          >
            <label className="block">
              <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.wizard.label_label")}</span>
              <input
                className={fieldCls}
                list={packFormatListId}
                value={label}
                disabled={busy}
                placeholder={defaultLabelFor(curIndex)}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.wizard.q_how_many")}</span>
              <input
                className={fieldCls}
                type="number"
                min={1}
                step="any"
                inputMode="decimal"
                value={qty}
                disabled={busy}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
          </QuestionBlock>

          {/* Branch: another container inside OR terminate (class-aware). */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !qtyValid}
              onClick={addAnotherContainer}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50"
            >
              {t("admin.skus.wizard.add_inner")}
            </button>
            <button
              type="button"
              disabled={busy || !qtyValid}
              onClick={terminate}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold/70 px-3 text-xs font-bold text-co-text hover:bg-co-gold disabled:opacity-50"
            >
              {isNonRaw ? t("admin.skus.wizard.thats_it") : t("admin.skus.wizard.smallest")}
            </button>
          </div>
          {!qtyValid && (label !== "" || qty !== "") ? (
            <p className="text-[11px] text-co-text-muted">{t("admin.skus.wizard.need_qty")}</p>
          ) : null}
        </>
      ) : (
        // ── Terminal step (class-aware) ──────────────────────────────────────
        <QuestionBlock title={terminalTitle(skuClass, cleaningAddSize, t)}>
          {isNonRaw && !(skuClass === "cleaning" && cleaningAddSize) ? (
            // Bare count leaf — nothing to ask. Show what it resolved to + the
            // cleaning opt-in when applicable.
            <>
              <p className="text-xs text-co-text-muted">
                {t("admin.skus.wizard.count_leaf_note", {
                  label: (label.trim() || defaultLabelFor(curIndex)),
                  n: qty || "?",
                })}
              </p>
              {skuClass === "cleaning" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCleaningAddSize(true)}
                  className="inline-flex min-h-[44px] w-fit items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50"
                >
                  {t("admin.skus.wizard.add_size")}
                </button>
              ) : null}
            </>
          ) : (
            // Size leaf (raw always; cleaning opt-in).
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.field.each_size")}</span>
                  <input
                    className={fieldCls}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={leafSize}
                    disabled={busy}
                    onChange={(e) => setLeafSize(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.field.each_measure")}</span>
                  <select
                    className={fieldCls}
                    value={leafMeasure}
                    disabled={busy}
                    onChange={(e) => setLeafMeasure(e.target.value)}
                  >
                    <option value="">{t("admin.skus.wizard.pick_measure")}</option>
                    {measureUnits.map((m) => (
                      <option key={m.id} value={m.label}>{m.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              {/* Raw count/volume leaf needs an avg oz per each to be oz-resolvable. */}
              {leafIsNonWeight ? (
                <label className="block">
                  <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.field.avg_oz_per_each")}</span>
                  <input
                    className={fieldCls}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={avgOzPerEach}
                    disabled={busy}
                    onChange={(e) => onAvgOzPerEachChange(e.target.value)}
                  />
                  <span className="mt-1 block text-[11px] text-co-text-muted">{t("admin.skus.avg_oz_per_each_hint")}</span>
                </label>
              ) : null}
              {skuClass === "cleaning" && cleaningAddSize ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setCleaningAddSize(false); setLeafSize(""); setLeafMeasure(""); }}
                  className="inline-flex min-h-[44px] w-fit items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50"
                >
                  {t("admin.skus.wizard.skip_size")}
                </button>
              ) : null}
            </>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={resetTerminal}
            className="inline-flex min-h-[44px] w-fit items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text-muted hover:text-co-text disabled:opacity-50"
          >
            {t("admin.skus.wizard.back")}
          </button>
        </QuestionBlock>
      )}
    </div>
  );
}

function terminalTitle(
  skuClass: SkuClass,
  cleaningAddSize: boolean,
  t: (key: TranslationKey, params?: Record<string, string>) => string,
): string {
  if (skuClass === "raw" || (skuClass === "cleaning" && cleaningAddSize)) {
    return t("admin.skus.wizard.q_how_big");
  }
  return t("admin.skus.wizard.q_smallest_title");
}
