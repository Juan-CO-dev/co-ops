"use client";

/**
 * VendorSkusCard — the SKUs card on the vendor-detail page (Item/Inventory
 * Spine, Slice C1). Lists this vendor's SKUs and (GM+) supports add / edit /
 * deactivate. The vendor is fixed (this page's vendor), so the SkuBuilder hides
 * its vendor dropdown (fixedVendorId, no `vendors` prop) and the create payload
 * carries `vendorId: <this vendor>`.
 *
 * SKU top-tier PR-C: this card now renders the ONE SkuBuilder editor (the same
 * surface the global catalog uses), replacing the retired SkuForm. The chain is
 * the only pack vocabulary; the server sync derives the legacy flat fields on
 * save (no UI authors the trio). Chains are server-seeded batch-wise (no lazy GET)
 * via chainsBySku / chainUnverifiedBySku, and the edit-mode chain save mirrors the
 * catalog's avg-PATCH-before-chain-POST flow.
 *
 * Authority (matches the routes): create = Tier B; edit + deactivate = Tier A;
 * chain save = Tier A. Below GM+ (≥7) the write affordances are hidden.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { RegistryOption, MeasureUnitOption, SkuView } from "@/lib/admin/skus";
import { postJson, resolveErrorKey, formatSkuPack } from "./shared";
import type { SkuReceivingLedger, SkuConsumption } from "@/lib/admin/cost";
import type { Readiness } from "@/lib/readiness";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { StarterChainLevel, SkuNameCollisionCandidate } from "@/lib/admin/catalog-shared";
import { StatusBadge, ReadinessReasons } from "@/components/admin/StatusBadge";
import { SkuCostPanel, type SkuCostInfo } from "./SkuCostPanel";
import { SkuBuilder } from "./SkuBuilder";
import type { SkuFormLocationOption, SkuFormValues } from "./SkuBuilder";
import type { LocationSkuOverlayView } from "./SkuLocationOverlay";

export function VendorSkusCard({
  vendorId,
  skus,
  locations,
  packFormats,
  measureUnits,
  skuCost,
  skuLedger,
  skuConsumption,
  skuReadiness,
  chainsBySku,
  chainUnverifiedBySku,
  overlaysBySku,
  actorLevel,
  canManage,
}: {
  vendorId: string;
  skus: SkuView[];
  locations: SkuFormLocationOption[];
  packFormats: RegistryOption[];
  measureUnits: MeasureUnitOption[];
  skuCost: Record<string, SkuCostInfo>;
  skuLedger: Record<string, SkuReceivingLedger>;
  skuConsumption: Record<string, SkuConsumption>;
  skuReadiness: Record<string, Readiness>;
  /** Server batch-loaded active chains per SKU (PR-C — no lazy GET). Absent = unchained. */
  chainsBySku: Record<string, PackChainLevel[]>;
  /** Server class-aware "chain unverified" flag per SKU. */
  chainUnverifiedBySku: Record<string, boolean>;
  /** VO-7: per-location overlay rows per SKU (edit-mode overlay section). */
  overlaysBySku: Record<string, LocationSkuOverlayView[]>;
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

  // Collision candidates for the builder's non-blocking name warning.
  const collisionCandidates: SkuNameCollisionCandidate[] = skus.map((s) => ({ id: s.id, name: s.name, active: s.active }));

  const create = async (values: SkuFormValues, chain: StarterChainLevel[] | null) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    // Atomic add: identity + optional starter chain in ONE request (matches catalog).
    const result = await postJson("/api/admin/skus", { ...values, vendorId, chain });
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

  // Edit-mode chain save (the SKU exists → the pack-chain route). Its own Tier-A
  // step-up (mirrors SkuCatalogClient). When the wizard hands an `avgOzPerEach`
  // (its raw count/volume leaf), PATCH it onto the SKU FIRST so the chain's count
  // leaf is oz-resolvable at validation (both writes ride the one Tier-A step-up).
  const saveChain = async (
    id: string,
    levels: StarterChainLevel[],
    avgOzPerEach?: number | null,
  ): Promise<boolean> => {
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return false;
    if (avgOzPerEach !== undefined && avgOzPerEach !== null) {
      const avgResult = await postJson(`/api/admin/skus/${id}`, { avgOzPerEach }, "PATCH");
      if (!avgResult.ok) {
        setErrorMsg(t(resolveErrorKey(avgResult.code)));
        return false;
      }
    }
    const payload = levels.map((l) => ({
      label: l.label,
      containsQty: l.containsQty,
      containsIndex: l.containsIndex,
      containsMeasureUnit: l.containsMeasureUnit,
    }));
    const result = await postJson(`/api/admin/skus/${id}/pack-chain`, { levels: payload }, "POST");
    if (result.ok) {
      router.refresh();
      return true;
    }
    setErrorMsg(t(resolveErrorKey(result.code)));
    return false;
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
                  <SkuBuilder
                    initial={s}
                    initialChain={chainsBySku[s.id] ?? null}
                    initialChainUnverified={chainUnverifiedBySku[s.id] ?? false}
                    fixedVendorId={vendorId}
                    locations={locations}
                    packFormats={packFormats}
                    measureUnits={measureUnits}
                    actorLevel={actorLevel}
                    busy={busy}
                    errorMsg={errorMsg}
                    submitLabel={t("admin.skus.save")}
                    allSkus={collisionCandidates}
                    cost={skuCost[s.id] ?? { currentPrice: null, costPerOz: null, usedBy: [] }}
                    ledger={skuLedger[s.id] ?? null}
                    consumption={skuConsumption[s.id] ?? null}
                    overlays={overlaysBySku[s.id] ?? []}
                    onSubmit={(values) => void saveEdit(s.id, values)}
                    onSaveChain={(levels, avg) => saveChain(s.id, levels, avg)}
                    onCancel={() => {
                      setEditingId(null);
                      setErrorMsg(null);
                    }}
                  />
                ) : (
                  <SkuRow
                    sku={s}
                    chain={chainsBySku[s.id] ?? null}
                    readiness={skuReadiness[s.id] ?? null}
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
                    ledger={skuLedger[s.id] ?? null}
                    consumption={skuConsumption[s.id] ?? null}
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
              <SkuBuilder
                fixedVendorId={vendorId}
                locations={locations}
                packFormats={packFormats}
                measureUnits={measureUnits}
                actorLevel={actorLevel}
                busy={busy}
                errorMsg={errorMsg}
                submitLabel={t("admin.skus.add")}
                allSkus={collisionCandidates}
                onSubmit={(values, chain) => void create(values, chain)}
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
  chain,
  readiness,
  canManage,
  confirming,
  busy,
  onEdit,
  onAskDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
}: {
  sku: SkuView;
  chain: PackChainLevel[] | null;
  readiness: Readiness | null;
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
  meta.push(formatSkuPack(s, t, chain));
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
            <span className="inline-flex items-center rounded-full bg-co-gold/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-gold-text">
              {s.locationName}
            </span>
          ) : null}
          {readiness ? <StatusBadge status={readiness.status as "incomplete" | "upstream_gaps"} /> : null}
        </div>
        <div className="text-co-text-muted">{meta.join(" · ")}</div>
        {readiness ? <ReadinessReasons reasons={readiness.reasons} /> : null}
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
