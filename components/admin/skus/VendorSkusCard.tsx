"use client";

/**
 * VendorSkusCard — the SKUs card on the vendor-detail page (Item/Inventory
 * Spine, Slice C1). Lists this vendor's SKUs and (GM+) supports add / edit /
 * deactivate. The vendor is fixed (this page's vendor), so the SkuForm hides
 * its vendor dropdown and the create payload carries `vendorId: <this vendor>`.
 *
 * Authority (matches the routes): create = Tier B; edit + deactivate = Tier A.
 * Below GM+ (≥7) the write affordances are hidden.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { RegistryOption, MeasureUnitOption, SkuView } from "@/lib/admin/skus";
import { postJson, resolveErrorKey, formatSkuPack } from "./shared";
import { SkuCostPanel, type SkuCostInfo } from "./SkuCostPanel";
import { SkuForm, type SkuFormLocationOption, type SkuFormValues } from "./SkuForm";

export function VendorSkusCard({
  vendorId,
  skus,
  locations,
  packFormats,
  measureUnits,
  skuCost,
  actorLevel,
  canManage,
}: {
  vendorId: string;
  skus: SkuView[];
  locations: SkuFormLocationOption[];
  packFormats: RegistryOption[];
  measureUnits: MeasureUnitOption[];
  skuCost: Record<string, SkuCostInfo>;
  actorLevel: number;
  canManage: boolean; // GM+
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const create = async (values: SkuFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/skus", { ...values, vendorId });
    setBusy(false);
    if (result.ok) {
      setAdding(false);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveEdit = async (id: string, values: SkuFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/skus/${id}`, values, "PATCH");
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const toggleActive = async (sku: SkuView) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return;
    setBusy(true);
    const result = await postJson(`/api/admin/skus/${sku.id}`, { active: !sku.active }, "PATCH");
    setBusy(false);
    if (result.ok) {
      setConfirmDeactivateId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  return (
    <section className="rounded-xl border-2 border-co-border bg-co-surface p-4">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-co-text-muted">
        {t("admin.skus.card.title")}
      </h2>

      <div className="mt-3">
        {skus.length === 0 ? (
          <p className="text-sm text-co-text-muted">{t("admin.skus.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {skus.map((s) => (
              <li
                key={s.id}
                className={
                  "rounded-lg border-2 border-co-border p-3 " + (s.active ? "" : "opacity-60")
                }
              >
                {editingId === s.id ? (
                  <SkuForm
                    initial={s}
                    fixedVendorId={vendorId}
                    locations={locations}
                    packFormats={packFormats}
                    measureUnits={measureUnits}
                    actorLevel={actorLevel}
                    busy={busy}
                    errorMsg={errorMsg}
                    submitLabel={t("admin.skus.save")}
                    onSubmit={(values) => void saveEdit(s.id, values)}
                    onCancel={() => {
                      setEditingId(null);
                      setErrorMsg(null);
                    }}
                  />
                ) : (
                  <SkuRow
                    sku={s}
                    canManage={canManage}
                    confirming={confirmDeactivateId === s.id}
                    busy={busy}
                    onEdit={() => {
                      setEditingId(s.id);
                      setErrorMsg(null);
                    }}
                    onAskDeactivate={() => setConfirmDeactivateId(s.id)}
                    onCancelDeactivate={() => setConfirmDeactivateId(null)}
                    onConfirmDeactivate={() => void toggleActive(s)}
                  />
                )}
                {editingId === s.id ? null : (
                  <SkuCostPanel
                    skuId={s.id}
                    cost={skuCost[s.id] ?? { currentPrice: null, costPerOz: null, usedBy: [] }}
                    canRecord={actorLevel >= 6}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {errorMsg && editingId === null && !adding ? (
          <p className="mt-2 text-sm text-co-cta">{errorMsg}</p>
        ) : null}

        {canManage ? (
          adding ? (
            <div className="mt-3">
              <SkuForm
                fixedVendorId={vendorId}
                locations={locations}
                packFormats={packFormats}
                measureUnits={measureUnits}
                actorLevel={actorLevel}
                busy={busy}
                errorMsg={errorMsg}
                submitLabel={t("admin.skus.add")}
                onSubmit={(values) => void create(values)}
                onCancel={() => {
                  setAdding(false);
                  setErrorMsg(null);
                }}
              />
            </div>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setErrorMsg(null);
                }}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {t("admin.skus.add_sku")}
              </button>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

/** Compact read row for a SKU: name · unit/size · item# · lead time + badges. */
export function SkuRow({
  sku: s,
  canManage,
  confirming,
  busy,
  onEdit,
  onAskDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
}: {
  sku: SkuView;
  canManage: boolean;
  confirming: boolean;
  busy: boolean;
  onEdit: () => void;
  onAskDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
}) {
  const { t } = useTranslation();
  const meta: string[] = [];
  meta.push(formatSkuPack(s, t));
  if (s.itemNumber) meta.push(`#${s.itemNumber}`);
  if (s.leadTimeDays != null) meta.push(t("admin.skus.lead_time_days", { count: s.leadTimeDays }));

  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="text-sm text-co-text">
        <div className="flex items-center gap-2 font-bold">
          {s.name}
          {!s.active ? (
            <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.skus.status.inactive")}
            </span>
          ) : null}
          {s.locationName ? (
            <span className="inline-flex items-center rounded-full bg-co-gold/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-gold-deep">
              {s.locationName}
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
                {t("admin.skus.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirmDeactivate}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50"
              >
                {s.active ? t("admin.skus.deactivate") : t("admin.skus.reactivate")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {t("admin.skus.edit")}
              </button>
              <button
                type="button"
                onClick={onAskDeactivate}
                className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              >
                {s.active ? t("admin.skus.deactivate") : t("admin.skus.reactivate")}
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
