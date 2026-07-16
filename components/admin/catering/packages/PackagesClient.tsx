"use client";

/**
 * PackagesClient — the Catering KB Packages editor (/admin/catering/packages).
 *
 * Lists packages the server loaded (globals + the actor's locations, or all for
 * level 9+), each with a line-items sub-list. (≥6) can add a package, edit its
 * fields, deactivate/reactivate it, and add/remove freeform line items.
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
import { PackageForm, type PackageFormValues } from "./PackageForm";

const PACKAGE_MIN = 6; // catering.kb.packages.write — same floor the routes enforce

export function PackagesClient({
  packages,
  locations,
  actorLevel,
}: {
  packages: PackageView[];
  locations: PackageLocationOption[];
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

  const addLineItem = async (packageId: string, description: string, quantity: number) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(
      `/api/admin/catering/packages/${packageId}`,
      { addItem: { description, quantity } },
      "PATCH",
    );
    setBusy(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const removeLineItem = async (packageId: string, itemId: string) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/catering/packages/${packageId}`, { removeItemId: itemId }, "PATCH");
    setBusy(false);
    if (result.ok) router.refresh();
    else setErrorMsg(t(resolveErrorKey(result.code)));
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
              className={"rounded-lg border-2 border-co-border bg-co-surface p-3 " + (p.active ? "" : "opacity-60")}
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
                  canManage={canManage}
                  confirming={confirmDeactivateId === p.id}
                  busy={busy}
                  onEdit={() => {
                    setEditingId(p.id);
                    setErrorMsg(null);
                  }}
                  onAskDeactivate={() => setConfirmDeactivateId(p.id)}
                  onCancelDeactivate={() => setConfirmDeactivateId(null)}
                  onConfirmDeactivate={() => void toggleActive(p)}
                  onAddLineItem={(description, quantity) => void addLineItem(p.id, description, quantity)}
                  onRemoveLineItem={(itemId) => void removeLineItem(p.id, itemId)}
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

/** Read row: label · location · pricing mode · price · headcount/lead + line-items sub-list. */
function PackageRow({
  pkg: p,
  language,
  canManage,
  confirming,
  busy,
  onEdit,
  onAskDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
  onAddLineItem,
  onRemoveLineItem,
}: {
  pkg: PackageView;
  language: "en" | "es";
  canManage: boolean;
  confirming: boolean;
  busy: boolean;
  onEdit: () => void;
  onAskDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
  onAddLineItem: (description: string, quantity: number) => void;
  onRemoveLineItem: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const label = language === "es" ? p.labelEs || p.labelEn : p.labelEn;

  const meta: string[] = [];
  meta.push(p.locationName ?? t("admin.catering.packages.global" as TranslationKey));
  meta.push(t(`admin.catering.packages.mode.${p.pricingMode}` as TranslationKey));
  meta.push(formatCents(p.priceCents, language));
  if (p.minHeadcount != null) meta.push(t("admin.catering.packages.min_headcount_meta" as TranslationKey, { count: p.minHeadcount }));
  if (p.leadTimeHours != null) meta.push(t("admin.catering.packages.lead_time_meta" as TranslationKey, { hours: p.leadTimeHours }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm text-co-text">
          <div className="flex items-center gap-2 font-bold">
            {label}
            {!p.active ? (
              <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
                {t("admin.catering.packages.status.inactive" as TranslationKey)}
              </span>
            ) : null}
          </div>
          <div className="text-co-text-muted">{meta.join(" · ")}</div>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            {confirming ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCancelDeactivate}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                >
                  {t("admin.catering.packages.cancel" as TranslationKey)}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onConfirmDeactivate}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                >
                  {p.active ? t("admin.catering.packages.deactivate" as TranslationKey) : t("admin.catering.packages.reactivate" as TranslationKey)}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                >
                  {t("admin.catering.packages.edit" as TranslationKey)}
                </button>
                <button
                  type="button"
                  onClick={onAskDeactivate}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                >
                  {p.active ? t("admin.catering.packages.deactivate" as TranslationKey) : t("admin.catering.packages.reactivate" as TranslationKey)}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <LineItemsSubList
        lineItems={p.lineItems}
        canManage={canManage}
        busy={busy}
        onAdd={onAddLineItem}
        onRemove={onRemoveLineItem}
      />
    </div>
  );
}

/** Per-package line-items sub-list: freeform description + quantity rows, with an
 *  add form (canManage) and a remove affordance per active row. */
function LineItemsSubList({
  lineItems,
  canManage,
  busy,
  onAdd,
  onRemove,
}: {
  lineItems: PackageView["lineItems"];
  canManage: boolean;
  busy: boolean;
  onAdd: (description: string, quantity: number) => void;
  onRemove: (itemId: string) => void;
}) {
  const { t } = useTranslation();
  const [addingItem, setAddingItem] = useState(false);
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");

  const submitAdd = () => {
    const desc = description.trim();
    const qty = Number(quantity.trim());
    if (!desc || !Number.isFinite(qty) || qty <= 0 || busy) return;
    onAdd(desc, qty);
    setDescription("");
    setQuantity("");
    setAddingItem(false);
  };

  return (
    <div className="rounded-lg border-2 border-dashed border-co-border p-3">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
        {t("admin.catering.packages.line_items" as TranslationKey)}
      </p>
      {lineItems.length === 0 ? (
        <p className="mt-1 text-sm text-co-text-muted">{t("admin.catering.packages.no_line_items" as TranslationKey)}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {lineItems.map((li) => (
            <li key={li.id} className="flex items-center justify-between gap-2 text-sm text-co-text">
              <span>
                <span className="font-bold">{li.quantity}×</span> {li.description ?? "—"}
              </span>
              {canManage ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRemove(li.id)}
                  aria-label={t("admin.catering.packages.remove_line_item_aria" as TranslationKey, {
                    description: li.description ?? "",
                  })}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
                >
                  {t("admin.catering.packages.remove" as TranslationKey)}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        addingItem ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="block flex-1">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.line_item_description" as TranslationKey)}</span>
              <input
                className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                value={description}
                disabled={busy}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="block w-24">
              <span className="text-xs font-bold text-co-text">{t("admin.catering.packages.line_item_quantity" as TranslationKey)}</span>
              <input
                className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={quantity}
                disabled={busy}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || description.trim() === "" || quantity.trim() === ""}
              onClick={submitAdd}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-3 text-xs font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("admin.catering.packages.add_line_item" as TranslationKey)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAddingItem(false);
                setDescription("");
                setQuantity("");
              }}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
            >
              {t("admin.catering.packages.cancel" as TranslationKey)}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingItem(true)}
            className="mt-2 inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("admin.catering.packages.add_line_item" as TranslationKey)}
          </button>
        )
      ) : null}
    </div>
  );
}
