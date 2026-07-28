"use client";

/**
 * PackagesClient — the Catering KB Packages editor (/admin/catering/packages).
 *
 * Lists packages the server loaded (globals + the actor's locations, or all for
 * level 9+), each with a line-items sub-list. (≥6) can add a package, edit its
 * fields, deactivate/reactivate it, and add/remove freeform or spine-linked line
 * items. W1b adds:
 *   - Fixed lines: picker over catering-available items (PickerItem[]) or freeform
 *   - Choice slots: label + pick-N quantity, with eligible options added per-slot
 *   - Price-advice panel: GET /api/admin/catering/packages/[id]/recommend with a
 *     "use recommended" affordance that PATCHes the flat price via Tier A step-up
 *
 * Authority (matches the routes): create = Tier B; edit fields = Tier A;
 * deactivate = Tier B; add/remove line item = Tier A. A single busy + errorMsg
 * state guards all mutations. Before every mutation: if requestStepUp(tier) is
 * not "ok", return.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { formatCents } from "@/lib/i18n/format";
import { postJson, resolveErrorKey } from "@/components/admin/catering/shared";
import type { PackageView, PackageLocationOption } from "@/lib/admin/catering/packages";
import type { PickerItem } from "@/lib/admin/catering/package-pricing";
import { SummaryRow } from "@/components/ui/SummaryRow";
import { PackageForm, type PackageFormValues } from "./PackageForm";
import { PriceAdvicePanel } from "./PriceAdvicePanel";

const PACKAGE_MIN = 6; // catering.kb.packages.write — same floor the routes enforce

export function PackagesClient({
  packages,
  locations,
  pickerMenu,
  actorLevel,
}: {
  packages: PackageView[];
  locations: PackageLocationOption[];
  pickerMenu: PickerItem[];
  actorLevel: number;
}) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const canManage = actorLevel >= PACKAGE_MIN;

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Per-package refreshKey: incremented on successful mutations to trigger recommendation re-fetch.
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});
  // D7 browse multi-expand (mirrors SkuCatalogClient/CatalogClient): which non-editing
  // rows have their detail drawer open. Caller-owned Set so several can be open at once
  // and collapse preserves scroll. The drawer's PriceAdvicePanel + LineItemsSubList
  // lazy-render only when expanded → 0 advice-panel fetches on first paint (free perf).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bumpRefresh = (packageId: string) => {
    setRefreshKeys((prev) => ({ ...prev, [packageId]: (prev[packageId] ?? 0) + 1 }));
  };

  const create = async (values: PackageFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/catering/packages", values);
    setBusy(false);
    if (result.ok) {
      setAdding(false);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveEdit = async (id: string, values: PackageFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    // slug + location are identity fields — the edit PATCH sends fields only.
    const { locationId: _loc, ...fields } = values;
    void _loc;
    setBusy(true);
    const result = await postJson(`/api/admin/catering/packages/${id}`, fields, "PATCH");
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      bumpRefresh(id);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const toggleActive = async (pkg: PackageView) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/catering/packages/${pkg.id}`, { active: !pkg.active }, "PATCH");
    setBusy(false);
    if (result.ok) {
      setConfirmDeactivateId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  /** W1b: unified addLine — posts addLine concern (covers fixed+choice, spine-linked+freeform). */
  const addLine = async (
    packageId: string,
    payload: {
      slotType: "fixed" | "choice";
      ref?: { kind: "item" | "menu_item"; id: string } | null;
      description?: string | null;
      quantity: number;
    },
  ) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/packages/${packageId}`,
      { addLine: payload },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      bumpRefresh(packageId);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const addSlotOption = async (
    packageId: string,
    lineItemId: string,
    ref: { kind: "item" | "menu_item"; id: string },
  ) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/packages/${packageId}`,
      { addSlotOption: { lineItemId, ref } },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      bumpRefresh(packageId);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const removeSlotOption = async (packageId: string, optionId: string) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/packages/${packageId}`,
      { removeSlotOptionId: optionId },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      bumpRefresh(packageId);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const setOptionClassic = async (packageId: string, optionId: string, classic: boolean) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/packages/${packageId}`,
      { setOptionClassic: { optionId, classic } },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      bumpRefresh(packageId);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const removeLineItem = async (packageId: string, itemId: string) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/catering/packages/${packageId}`, { removeItemId: itemId }, "PATCH");
    setBusy(false);
    if (result.ok) {
      bumpRefresh(packageId);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const applyRecommendedPrice = async (packageId: string, priceCents: number) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/packages/${packageId}`,
      { priceCents },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) {
      bumpRefresh(packageId);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-end justify-end gap-3">
        {canManage && !adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setErrorMsg(null);
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("admin.catering.packages.add_package" as TranslationKey)}
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mt-4">
          <PackageForm
            locations={locations}
            busy={busy}
            errorMsg={errorMsg}
            submitLabel={t("admin.catering.packages.add" as TranslationKey)}
            onSubmit={(values) => void create(values)}
            onCancel={() => {
              setAdding(false);
              setErrorMsg(null);
            }}
          />
        </div>
      ) : null}

      {packages.length === 0 ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.catering.packages.empty" as TranslationKey)}
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {packages.map((p) => (
            <li
              key={p.id}
              className={
                // Editing rows keep the card chrome around PackageForm; non-editing
                // rows let SummaryRow be the card (avoids a nested double-card).
                (editingId === p.id ? "rounded-lg border-2 border-co-border bg-co-surface p-3 " : "") +
                (p.active ? "" : "opacity-60")
              }
            >
              {editingId === p.id ? (
                <PackageForm
                  initial={p}
                  locations={locations}
                  busy={busy}
                  errorMsg={errorMsg}
                  submitLabel={t("admin.catering.packages.save" as TranslationKey)}
                  onSubmit={(values) => void saveEdit(p.id, values)}
                  onCancel={() => {
                    setEditingId(null);
                    setErrorMsg(null);
                  }}
                />
              ) : (
                <PackageRow
                  pkg={p}
                  language={language}
                  locations={locations}
                  pickerMenu={pickerMenu}
                  canManage={canManage}
                  confirming={confirmDeactivateId === p.id}
                  busy={busy}
                  refreshKey={refreshKeys[p.id] ?? 0}
                  expanded={expanded.has(p.id)}
                  onToggle={() => toggleExpand(p.id)}
                  onEdit={() => {
                    setEditingId(p.id);
                    setErrorMsg(null);
                  }}
                  onAskDeactivate={() => setConfirmDeactivateId(p.id)}
                  onCancelDeactivate={() => setConfirmDeactivateId(null)}
                  onConfirmDeactivate={() => void toggleActive(p)}
                  onAddLine={(payload) => void addLine(p.id, payload)}
                  onAddSlotOption={(lineItemId, ref) => void addSlotOption(p.id, lineItemId, ref)}
                  onRemoveSlotOption={(optionId) => void removeSlotOption(p.id, optionId)}
                  onSetOptionClassic={(optionId, classic) => void setOptionClassic(p.id, optionId, classic)}
                  onRemoveLineItem={(itemId) => void removeLineItem(p.id, itemId)}
                  onUseRecommendedPrice={(priceCents) => void applyRecommendedPrice(p.id, priceCents)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {errorMsg && editingId === null && !adding ? (
        <p className="mt-2 text-sm text-co-cta">{errorMsg}</p>
      ) : null}
    </div>
  );
}

// ─── PackageRow ──────────────────────────────────────────────────────────────

/**
 * Read row → summary + drawer (Disclosure W3, docs/DISCLOSURE_DOCTRINE.md).
 *
 * ALWAYS-VISIBLE summary (D1): label + meta dot-string (location · mode · price ·
 * min headcount · lead time · serves · line-item count). Never-collapse alerts (D2)
 * stay on the collapsed line via SummaryRow's badges slot: the Inactive badge + the
 * Edit/Deactivate management buttons (W2 precedent: buttons are siblings of the toggle
 * in the badges slot, D4 triggers reachable without expanding).
 *
 * SECONDARY content → the lazy drawer (D3/D10): the PriceAdvicePanel + the
 * LineItemsSubList (line items, choice slots with classic stars, add-option flows).
 * Pure relocation — internals untouched. Because the drawer children only render when
 * expanded, the PriceAdvicePanel doesn't mount on first paint → its recommend fetch is
 * deferred until a manager opens the row (the free-perf win the council flagged).
 */
function PackageRow({
  pkg: p,
  language,
  locations,
  pickerMenu,
  canManage,
  confirming,
  busy,
  refreshKey,
  expanded,
  onToggle,
  onEdit,
  onAskDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
  onAddLine,
  onAddSlotOption,
  onRemoveSlotOption,
  onSetOptionClassic,
  onRemoveLineItem,
  onUseRecommendedPrice,
}: {
  pkg: PackageView;
  language: "en" | "es";
  locations: PackageLocationOption[];
  pickerMenu: PickerItem[];
  canManage: boolean;
  confirming: boolean;
  busy: boolean;
  refreshKey: number;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAskDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
  onAddLine: (payload: { slotType: "fixed" | "choice"; ref?: { kind: "item" | "menu_item"; id: string } | null; description?: string | null; quantity: number }) => void;
  onAddSlotOption: (lineItemId: string, ref: { kind: "item" | "menu_item"; id: string }) => void;
  onRemoveSlotOption: (optionId: string) => void;
  onSetOptionClassic: (optionId: string, classic: boolean) => void;
  onRemoveLineItem: (itemId: string) => void;
  onUseRecommendedPrice: (priceCents: number) => void;
}) {
  const { t } = useTranslation();
  const label = language === "es" ? p.labelEs || p.labelEn : p.labelEn;

  const meta: string[] = [];
  meta.push(p.locationName ?? t("admin.catering.packages.global" as TranslationKey));
  meta.push(t(`admin.catering.packages.mode.${p.pricingMode}` as TranslationKey));
  meta.push(formatCents(p.priceCents, language));
  if (p.minHeadcount != null) meta.push(t("admin.catering.packages.min_headcount_meta" as TranslationKey, { count: p.minHeadcount }));
  if (p.leadTimeHours != null) meta.push(t("admin.catering.packages.lead_time_meta" as TranslationKey, { hours: p.leadTimeHours }));
  if (p.serves != null) meta.push(t("admin.catering.packages.serves_meta" as TranslationKey, { count: p.serves }));
  // Slot/line count on the collapsed summary (D5) — i18n'd, never string-concat.
  meta.push(t("admin.catering.packages.line_count" as TranslationKey, { n: p.lineItems.length }));

  const actionBtn =
    "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50";

  return (
    <SummaryRow
      expanded={expanded}
      onToggle={onToggle}
      toggleLabel={expanded ? t("admin.catering.packages.hide_details" as TranslationKey) : t("admin.catering.packages.show_details" as TranslationKey)}
      drawerId={`package-detail-${p.id}`}
      summary={
        <div className="text-sm text-co-text">
          <div className="font-bold">{label}</div>
          <div className="text-co-text-muted">{meta.join(" · ")}</div>
        </div>
      }
      badges={
        <>
          {/* Never-collapse alerts (D2): the Inactive badge stays visible collapsed. */}
          {!p.active ? (
            <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.catering.packages.status.inactive" as TranslationKey)}
            </span>
          ) : null}
          {/* Management actions (D4 triggers) — reachable without expanding (W2 precedent). */}
          {canManage ? (
            confirming ? (
              <>
                <button type="button" disabled={busy} onClick={onCancelDeactivate} className={actionBtn}>
                  {t("admin.catering.packages.cancel" as TranslationKey)}
                </button>
                <button type="button" disabled={busy} onClick={onConfirmDeactivate} className={actionBtn}>
                  {p.active ? t("admin.catering.packages.deactivate" as TranslationKey) : t("admin.catering.packages.reactivate" as TranslationKey)}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onEdit} className={actionBtn}>
                  {t("admin.catering.packages.edit" as TranslationKey)}
                </button>
                <button type="button" onClick={onAskDeactivate} className={actionBtn}>
                  {p.active ? t("admin.catering.packages.deactivate" as TranslationKey) : t("admin.catering.packages.reactivate" as TranslationKey)}
                </button>
              </>
            )
          ) : null}
        </>
      }
    >
      {/* Price-advice panel — advisory, no step-up on read; step-up on "use recommended".
          Lazy: only mounts when the drawer is open, deferring its recommend fetch. */}
      {canManage ? (
        <PriceAdvicePanel
          packageId={p.id}
          packageLocationId={p.locationId}
          locations={locations}
          refreshKey={refreshKey}
          busy={busy}
          onUseRecommended={onUseRecommendedPrice}
        />
      ) : null}

      <LineItemsSubList
        lineItems={p.lineItems}
        pickerMenu={pickerMenu}
        canManage={canManage}
        busy={busy}
        onAddLine={onAddLine}
        onAddSlotOption={onAddSlotOption}
        onRemoveSlotOption={onRemoveSlotOption}
        onSetOptionClassic={onSetOptionClassic}
        onRemove={onRemoveLineItem}
      />
    </SummaryRow>
  );
}

// ─── LineItemsSubList ────────────────────────────────────────────────────────

/**
 * Per-package line-items sub-list (W1b).
 *
 * Fixed lines: show [Fixed] badge + refName or freeform description + quantity.
 * Choice lines: show [Choice] badge + slot label + "pick N" + option chips.
 *
 * Add modes:
 *   1. "Add fixed item" — picker dropdown over pickerMenu grouped by section → addLine fixed+ref
 *   2. "Add freeform" — text input → addLine fixed+description (existing behaviour)
 *   3. "Add choice slot" — label + N → addLine choice+description+quantity
 *      Then per choice slot an "Add option" picker → addSlotOption
 */
function LineItemsSubList({
  lineItems,
  pickerMenu,
  canManage,
  busy,
  onAddLine,
  onAddSlotOption,
  onRemoveSlotOption,
  onSetOptionClassic,
  onRemove,
}: {
  lineItems: PackageView["lineItems"];
  pickerMenu: PickerItem[];
  canManage: boolean;
  busy: boolean;
  onAddLine: (payload: { slotType: "fixed" | "choice"; ref?: { kind: "item" | "menu_item"; id: string } | null; description?: string | null; quantity: number }) => void;
  onAddSlotOption: (lineItemId: string, ref: { kind: "item" | "menu_item"; id: string }) => void;
  onRemoveSlotOption: (optionId: string) => void;
  onSetOptionClassic: (optionId: string, classic: boolean) => void;
  onRemove: (itemId: string) => void;
}) {
  const { t } = useTranslation();

  // Add-mode state: null = none open
  const [addMode, setAddMode] = useState<"fixed_picker" | "freeform" | "choice" | null>(null);

  // "Add fixed item" state
  const [pickerRef, setPickerRef] = useState<string>(""); // "kind:id" composite
  const [pickerQty, setPickerQty] = useState("1");

  // "Add freeform" state
  const [freeformDesc, setFreeformDesc] = useState("");
  const [freeformQty, setFreeformQty] = useState("");

  // "Add choice slot" state
  const [choiceLabel, setChoiceLabel] = useState("");
  const [choicePickN, setChoicePickN] = useState("1");

  // Per-choice-slot option-add state (lineItemId → selected picker ref)
  const [addingOptionFor, setAddingOptionFor] = useState<string | null>(null);
  const [optionPickerRef, setOptionPickerRef] = useState<string>("");

  const resetAddMode = () => {
    setAddMode(null);
    setPickerRef("");
    setPickerQty("1");
    setFreeformDesc("");
    setFreeformQty("");
    setChoiceLabel("");
    setChoicePickN("1");
  };

  // Grouped picker items by section for the select/optgroup.
  const pickerGroups = groupPickerItems(pickerMenu);

  const submitFixedPicker = () => {
    if (!pickerRef || busy) return;
    const qty = Number(pickerQty.trim());
    if (!Number.isFinite(qty) || qty <= 0) return;
    const [kindStr, ...rest] = pickerRef.split(":");
    const id = rest.join(":");
    if (!kindStr || !id) return;
    const kind = kindStr as "item" | "menu_item";
    onAddLine({ slotType: "fixed", ref: { kind, id }, quantity: qty });
    resetAddMode();
  };

  const submitFreeform = () => {
    const desc = freeformDesc.trim();
    const qty = Number(freeformQty.trim());
    if (!desc || !Number.isFinite(qty) || qty <= 0 || busy) return;
    onAddLine({ slotType: "fixed", description: desc, quantity: qty });
    resetAddMode();
  };

  const submitChoice = () => {
    const label = choiceLabel.trim();
    const n = Number(choicePickN.trim());
    if (!label || !Number.isFinite(n) || n <= 0 || busy) return;
    onAddLine({ slotType: "choice", description: label, quantity: n });
    resetAddMode();
  };

  const submitOptionAdd = (lineItemId: string) => {
    if (!optionPickerRef || busy) return;
    const [kindStr, ...rest] = optionPickerRef.split(":");
    const id = rest.join(":");
    if (!kindStr || !id) return;
    const kind = kindStr as "item" | "menu_item";
    onAddSlotOption(lineItemId, { kind, id });
    setAddingOptionFor(null);
    setOptionPickerRef("");
  };

  const fieldCls =
    "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="rounded-lg border-2 border-dashed border-co-border p-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
        {t("admin.catering.packages.line_items" as TranslationKey)}
      </p>

      {lineItems.length === 0 ? (
        <p className="mt-1 text-sm text-co-text-muted">{t("admin.catering.packages.no_line_items" as TranslationKey)}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {lineItems.map((li) => (
            <li key={li.id} className="rounded-lg border-2 border-co-border bg-co-surface p-2 text-sm text-co-text">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1">
                  {/* Badge + label row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <SlotBadge slotType={li.slotType} />
                    {li.slotType === "fixed" ? (
                      <span>
                        <span className="font-bold">{li.quantity}×</span>{" "}
                        {li.refName ?? li.description ?? "—"}
                      </span>
                    ) : (
                      <span>
                        {li.description ?? "—"}{" "}
                        <span className="text-co-text-muted">
                          ({t("admin.catering.packages.pick_count" as TranslationKey, { count: li.quantity })})
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Choice slot: eligible options */}
                  {li.slotType === "choice" ? (
                    <div className="mt-1 pl-2">
                      <p className="text-xs font-bold text-co-text-muted">
                        {t("admin.catering.packages.eligible_options" as TranslationKey)}
                      </p>
                      {li.options.length === 0 ? (
                        <p className="text-xs text-co-text-muted">
                          {t("admin.catering.packages.no_options" as TranslationKey)}
                        </p>
                      ) : (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {li.options.map((opt) => (
                            <span
                              key={opt.id}
                              className={`inline-flex items-center gap-1 rounded-full border-2 bg-co-surface px-2 py-0.5 text-xs text-co-text ${opt.classic ? "border-co-gold" : "border-co-border"}`}
                            >
                              {opt.name}
                              {canManage ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={t(
                                    (opt.classic
                                      ? "admin.catering.packages.classic_off_aria"
                                      : "admin.catering.packages.classic_on_aria") as TranslationKey,
                                    { name: opt.name },
                                  )}
                                  aria-pressed={opt.classic}
                                  title={t("admin.catering.packages.classic_badge" as TranslationKey)}
                                  onClick={() => onSetOptionClassic(opt.id, !opt.classic)}
                                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60 disabled:opacity-50 ${opt.classic ? "text-co-gold-deep" : "text-co-text-muted hover:text-co-gold-deep"}`}
                                >
                                  {opt.classic ? "★" : "☆"}
                                </button>
                              ) : opt.classic ? (
                                <span aria-label={t("admin.catering.packages.classic_badge" as TranslationKey)} className="text-co-gold-deep">★</span>
                              ) : null}
                              {canManage ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={t(
                                    "admin.catering.packages.remove_option_aria" as TranslationKey,
                                    { name: opt.name, slot: li.description ?? "" },
                                  )}
                                  onClick={() => onRemoveSlotOption(opt.id)}
                                  className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-co-text-muted hover:text-co-cta focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold/60 disabled:opacity-50"
                                >
                                  ×
                                </button>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Add option inline picker */}
                      {canManage ? (
                        addingOptionFor === li.id ? (
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            <select
                              className={fieldCls + " flex-1"}
                              value={optionPickerRef}
                              disabled={busy}
                              onChange={(e) => setOptionPickerRef(e.target.value)}
                              aria-label={t("admin.catering.packages.add_option_aria" as TranslationKey, { slot: li.description ?? "" })}
                            >
                              <option value="">{t("admin.catering.packages.pick_item" as TranslationKey)}</option>
                              {pickerGroups.map((g) => (
                                <optgroup key={g.section ?? "__none"} label={g.section ?? t("admin.catering.packages.section_other" as TranslationKey)}>
                                  {g.items.map((item) => (
                                    <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                                      {item.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={busy || !optionPickerRef}
                              onClick={() => submitOptionAdd(li.id)}
                              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t("admin.catering.packages.add_option" as TranslationKey)}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => { setAddingOptionFor(null); setOptionPickerRef(""); }}
                              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                            >
                              {t("admin.catering.packages.cancel" as TranslationKey)}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => { setAddingOptionFor(li.id); setOptionPickerRef(""); }}
                            aria-label={t("admin.catering.packages.add_option_aria" as TranslationKey, { slot: li.description ?? "" })}
                            className="mt-2 inline-flex min-h-[36px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                          >
                            {t("admin.catering.packages.add_option" as TranslationKey)}
                          </button>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {canManage ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemove(li.id)}
                    aria-label={t("admin.catering.packages.remove_line_item_aria" as TranslationKey, {
                      description: li.refName ?? li.description ?? "",
                    })}
                    className="inline-flex min-h-[44px] shrink-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                  >
                    {t("admin.catering.packages.remove" as TranslationKey)}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ─── Add controls ─── */}
      {canManage ? (
        addMode === null ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Show add-fixed-picker only when picker has items */}
            {pickerMenu.length > 0 ? (
              <button
                type="button"
                onClick={() => setAddMode("fixed_picker")}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {t("admin.catering.packages.add_fixed_item" as TranslationKey)}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setAddMode("freeform")}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            >
              {t("admin.catering.packages.add_freeform" as TranslationKey)}
            </button>
            <button
              type="button"
              onClick={() => setAddMode("choice")}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            >
              {t("admin.catering.packages.add_choice_slot" as TranslationKey)}
            </button>
          </div>
        ) : addMode === "fixed_picker" ? (
          /* ─ Add fixed item via picker ─ */
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block flex-1">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.add_fixed_item" as TranslationKey)}</span>
              <select
                className={fieldCls}
                value={pickerRef}
                disabled={busy}
                onChange={(e) => setPickerRef(e.target.value)}
              >
                <option value="">{t("admin.catering.packages.pick_item" as TranslationKey)}</option>
                {pickerGroups.map((g) => (
                  <optgroup key={g.section ?? "__none"} label={g.section ?? t("admin.catering.packages.section_other" as TranslationKey)}>
                    {g.items.map((item) => (
                      <option key={`${item.kind}:${item.id}`} value={`${item.kind}:${item.id}`}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="block w-24">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.line_item_quantity" as TranslationKey)}</span>
              <input
                className={fieldCls}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={pickerQty}
                disabled={busy}
                onChange={(e) => setPickerQty(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !pickerRef}
              onClick={submitFixedPicker}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("admin.catering.packages.add_line_item" as TranslationKey)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={resetAddMode}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
            >
              {t("admin.catering.packages.cancel" as TranslationKey)}
            </button>
          </div>
        ) : addMode === "freeform" ? (
          /* ─ Add freeform fixed line ─ */
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block flex-1">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.line_item_description" as TranslationKey)}</span>
              <input
                className={fieldCls}
                value={freeformDesc}
                disabled={busy}
                onChange={(e) => setFreeformDesc(e.target.value)}
              />
            </label>
            <label className="block w-24">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.line_item_quantity" as TranslationKey)}</span>
              <input
                className={fieldCls}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={freeformQty}
                disabled={busy}
                onChange={(e) => setFreeformQty(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || freeformDesc.trim() === "" || freeformQty.trim() === ""}
              onClick={submitFreeform}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("admin.catering.packages.add_line_item" as TranslationKey)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={resetAddMode}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
            >
              {t("admin.catering.packages.cancel" as TranslationKey)}
            </button>
          </div>
        ) : addMode === "choice" ? (
          /* ─ Add choice slot ─ */
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block flex-1">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.slot_label" as TranslationKey)}</span>
              <input
                className={fieldCls}
                value={choiceLabel}
                disabled={busy}
                onChange={(e) => setChoiceLabel(e.target.value)}
                placeholder={t("admin.catering.packages.slot_label_placeholder" as TranslationKey)}
              />
            </label>
            <label className="block w-28">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.slot_pick_n" as TranslationKey)}</span>
              <input
                className={fieldCls}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={choicePickN}
                disabled={busy}
                onChange={(e) => setChoicePickN(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || choiceLabel.trim() === ""}
              onClick={submitChoice}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("admin.catering.packages.add_line_item" as TranslationKey)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={resetAddMode}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
            >
              {t("admin.catering.packages.cancel" as TranslationKey)}
            </button>
          </div>
        ) : null
      ) : null}
    </div>
  );
}

// ─── SlotBadge ───────────────────────────────────────────────────────────────

function SlotBadge({ slotType }: { slotType: "fixed" | "choice" }) {
  const { t } = useTranslation();
  const isChoice = slotType === "choice";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] ${
        isChoice
          ? "bg-co-gold/20 text-co-text"
          : "bg-co-text/10 text-co-text-muted"
      }`}
    >
      {t(
        (isChoice
          ? "admin.catering.packages.badge.choice"
          : "admin.catering.packages.badge.fixed") as TranslationKey,
      )}
    </span>
  );
}

// ─── groupPickerItems helper ─────────────────────────────────────────────────

interface PickerGroup {
  section: string | null;
  items: PickerItem[];
}

/** Group picker items by section for <optgroup> rendering. Null section last. */
function groupPickerItems(items: PickerItem[]): PickerGroup[] {
  const map = new Map<string, PickerItem[]>();
  for (const item of items) {
    const key = item.section ?? "__null";
    const arr = map.get(key) ?? [];
    arr.push(item);
    map.set(key, arr);
  }
  const groups: PickerGroup[] = [];
  for (const [key, grpItems] of map.entries()) {
    groups.push({ section: key === "__null" ? null : key, items: grpItems });
  }
  // Named sections first, null last.
  groups.sort((a, b) => {
    if (a.section === null) return 1;
    if (b.section === null) return -1;
    return a.section.localeCompare(b.section);
  });
  return groups;
}
