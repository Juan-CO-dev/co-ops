"use client";

/**
 * MadeFromEditor (Item/Inventory Spine Slice C2) — the per-item "Made from" BOM
 * sub-area inside a RegistryRow's edit panel. Lists the item's component SKUs +
 * sub-items (each = a quantity consumed per ONE of the item's par-units, in a
 * measure) and lets GM+ (≥7) add/remove them; AGM+ (≥6) sees it read-only.
 *
 * Mirrors ItemQuestionsEditor exactly: tap-to-expand add form + list + per-row
 * remove-confirm, all via useStepUp + postJson + router.refresh(). The view
 * loader supplies `components` (filtered per item by the caller), `skuOptions`,
 * `itemOptions` (sub-item picker, parent excluded by the caller), and
 * `measureUnits`. Component routes live under /api/admin/items/{itemId}/components.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { RegistrySelect } from "@/components/admin/skus/RegistrySelect";
import { formatSkuPack } from "@/components/admin/skus/shared";
import type { ComponentView } from "@/lib/admin/item-components";
import type { TranslationKey } from "@/lib/i18n/types";
import { postJson } from "./shared";

/** Local error resolver scoped to the made-from namespace (mirrors skus/shared). */
const KNOWN_ERROR_CODES = new Set([
  "forbidden",
  "invalid_component",
  "invalid_quantity",
  "invalid_sku",
  "invalid_component_item",
  "item_not_found",
  "would_create_cycle",
  "component_not_found",
  "invalid_payload",
  "step_up_required",
  "step_up_stale",
]);

function resolveErrorKey(code: string): TranslationKey {
  const key = KNOWN_ERROR_CODES.has(code) ? code : "generic";
  return `admin.items.made_from.error.${key}` as TranslationKey;
}

const field =
  "mt-1 min-h-[44px] w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";

type ComponentKind = "sku" | "item";

export function MadeFromEditor({
  itemId,
  itemName,
  components,
  skuOptions,
  itemOptions,
  measureUnits,
  actorLevel,
}: {
  itemId: string;
  itemName: string;
  components: ComponentView[];
  skuOptions: Array<{ id: string; name: string }>;
  itemOptions: Array<{ id: string; name: string }>;
  measureUnits: Array<{ id: string; label: string }>;
  actorLevel: number;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();
  const canEdit = actorLevel >= 7; // GM+

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [kind, setKind] = useState<ComponentKind>("sku");
  const [componentSkuId, setComponentSkuId] = useState("");
  const [componentItemId, setComponentItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");

  // Sub-item picker excludes the parent item itself.
  const subItemOptions = itemOptions.filter((o) => o.id !== itemId);

  const reset = () => {
    setKind("sku");
    setComponentSkuId("");
    setComponentItemId("");
    setQuantity("");
    setUnit("");
    setErrorMsg(null);
  };

  const picked = kind === "sku" ? componentSkuId : componentItemId;
  const quantityNum = Number(quantity);
  const canSubmit =
    picked.trim() !== "" && quantity.trim() !== "" && Number.isFinite(quantityNum) && quantityNum > 0;

  const submit = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if (!canSubmit) return;
    if ((await requestStepUp("B")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/items/${itemId}/components`,
      {
        ...(kind === "sku"
          ? { componentSkuId }
          : { componentItemId }),
        quantity: quantityNum,
        unit: unit.trim() || null,
      },
      "POST",
    );
    setSubmitting(false);
    if (result.ok) {
      reset();
      setOpen(false);
      router.refresh();
    } else {
      setErrorMsg(t(resolveErrorKey(result.code)));
    }
  };

  return (
    <div className="rounded-lg border-2 border-co-border p-3">
      <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t("admin.items.made_from.title")}
      </h3>
      <p className="mt-1 text-xs text-co-text-muted">{t("admin.items.made_from.subtitle")}</p>

      {components.length > 0 ? (
        <div className="mt-2 flex flex-col gap-2">
          {components.map((c) => (
            <MadeFromRow key={c.id} itemId={itemId} component={c} canEdit={canEdit} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-co-text-muted">{t("admin.items.made_from.empty")}</p>
      )}

      {canEdit ? (
        open ? (
          <div className="mt-3 rounded-lg border-2 border-co-gold-deep bg-co-surface p-3">
            <h4 className="text-sm font-extrabold text-co-text">{t("admin.items.made_from.add")}</h4>
            <div className="mt-3 flex flex-col gap-3">
              {/* Type toggle: SKU | Sub-item */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setKind("sku")}
                  className={`inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border-2 px-3 text-sm font-bold transition ${
                    kind === "sku"
                      ? "border-co-gold-deep bg-co-gold text-co-text"
                      : "border-co-border bg-co-surface text-co-text hover:border-co-text"
                  }`}
                >
                  {t("admin.items.made_from.type_sku")}
                </button>
                <button
                  type="button"
                  onClick={() => setKind("item")}
                  className={`inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg border-2 px-3 text-sm font-bold transition ${
                    kind === "item"
                      ? "border-co-gold-deep bg-co-gold text-co-text"
                      : "border-co-border bg-co-surface text-co-text hover:border-co-text"
                  }`}
                >
                  {t("admin.items.made_from.type_item")}
                </button>
              </div>

              {/* Matching picker */}
              {kind === "sku" ? (
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t("admin.items.made_from.pick_sku")}</span>
                  <select
                    className={field}
                    value={componentSkuId}
                    onChange={(e) => setComponentSkuId(e.target.value)}
                  >
                    <option value="">{t("admin.items.made_from.pick_sku")}</option>
                    {skuOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="block">
                  <span className="text-sm font-bold text-co-text">{t("admin.items.made_from.pick_item")}</span>
                  <select
                    className={field}
                    value={componentItemId}
                    onChange={(e) => setComponentItemId(e.target.value)}
                  >
                    <option value="">{t("admin.items.made_from.pick_item")}</option>
                    {subItemOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {/* Quantity */}
              <label className="block">
                <span className="text-sm font-bold text-co-text">{t("admin.items.made_from.quantity")}</span>
                <input
                  className={field}
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>

              {/* Measure */}
              <RegistrySelect
                label={t("admin.items.made_from.measure")}
                value={unit}
                onChange={setUnit}
                options={measureUnits}
                actorLevel={actorLevel}
                addEndpoint="/api/admin/skus/measure-units"
                addPromptKey="admin.skus.add_measure_prompt"
                addButtonKey="admin.skus.add_measure"
              />

              {errorMsg ? <p className="text-sm text-co-cta">{errorMsg}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { reset(); setOpen(false); }}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
                >
                  {t("admin.items.made_from.cancel")}
                </button>
                <button
                  type="button"
                  disabled={submitting || !canSubmit}
                  onClick={() => void submit()}
                  className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text disabled:opacity-50"
                >
                  {t("admin.items.made_from.save")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-2 inline-flex min-h-[44px] items-center self-start rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text hover:border-co-text"
          >
            {t("admin.items.made_from.add")}
          </button>
        )
      ) : null}
    </div>
  );
}

function MadeFromRow({
  itemId,
  component,
  canEdit,
}: {
  itemId: string;
  component: ComponentView;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const remove = async () => {
    if (submitting) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setSubmitting(true);
    const result = await postJson(
      `/api/admin/items/${itemId}/components/${component.id}`,
      {},
      "DELETE",
    );
    setSubmitting(false);
    if (result.ok) { setConfirming(false); router.refresh(); }
    else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const qtyLabel = `${component.quantity} ${component.unit ?? ""} ${component.componentName}`.replace(/\s+/g, " ").trim();

  return (
    <div className="rounded-lg border-2 border-co-border bg-co-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-co-text">{qtyLabel}</p>
          {component.kind === "sku" ? (
            <p className="text-xs text-co-text-muted">
              {component.skuPack ? formatSkuPack(component.skuPack, t) : "—"}
            </p>
          ) : (
            <p className="text-xs text-co-text-muted">{t("admin.items.made_from.item_tag")}</p>
          )}
        </div>
        {canEdit ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => setConfirming((v) => !v)}
            className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-cta hover:border-co-cta disabled:opacity-50"
          >
            {t("admin.items.made_from.remove")}
          </button>
        ) : null}
      </div>

      {confirming && canEdit ? (
        <div className="mt-3 rounded-lg border-2 border-co-cta bg-co-cta/10 p-3">
          <p className="text-sm font-bold text-co-text">{t("admin.items.made_from.confirm_remove")}</p>
          {errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 text-sm font-bold text-co-text disabled:opacity-50"
            >
              {t("admin.items.made_from.cancel")}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void remove()}
              className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta bg-co-cta px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-surface disabled:opacity-50"
            >
              {t("admin.items.made_from.remove")}
            </button>
          </div>
        </div>
      ) : (
        errorMsg ? <p className="mt-2 text-sm text-co-cta">{errorMsg}</p> : null
      )}
    </div>
  );
}
