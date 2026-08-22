"use client";

/**
 * SkuBuilder — the ONE SKU editor/builder surface (SKU Builder streamline,
 * design 2026-07-27). Replaces the SkuForm-edit / SkuPackChainPanel /
 * SkuCostPanel mutual-exclusion fork (a manager could not see the chain while
 * renaming a SKU) AND serves as the Add form. Three sections co-render:
 *
 *   Section A — Identity & sourcing: name, class, vendor, location, item#,
 *     source, lead time, notes. Non-blocking name-collision warning on the name
 *     (design §1 dedupe: 11 dup pairs live — a warning, never a hard gate).
 *   Section B — Pack truth (the chain is the only pack vocabulary):
 *     · CHAINED SKU  → inline chain builder, seeded from the server-passed chain
 *       (no lazy GET), with a "chain unverified" badge on the section header.
 *     · UNCHAINED    → the CLASS-AWARE guided WIZARD (SKU top-tier PR-B): plain
 *       manager questions ("What does it come in? How many per?") that STOP
 *       SOONER for non-raw classes and emit a chain. A bare unchained save stays
 *       valid (the wizard is a triggered flow — no chain until the manager
 *       builds one). The legacy quick-pack fields are GONE; the flat columns are
 *       DERIVED from the chain server-side on save (sync-on-save for the 3
 *       laggard consumers until PR-C migrates them).
 *   Section C — Cost & usage (edit mode only): the read-only SkuCostPanel
 *     (cost/oz, in-stock, deliveries, used-by) with record-price as a sub-action.
 *
 * Pure presentational + local form state. The PARENT owns POST/PATCH + step-up +
 * router.refresh: onSubmit hands back the identity/quick-pack payload PLUS an
 * optional chain draft (add flow → one atomic request); onSaveChain persists an
 * edited chain in edit mode (the SKU already exists → the pack-chain route).
 * canSubmit = name && !busy (the pack_format required-field gate is removed —
 * design §1, builder-seat find).
 */

import { useMemo, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { RegistryOption, MeasureUnitOption, SkuView } from "@/lib/admin/skus";
import { SKU_CLASSES } from "@/lib/admin/catalog-shared";
import type { SkuClass } from "@/lib/admin/catalog-shared";
import { CUSHION_BY_CLASS, parStepFor } from "@/lib/dynamic-pars-shared";
import {
  skuNameCollisions,
  type StarterChainLevel,
  type SkuNameCollisionCandidate,
} from "@/lib/admin/catalog-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import { PackChainWizard } from "./PackChainWizard";
import { SkuCostPanel, type SkuCostInfo } from "./SkuCostPanel";
import { SkuLocationOverlay, type LocationSkuOverlayView } from "./SkuLocationOverlay";
import type { SkuReceivingLedger, SkuConsumption } from "@/lib/admin/cost";

// SKU form value/prop types (SKU top-tier PR-C: SkuForm was deleted — these moved
// here, the one editor surface, so every parent keeps a single import site).
export interface SkuFormVendorOption {
  id: string;
  name: string;
}
export interface SkuFormLocationOption {
  id: string;
  name: string;
}
/** A product this SKU can be a member of (migration 0179). */
export interface SkuFormProductOption {
  id: string;
  name: string;
}

/** Payload shape handed to the parent — matches the route contracts.
 *  each_container_label is retired from the UI (SKU Builder streamline design §4,
 *  Phase 1): no form sends it, so createSku/updateSku never touch the column and
 *  existing DB values are preserved for the legacy recipe-math reader. */
export interface SkuFormValues {
  vendorId: string | null;
  locationId: string | null;
  name: string;
  packFormat: string;
  /** Optional since PR-B: SkuBuilder OMITS the flat pack trio (server-derived from
   *  the chain via sync-on-save; a key-present null would CLEAR the columns on
   *  every identity edit — the PATCH route treats `"key" in body` null as "clear"). */
  unitsPerPack?: number | null;
  eachSize?: number | null;
  eachMeasure?: string | null;
  avgOzPerEach: number | null;
  itemNumber: string | null;
  sourceUrl: string | null;
  leadTimeDays: number | null;
  weekdayPar: number | null;
  weekendPar: number | null;
  notes: string | null;
  skuClass: SkuClass;
  /** Product membership (0179). OMITTED whenever no product exists to pick — an
   *  absent key leaves the column alone, which is what keeps this form legal
   *  before migration 0179 is applied (GATE M1) and identical to today. */
  productId?: string | null;
  /** Ordering rhythm (0182). Same discipline as productId above: both keys are
   *  OMITTED until the columns exist, so this form stays legal before GATE M1. */
  cushionClass?: string | null;
  parStep?: number | null;
}

const fieldCls =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";
const chainFieldCls =
  "min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-60";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-co-text">{label}</span>
      {children}
    </label>
  );
}

function SectionHeader({ title, badge }: { title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">{title}</h3>
      {badge}
    </div>
  );
}

/** One editor row for the inline chain builder: label, qty, and a link that is
 *  EITHER a level index OR a measure unit. Mirrors SkuPackChainPanel's shape. */
interface EditorLevel {
  label: string;
  qty: string;
  /** "level:<index>" | "measure:<label>" | "" (unset). */
  link: string;
}

function toEditorLevels(levels: PackChainLevel[]): EditorLevel[] {
  const indexById = new Map(levels.map((l, i) => [l.id, i]));
  return levels.map((l) => ({
    label: l.label,
    qty: String(l.containsQty),
    link:
      l.containsLevelId != null && indexById.has(l.containsLevelId)
        ? `level:${indexById.get(l.containsLevelId)}`
        : l.containsMeasureUnit != null
          ? `measure:${l.containsMeasureUnit}`
          : "",
  }));
}

/** Assemble the index-linked payload from editor rows (shared add + edit). */
function editorRowsToPayload(rows: EditorLevel[]): StarterChainLevel[] {
  return rows.map((row) => {
    const qty = Number(row.qty);
    if (row.link.startsWith("level:")) {
      return { label: row.label.trim(), containsQty: qty, containsIndex: Number(row.link.slice("level:".length)), containsMeasureUnit: null };
    }
    if (row.link.startsWith("measure:")) {
      return { label: row.label.trim(), containsQty: qty, containsIndex: null, containsMeasureUnit: row.link.slice("measure:".length) };
    }
    return { label: row.label.trim(), containsQty: qty, containsIndex: null, containsMeasureUnit: null };
  });
}

export function SkuBuilder({
  initial,
  initialChain,
  initialChainUnverified,
  fixedVendorId,
  initialProductId,
  parsFieldsReady = false,
  vendors,
  locations,
  products,
  packFormats,
  measureUnits,
  actorLevel,
  busy,
  errorMsg,
  submitLabel,
  allSkus,
  cost,
  ledger,
  consumption,
  overlays,
  onSubmit,
  onSaveChain,
  onCancel,
}: {
  /** Existing SKU when editing; undefined when adding. */
  initial?: SkuView;
  /** Server-seeded active chain (no lazy GET); null when the SKU has no chain. */
  initialChain?: PackChainLevel[] | null;
  /** Server flag: the seeded chain fails reachability/termination. */
  initialChainUnverified?: boolean;
  /** When set, vendor is fixed (vendor-detail card) → no vendor dropdown. */
  fixedVendorId?: string | null;
  /** This SKU's current product membership (0179), seeded by the page from the
   *  product registry — vendor_items.product_id is deliberately NOT added to the
   *  SKU loader's column list while migration 0179 is unapplied. */
  initialProductId?: string | null;
  vendors?: SkuFormVendorOption[];
  locations: SkuFormLocationOption[];
  /** Products this SKU may join (0179). Empty/absent → no picker is rendered and
   *  no productId key is sent: products exist only where plurality does. */
  products?: SkuFormProductOption[];
  /** True once migration 0182 (GATE M1) is applied. Gates the "Ordering rhythm"
   *  group: while false the group does not render and NEITHER key is sent. */
  parsFieldsReady?: boolean;
  packFormats: RegistryOption[];
  measureUnits: MeasureUnitOption[];
  actorLevel: number;
  busy: boolean;
  errorMsg: string | null;
  submitLabel: string;
  /** All SKUs (for the non-blocking name-collision warning). Optional. */
  allSkus?: SkuNameCollisionCandidate[];
  /** Section C read data (edit mode). */
  cost?: SkuCostInfo;
  ledger?: SkuReceivingLedger | null;
  consumption?: SkuConsumption | null;
  /** VO-7 per-location overlay rows for THIS SKU (edit mode). Presence of this prop
   *  (+ locations + editing an existing SKU) renders the location overlay section.
   *  Absent = the overlay is not surfaced (e.g. add flow). */
  overlays?: LocationSkuOverlayView[];
  /** Hands identity + quick-pack values + an optional chain draft (add flow). */
  onSubmit: (values: SkuFormValues, chain: StarterChainLevel[] | null) => void;
  /** Edit-mode chain save (SKU exists → pack-chain route). Returns ok. When
   *  `avgOzPerEach` is provided (the wizard's raw count/volume leaf), the parent
   *  persists it on the SKU BEFORE the chain save so a count leaf is
   *  oz-resolvable at validation time (undefined → the chain editor's path,
   *  which never changes the avg). */
  onSaveChain?: (levels: StarterChainLevel[], avgOzPerEach?: number | null) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = initial !== undefined;
  const hasChain = (initialChain?.length ?? 0) > 0;

  // ── Section A state ──
  const initialVendor =
    initial?.vendorId ?? (fixedVendorId !== undefined ? fixedVendorId : null);
  const [vendorId, setVendorId] = useState<string>(initialVendor ?? "");
  const [locationId, setLocationId] = useState<string>(initial?.locationId ?? "");
  // Product membership (0179). "" = no product = implicit singleton, and it is
  // NEVER defaulted to a product — plurality is declared, not assumed.
  const [productId, setProductId] = useState<string>(initialProductId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [skuClass, setSkuClass] = useState<SkuClass>(initial?.skuClass ?? "raw");
  // avg_oz_per_each rides the submission (a raw count/volume leaf needs it so the
  // chain is oz-resolvable). The wizard drives it for the leaf; kept here so it
  // ships in the SAME create/save payload the chain does.
  const [avgOzPerEach, setAvgOzPerEach] = useState(
    initial?.avgOzPerEach != null ? String(initial.avgOzPerEach) : "",
  );
  const [itemNumber, setItemNumber] = useState(initial?.itemNumber ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? "");
  const [leadTime, setLeadTime] = useState(initial?.leadTimeDays != null ? String(initial.leadTimeDays) : "");
  const [weekdayPar, setWeekdayPar] = useState(initial?.weekdayPar != null ? String(initial.weekdayPar) : "");
  const [weekendPar, setWeekendPar] = useState(initial?.weekendPar != null ? String(initial.weekendPar) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Ordering rhythm (0182). Free text by design — the cushion vocabulary is deliberately
  // un-enumerated (plan D6), so the datalist SUGGESTS the shipped classes without
  // forbidding a new one.
  const [cushionClass, setCushionClass] = useState(initial?.cushionClass ?? "");
  const [parStep, setParStep] = useState(initial?.parStep != null ? String(initial.parStep) : "");

  // ── Section B wizard state (unchained path — add + unchained edit) ──
  // The wizard is a TRIGGERED flow (D4): closed until the manager taps
  // "Add ordering info". It emits the assembled chain via onChange.
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardChain, setWizardChain] = useState<StarterChainLevel[] | null>(null);
  const [wizardBusy, setWizardBusy] = useState(false);
  const [wizardErr, setWizardErr] = useState<string | null>(null);

  // ── Section B chain-editor state (edit mode; seeded from server) ──
  const [chainOpen, setChainOpen] = useState(false);
  const [chainRows, setChainRows] = useState<EditorLevel[]>([]);
  const [chainBusy, setChainBusy] = useState(false);
  const [chainErr, setChainErr] = useState<string | null>(null);
  const [chainSavedTick, setChainSavedTick] = useState(0); // bump on save to refresh display copy

  const parseNum = (s: string): number | null => {
    const trimmed = s.trim();
    return trimmed === "" ? null : Number(trimmed);
  };

  // The par-step placeholder (plan D7): what parStepFor would infer from the pars AS
  // TYPED, so the manager sees the bootstrap value update live and only overrides it when
  // it is actually wrong. One authority — the same fn the band and the rounding use.
  const inferredParStep = parStepFor({
    parStep: null,
    weekdayPar: parseNum(weekdayPar),
    weekendPar: parseNum(weekendPar),
  });

  // P7: compares against the vendor SELECTED IN THE FORM (vendorId state), so retargeting
  // a SKU to another vendor re-classifies the collision live rather than on save.
  const collisions = useMemo(
    () =>
      allSkus
        ? skuNameCollisions(name, allSkus, initial?.id ?? null, vendorId || null)
        : { duplicates: [], twins: [] },
    [name, allSkus, initial?.id, vendorId],
  );

  const showVendorDropdown = vendors !== undefined;
  // No products yet = nothing to join, so no picker AND no productId key on the
  // payload (the M1 gate: the column may not exist yet).
  const showProductPicker = products !== undefined && products.length > 0;
  const canSubmit = name.trim() !== "" && !busy; // pack_format gate removed (design §1)

  const assembleValues = (): SkuFormValues => ({
    vendorId: showVendorDropdown ? (vendorId || null) : (fixedVendorId ?? null),
    locationId: locationId || null,
    name: name.trim(),
    // The flat pack fields are no longer authored in the UI — they are DERIVED
    // from the wizard's chain server-side on save (sync-on-save, PR-B). The trio
    // is OMITTED (not null): the PATCH route treats a key-present null as
    // "clear", so sending nulls would wipe existing legacy pack data on every
    // identity edit. Absent keys skip the columns entirely (create coalesces
    // absent → null, which is the correct bare "No pack info" state). We still
    // send a non-empty pack_format because createSku requires one; the server
    // sync overwrites it from the derived chain when a chain saves.
    packFormat: initial?.packFormat?.trim() || "Each (no case)",
    // each_container_label retired from the builder UI (design §4) — omitted from
    // SkuFormValues, so createSku/updateSku never touch the column.
    avgOzPerEach: parseNum(avgOzPerEach),
    itemNumber: itemNumber.trim() || null,
    sourceUrl: sourceUrl.trim() || null,
    leadTimeDays: parseNum(leadTime),
    weekdayPar: parseNum(weekdayPar),
    weekendPar: parseNum(weekendPar),
    notes: notes.trim() || null,
    skuClass,
    ...(showProductPicker ? { productId: productId || null } : {}),
    // Both keys omitted entirely until migration 0182 applies — an absent key never
    // touches a column that may not exist (the productId precedent above).
    ...(parsFieldsReady
      ? { cushionClass: cushionClass.trim() || null, parStep: parseNum(parStep) }
      : {}),
  });

  const submit = () => {
    if (!canSubmit) return;
    // ADD flow: the wizard's assembled chain (or null when the manager left it
    // untouched — a bare save stays valid). The server derives+syncs the flat
    // pack fields from this chain. EDIT-mode chain edits go through onSaveChain
    // (the SKU already exists), never here.
    const chainDraft = !isEdit ? wizardChain : null;
    onSubmit(assembleValues(), chainDraft);
  };

  // ── Chain editor actions (edit mode) ──
  const displayChain = useMemo(
    () => initialChain ?? [],
    // chainSavedTick is intentional: after a save the parent refreshes and
    // re-seeds initialChain; the tick keeps the memo honest without a stale read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialChain, chainSavedTick],
  );

  const startChainEdit = () => {
    setChainRows(displayChain.length > 0 ? toEditorLevels(displayChain) : [{ label: "", qty: "", link: "" }]);
    setChainOpen(true);
    setChainErr(null);
  };
  const addChainRow = () => setChainRows((r) => [...r, { label: "", qty: "", link: "" }]);
  const removeChainRow = (i: number) =>
    setChainRows((r) => {
      const next = r.filter((_, idx) => idx !== i);
      return next.map((row) => {
        if (!row.link.startsWith("level:")) return row;
        const idx = Number(row.link.slice("level:".length));
        if (idx === i) return { ...row, link: "" };
        return { ...row, link: idx > i ? `level:${idx - 1}` : row.link };
      });
    });
  const setChainRow = (i: number, patch: Partial<EditorLevel>) =>
    setChainRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const saveChain = async () => {
    if (chainBusy || !onSaveChain) return;
    setChainErr(null);
    const payload = editorRowsToPayload(chainRows);
    setChainBusy(true);
    const ok = await onSaveChain(payload);
    setChainBusy(false);
    if (ok) {
      setChainOpen(false);
      setChainSavedTick((n) => n + 1);
    } else {
      setChainErr(errorMsg ?? t("admin.skus.error.generic"));
    }
  };

  // ── Wizard save (UNCHAINED EDIT: the SKU exists → the pack-chain route, which
  //    also syncs the flat fields server-side). Add flow never reaches here — it
  //    ships the wizard chain in the create payload via submit(). ──
  const saveWizardChain = async () => {
    if (wizardBusy || !onSaveChain || !wizardChain) return;
    setWizardErr(null);
    setWizardBusy(true);
    // Pass the avg so the parent persists it on the SKU before the chain save —
    // a raw count/volume leaf needs it to pass validation (leaf_needs_avg).
    const ok = await onSaveChain(wizardChain, parseNum(avgOzPerEach));
    setWizardBusy(false);
    if (ok) {
      setWizardOpen(false);
      setWizardChain(null);
    } else {
      setWizardErr(errorMsg ?? t("admin.skus.error.generic"));
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-lg border-2 border-dashed border-co-border p-3">
      {/* ── Section A — Identity & sourcing ── */}
      <section className="flex flex-col gap-3">
        <SectionHeader title={t("admin.skus.builder.section_identity")} />

        {showVendorDropdown ? (
          <Labeled label={t("admin.skus.field.vendor")}>
            <select className={fieldCls} value={vendorId} disabled={busy} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">{t("admin.skus.manual")}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </Labeled>
        ) : null}

        <Labeled label={t("admin.skus.field.name")}>
          <input className={fieldCls} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        </Labeled>
        {/* P7 — two classes, rendered distinctly. Same-vendor is a real duplicate (warn
            tone); cross-vendor is the BACKUP twin the multi-vendor doctrine asks for, so
            it is affirmed, not nagged about. Warning on correct behavior is how warnings
            get ignored. */}
        {collisions.duplicates.length > 0 ? (
          <p className="text-xs font-semibold text-co-cta-text" role="status">
            {t("admin.skus.builder.name_collision", { names: collisions.duplicates.map((c) => c.name).join(", ") })}
          </p>
        ) : null}
        {collisions.twins.length > 0 ? (
          <p className="text-xs font-semibold text-co-confirm-text" role="status">
            {t("admin.skus.builder.name_twin", {
              vendors: [...new Set(collisions.twins.map((c) => c.vendorName).filter((v): v is string => v != null))].join(", "),
            })}
          </p>
        ) : null}

        <Labeled label={t("admin.skus.field.sku_class")}>
          <select className={fieldCls} value={skuClass} disabled={busy} onChange={(e) => setSkuClass(e.target.value as SkuClass)}>
            {SKU_CLASSES.map((c) => (
              <option key={c} value={c}>{t(`admin.skus.sku_class.${c}` as TranslationKey)}</option>
            ))}
          </select>
        </Labeled>

        {/* Product membership (0179) — only when a product exists to join. The
            first option is an explicit "no product": a SKU with no product is an
            implicit singleton, which is the normal case, never a gap to fill. */}
        {showProductPicker ? (
          <Labeled label={t("admin.skus.field.product")}>
            <select className={fieldCls} value={productId} disabled={busy} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{t("admin.skus.product_none")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Labeled>
        ) : null}

        <Labeled label={t("admin.skus.field.location")}>
          <select className={fieldCls} value={locationId} disabled={busy} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t("admin.skus.global")}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Labeled>

        <Labeled label={t("admin.skus.field.item_number")}>
          <input className={fieldCls} value={itemNumber} disabled={busy} onChange={(e) => setItemNumber(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.skus.field.source_url")}>
          <input className={fieldCls} type="url" value={sourceUrl} disabled={busy} onChange={(e) => setSourceUrl(e.target.value)} />
        </Labeled>
        <Labeled label={t("admin.skus.field.lead_time")}>
          <input className={fieldCls} type="number" min={0} step={1} inputMode="numeric" value={leadTime} disabled={busy} onChange={(e) => setLeadTime(e.target.value)} />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label={t("admin.skus.field.weekday_par")}>
            <input
              className={fieldCls}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={weekdayPar}
              disabled={busy}
              aria-label={t("admin.skus.field.weekday_par")}
              onChange={(e) => setWeekdayPar(e.target.value)}
            />
          </Labeled>
          <Labeled label={t("admin.skus.field.weekend_par")}>
            <input
              className={fieldCls}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={weekendPar}
              disabled={busy}
              aria-label={t("admin.skus.field.weekend_par")}
              onChange={(e) => setWeekendPar(e.target.value)}
            />
          </Labeled>
        </div>
        <p className="text-xs text-co-text-muted">{t("admin.skus.par_hint")}</p>

        {/* ── Ordering rhythm (0182, GATE M1) — cushion class + par step ──
            Hidden entirely until the migration applies, so nothing here can send a key
            for a column that does not exist. Cushion class is free text WITH a datalist,
            never a hard select: the vocabulary is deliberately un-enumerated (plan D6,
            the 0177 precedent), so the shipped classes are suggestions, not a fence. */}
        {parsFieldsReady ? (
          <div className="flex flex-col gap-3 rounded-lg border-2 border-co-border p-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-co-text-muted">
              {t("admin.skus.rhythm.group")}
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <Labeled label={t("admin.skus.field.cushion_class")}>
                <input
                  className={fieldCls}
                  list="sku-cushion-classes"
                  value={cushionClass}
                  disabled={busy}
                  maxLength={40}
                  placeholder={t("admin.skus.cushion_class_placeholder")}
                  aria-label={t("admin.skus.field.cushion_class")}
                  onChange={(e) => setCushionClass(e.target.value)}
                />
                <datalist id="sku-cushion-classes">
                  {Object.keys(CUSHION_BY_CLASS).map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Labeled>
              <Labeled label={t("admin.skus.field.par_step")}>
                <input
                  className={fieldCls}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={parStep}
                  disabled={busy}
                  placeholder={t("admin.skus.par_step_placeholder", { n: String(inferredParStep) })}
                  aria-label={t("admin.skus.field.par_step")}
                  onChange={(e) => setParStep(e.target.value)}
                />
              </Labeled>
            </div>
            <p className="text-xs text-co-text-muted">{t("admin.skus.rhythm_hint")}</p>
          </div>
        ) : null}

        <Labeled label={t("admin.skus.field.notes")}>
          <textarea className={fieldCls} rows={2} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
        </Labeled>
      </section>

      {/* ── Section B — Pack truth (the chain is the only pack vocabulary) ── */}
      <section className="flex flex-col gap-3 border-t-2 border-co-border pt-3">
        <SectionHeader
          title={t("admin.skus.builder.section_pack")}
          badge={
            isEdit && hasChain && initialChainUnverified ? (
              <span className="inline-flex items-center rounded-full bg-co-danger-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-cta-text">
                {t("admin.skus.chain.unverified")}
              </span>
            ) : undefined
          }
        />

        {isEdit && hasChain ? (
          // CHAINED SKU → inline chain builder (seeded, no lazy GET).
          <div className="flex flex-col gap-2">
            <p className="text-xs text-co-text-muted">{t("admin.skus.builder.chain_intro")}</p>
            {!chainOpen ? (
              <>
                <ul className="flex flex-col gap-1">
                  {orderedForDisplay(displayChain).map((l) => (
                    <li key={l.id} className="rounded-md border-2 border-co-border-2 px-2 py-1 text-xs text-co-text">
                      <span className="font-bold">{l.label}</span>
                      {" → "}
                      {l.containsMeasureUnit != null
                        ? `${l.containsQty} ${l.containsMeasureUnit}`
                        : `${l.containsQty} ${labelOf(displayChain, l.containsLevelId)}`}
                    </li>
                  ))}
                </ul>
                {onSaveChain ? (
                  <button
                    type="button"
                    onClick={startChainEdit}
                    disabled={busy}
                    className="inline-flex min-h-[44px] w-fit items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50"
                  >
                    {t("admin.skus.builder.chain_toggle_show")}
                  </button>
                ) : null}
              </>
            ) : (
              <ChainEditor
                rows={chainRows}
                measureUnits={measureUnits}
                busy={chainBusy}
                err={chainErr}
                onSet={setChainRow}
                onAdd={addChainRow}
                onRemove={removeChainRow}
                onSave={() => void saveChain()}
                onCancel={() => { setChainOpen(false); setChainErr(null); }}
              />
            )}
          </div>
        ) : (
          // UNCHAINED (add flow, or an unchained edit) → the class-aware WIZARD.
          // A triggered flow (D4): closed until "Add ordering info" is tapped so
          // a bare save stays valid ("add pack detail later").
          <div className="flex flex-col gap-3">
            {!wizardOpen ? (
              <>
                <p className="text-xs text-co-text-muted">{t("admin.skus.builder.add_detail_later")}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setWizardOpen(true); setWizardErr(null); }}
                  className="inline-flex min-h-[44px] w-fit items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                >
                  {t("admin.skus.builder.add_ordering_info")}
                </button>
              </>
            ) : (
              <>
                <PackChainWizard
                  skuClass={skuClass}
                  packFormats={packFormats}
                  measureUnits={measureUnits}
                  avgOzPerEach={avgOzPerEach}
                  onAvgOzPerEachChange={setAvgOzPerEach}
                  busy={busy || wizardBusy}
                  onChange={setWizardChain}
                />
                {wizardErr ? <p className="text-sm text-co-cta-text">{wizardErr}</p> : null}
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy || wizardBusy}
                    onClick={() => { setWizardOpen(false); setWizardChain(null); setWizardErr(null); }}
                    className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50"
                  >
                    {t("admin.skus.cancel")}
                  </button>
                  {/* Unchained EDIT: the SKU exists → save the chain now (its own
                      route + step-up + server-side flat sync). ADD flow ships the
                      chain in the create payload via the main Save button below. */}
                  {isEdit && onSaveChain ? (
                    <button
                      type="button"
                      disabled={busy || wizardBusy || !wizardChain}
                      onClick={() => void saveWizardChain()}
                      className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
                    >
                      {t("admin.skus.chain.save")}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── Section C — Cost & usage (edit mode only; read + record-price sub-action) ── */}
      {isEdit && cost ? (
        <section className="flex flex-col gap-2 border-t-2 border-co-border pt-3" aria-label={t("admin.skus.builder.cost_aria")}>
          <SectionHeader title={t("admin.skus.builder.section_cost")} />
          <SkuCostPanel
            skuId={initial!.id}
            cost={cost}
            ledger={ledger ?? null}
            consumption={consumption ?? null}
            canRecord={actorLevel >= 6}
          />
        </section>
      ) : null}

      {/* ── Section D — Per-location overlay (VO-7; edit mode only, its own
          default-collapsed CollapsibleSection). Renders only when overlays +
          locations are present and we're editing an existing SKU. ── */}
      {isEdit && overlays !== undefined && locations.length > 0 ? (
        <div className="border-t-2 border-co-border pt-3">
          <SkuLocationOverlay skuId={initial!.id} locations={locations} overlays={overlays} />
        </div>
      ) : null}

      {errorMsg ? <p className="text-sm text-co-cta-text">{errorMsg}</p> : null}

      <div className="flex justify-end gap-2 border-t-2 border-co-border pt-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("admin.skus.cancel")}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/** Inline chain editor (edit mode) — mirrors SkuPackChainPanel's editor rows. */
function ChainEditor({
  rows,
  measureUnits,
  busy,
  err,
  onSet,
  onAdd,
  onRemove,
  onSave,
  onCancel,
}: {
  rows: EditorLevel[];
  measureUnits: MeasureUnitOption[];
  busy: boolean;
  err: string | null;
  onSet: (i: number, patch: Partial<EditorLevel>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="rounded-md border-2 border-co-border-2 p-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.chain.level_label")}</span>
              <input className={chainFieldCls} value={row.label} disabled={busy} placeholder={t("admin.skus.chain.level_label_ph")} onChange={(e) => onSet(i, { label: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.chain.contains_qty")}</span>
              <input className={chainFieldCls} type="number" min={0} step="any" inputMode="decimal" value={row.qty} disabled={busy} onChange={(e) => onSet(i, { qty: e.target.value })} />
            </label>
          </div>
          <label className="mt-2 block">
            <span className="text-[11px] font-bold text-co-text-muted">{t("admin.skus.chain.contains_link")}</span>
            <select className={chainFieldCls} value={row.link} disabled={busy} onChange={(e) => onSet(i, { link: e.target.value })}>
              <option value="">{t("admin.skus.chain.link_placeholder")}</option>
              <optgroup label={t("admin.skus.chain.link_levels")}>
                {rows.map((other, j) =>
                  j === i ? null : (
                    <option key={`level:${j}`} value={`level:${j}`}>
                      {other.label.trim() || t("admin.skus.chain.level_n", { n: j + 1 })}
                    </option>
                  ),
                )}
              </optgroup>
              <optgroup label={t("admin.skus.chain.link_measures")}>
                {measureUnits.map((m) => (
                  <option key={`measure:${m.label}`} value={`measure:${m.label}`}>{m.label}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="mt-2 flex justify-end">
            <button type="button" disabled={busy} onClick={() => onRemove(i)} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-cta-text disabled:opacity-50">
              {t("admin.skus.chain.remove_level")}
            </button>
          </div>
        </div>
      ))}
      <button type="button" disabled={busy} onClick={onAdd} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-dashed border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text disabled:opacity-50">
        {t("admin.skus.chain.add_level")}
      </button>
      {err ? <p className="text-sm text-co-cta-text">{err}</p> : null}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text disabled:opacity-50">
          {t("admin.skus.builder.chain_toggle_hide")}
        </button>
        <button type="button" disabled={busy} onClick={onSave} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50">
          {t("admin.skus.chain.save")}
        </button>
      </div>
    </div>
  );
}

/** Display order: root first (nobody points at it), following pointers down.
 *  Copied from SkuPackChainPanel (same pure walk) so the chained display reads
 *  case → log → oz. */
function orderedForDisplay(levels: PackChainLevel[]): PackChainLevel[] {
  if (levels.length === 0) return [];
  const byId = new Map(levels.map((l) => [l.id, l]));
  const pointedAt = new Set<string>();
  for (const l of levels) if (l.containsLevelId != null) pointedAt.add(l.containsLevelId);
  const root = levels.find((l) => !pointedAt.has(l.id));
  if (!root) return [...levels].sort((a, b) => a.displayOrdinal - b.displayOrdinal);
  const out: PackChainLevel[] = [];
  const seen = new Set<string>();
  let cur: PackChainLevel | undefined = root;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.containsLevelId != null ? byId.get(cur.containsLevelId) : undefined;
  }
  for (const l of levels) if (!seen.has(l.id)) out.push(l);
  return out;
}

function labelOf(levels: PackChainLevel[], id: string | null): string {
  if (id == null) return "";
  return levels.find((l) => l.id === id)?.label ?? "?";
}
