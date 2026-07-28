"use client";

/**
 * SkuCatalogClient — the global SKU catalog (/admin/skus). Lists ALL SKUs with
 * a vendor filter ("All" / each vendor / "Manual — no vendor"), and (GM+) an
 * Add SKU form with a vendor dropdown (so a SKU can be created vendor-less or
 * assigned to a vendor) + a per-SKU Edit (incl. reassigning the vendor — this
 * is how the 24 Baldor placeholders get moved) + deactivate.
 *
 * Authority (matches the routes): create = Tier B; edit + deactivate = Tier A.
 * Filtering is client-side over the full set the server loaded.
 */

import { useMemo, useState } from "react";
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
import { SummaryRow } from "@/components/ui/SummaryRow";
import { SkuCostPanel, type SkuCostInfo } from "./SkuCostPanel";
import { SkuBuilder } from "./SkuBuilder";
import type {
  SkuFormLocationOption,
  SkuFormValues,
  SkuFormVendorOption,
} from "./SkuForm";

// Filter sentinels distinct from any real vendor id.
const FILTER_ALL = "__all__";
const FILTER_MANUAL = "__manual__";
// Chain-completeness filter (design §3 "unchained (N)").
const CHAIN_ALL = "__chain_all__";
const CHAIN_UNCHAINED = "__unchained__";

export function SkuCatalogClient({
  skus,
  vendors,
  locations,
  packFormats,
  measureUnits,
  skuCost,
  skuLedger,
  skuConsumption,
  skuReadiness,
  chainsBySku,
  chainUnverifiedBySku,
  actorLevel,
  canManage,
}: {
  skus: SkuView[];
  vendors: SkuFormVendorOption[];
  locations: SkuFormLocationOption[];
  packFormats: RegistryOption[];
  measureUnits: MeasureUnitOption[];
  skuCost: Record<string, SkuCostInfo>;
  skuLedger: Record<string, SkuReceivingLedger>;
  skuConsumption: Record<string, SkuConsumption>;
  skuReadiness: Record<string, Readiness>;
  /** Server batch-loaded active chains per SKU (no lazy GET). Absent = unchained. */
  chainsBySku: Record<string, PackChainLevel[]>;
  /** Server flag: the chain fails reachability/termination ("chain unverified"). */
  chainUnverifiedBySku: Record<string, boolean>;
  actorLevel: number;
  canManage: boolean; // GM+
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [chainFilter, setChainFilter] = useState<string>(CHAIN_ALL);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // D7 browse multi-expand: which non-editing rows have their cost-panel drawer
  // open. Caller-owned Set (mirrors CatalogClient) so several can be open at once
  // and collapse preserves scroll. Drawer children (the SkuCostPanel) lazy-render
  // only when expanded → 0 cost panels on first paint (the ×163 fix).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isChained = (id: string) => (chainsBySku[id]?.length ?? 0) > 0;

  // Collision candidates for the builder's name warning (active raw SKUs live).
  const collisionCandidates: SkuNameCollisionCandidate[] = useMemo(
    () => skus.map((s) => ({ id: s.id, name: s.name, active: s.active })),
    [skus],
  );

  // "unchained (N)" counter — active SKUs with no chain (the completion clock).
  const unchainedCount = useMemo(
    () => skus.filter((s) => s.active && !isChained(s.id)).length,
    // isChained closes over chainsBySku; both are props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skus, chainsBySku],
  );

  const filtered = useMemo(() => {
    let list = skus;
    if (filter === FILTER_MANUAL) list = list.filter((s) => s.vendorId === null);
    else if (filter !== FILTER_ALL) list = list.filter((s) => s.vendorId === filter);
    if (chainFilter === CHAIN_UNCHAINED) list = list.filter((s) => !isChained(s.id));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, filter, chainFilter, chainsBySku]);

  const create = async (values: SkuFormValues, chain: StarterChainLevel[] | null) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    // Atomic add: identity + optional starter/edited chain in ONE request.
    const result = await postJson("/api/admin/skus", { ...values, chain });
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
  // step-up (mirrors the retired SkuPackChainPanel). Returns ok so the builder
  // can close the editor + refresh the seeded chain.
  const saveChain = async (id: string, levels: StarterChainLevel[]): Promise<boolean> => {
    setErrorMsg(null);
    if ((await requestStepUp("A")) !== "ok") return false;
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
    <div className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.skus.filter.vendor")}</span>
            <select
              className="mt-1 min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value={FILTER_ALL}>{t("admin.skus.filter.all")}</option>
              <option value={FILTER_MANUAL}>{t("admin.skus.filter.manual")}</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.skus.builder.section_pack")}</span>
            <select
              className="mt-1 min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
            >
              <option value={CHAIN_ALL}>{t("admin.skus.filter.all")}</option>
              <option value={CHAIN_UNCHAINED}>{t("admin.skus.filter.unchained")}</option>
            </select>
            <span className="mt-1 block text-xs font-semibold text-co-text-muted">
              {t("admin.skus.filter.unchained_count", { n: String(unchainedCount) })}
            </span>
          </label>
        </div>

        {canManage && !adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setErrorMsg(null);
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 text-sm font-bold uppercase tracking-[0.1em] text-co-text transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
          >
            {t("admin.skus.add_sku")}
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="mt-4">
          <SkuBuilder
            vendors={vendors}
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
      ) : null}

      {filtered.length === 0 ? (
        <div className="mt-5 rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.skus.empty")}
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {filtered.map((s) => (
            <li
              key={s.id}
              className={
                // Editing rows keep the card chrome around SkuBuilder; non-editing
                // rows let SummaryRow be the card (avoids a nested double-card).
                (editingId === s.id ? "rounded-lg border-2 border-co-border bg-co-surface p-3 " : "") +
                (s.active ? "" : "opacity-60")
              }
            >
              {editingId === s.id ? (
                <SkuBuilder
                  initial={s}
                  initialChain={chainsBySku[s.id] ?? null}
                  initialChainUnverified={chainUnverifiedBySku[s.id] ?? false}
                  vendors={vendors}
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
                  onSubmit={(values) => void saveEdit(s.id, values)}
                  onSaveChain={(levels) => saveChain(s.id, levels)}
                  onCancel={() => {
                    setEditingId(null);
                    setErrorMsg(null);
                  }}
                />
              ) : (
                <CatalogRow
                  sku={s}
                  readiness={skuReadiness[s.id] ?? null}
                  chained={isChained(s.id)}
                  canManage={canManage}
                  confirming={confirmDeactivateId === s.id}
                  busy={busy}
                  expanded={expanded.has(s.id)}
                  onToggle={() => toggleExpand(s.id)}
                  onEdit={() => {
                    setEditingId(s.id);
                    setErrorMsg(null);
                  }}
                  onAskDeactivate={() => setConfirmDeactivateId(s.id)}
                  onCancelDeactivate={() => setConfirmDeactivateId(null)}
                  onConfirmDeactivate={() => void toggleActive(s)}
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
    </div>
  );
}

/**
 * Read row → summary + drawer (Disclosure W2, docs/DISCLOSURE_DOCTRINE.md).
 *
 * ALWAYS-VISIBLE summary (D1): name + meta dot-string (class · vendor/Manual ·
 * location · pack · item#). Never-collapse alerts (D2) stay on the collapsed
 * line via SummaryRow's badges slot: inactive · unchained · readiness StatusBadge
 * + ReadinessReasons — the readiness/unchained signal a broken SKU still shouts
 * even collapsed. NOTE the readiness badge is derived from the `readiness` prop
 * (skuReadiness), NOT from the SkuCostPanel — relocating the panel never hides it.
 *
 * The SkuCostPanel (cost/oz, stock, receiving ledger, "Record price") is SECONDARY
 * content → lives in the lazy drawer (D3/D10): 0 panels render on first paint.
 * Management actions (Edit trigger + Deactivate, D4) stay reachable on the summary.
 */
function CatalogRow({
  sku: s,
  readiness,
  chained,
  canManage,
  confirming,
  busy,
  expanded,
  onToggle,
  onEdit,
  onAskDeactivate,
  onCancelDeactivate,
  onConfirmDeactivate,
  cost,
  ledger,
  consumption,
  canRecord,
}: {
  sku: SkuView;
  readiness: Readiness | null;
  chained: boolean;
  canManage: boolean;
  confirming: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAskDeactivate: () => void;
  onCancelDeactivate: () => void;
  onConfirmDeactivate: () => void;
  cost: SkuCostInfo;
  ledger: SkuReceivingLedger | null;
  consumption: SkuConsumption | null;
  canRecord: boolean;
}) {
  const { t } = useTranslation();
  const meta: string[] = [];
  meta.push(t(`admin.skus.sku_class.${s.skuClass}` as import("@/lib/i18n/types").TranslationKey));
  meta.push(s.vendorName ?? t("admin.skus.manual"));
  meta.push(s.locationName ?? t("admin.skus.global"));
  meta.push(formatSkuPack(s, t));
  if (s.itemNumber) meta.push(`#${s.itemNumber}`);

  const actionBtn =
    "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-xs font-bold text-co-text transition hover:border-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50";

  return (
    <SummaryRow
      expanded={expanded}
      onToggle={onToggle}
      toggleLabel={expanded ? t("admin.skus.hide_details") : t("admin.skus.show_details")}
      drawerId={`sku-cost-${s.id}`}
      summary={
        <div className="text-sm text-co-text">
          <div className="font-bold">{s.name}</div>
          <div className="text-co-text-muted">{meta.join(" · ")}</div>
        </div>
      }
      badges={
        <>
          {/* Never-collapse alerts (D2): stay visible on the collapsed summary. */}
          {!s.active ? (
            <span className="inline-flex items-center rounded-full bg-co-text/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-text-muted">
              {t("admin.skus.status.inactive")}
            </span>
          ) : null}
          {s.active && !chained ? (
            <span className="inline-flex items-center rounded-full bg-co-cta/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] text-co-cta">
              {t("admin.skus.filter.unchained")}
            </span>
          ) : null}
          {readiness ? <StatusBadge status={readiness.status as "incomplete" | "upstream_gaps"} /> : null}
          {readiness ? <ReadinessReasons reasons={readiness.reasons} /> : null}
          {/* Management actions (D4 triggers) — reachable without expanding. */}
          {canManage ? (
            confirming ? (
              <>
                <button type="button" disabled={busy} onClick={onCancelDeactivate} className={actionBtn}>
                  {t("admin.skus.cancel")}
                </button>
                <button type="button" disabled={busy} onClick={onConfirmDeactivate} className={actionBtn}>
                  {s.active ? t("admin.skus.deactivate") : t("admin.skus.reactivate")}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={onEdit} className={actionBtn}>
                  {t("admin.skus.edit")}
                </button>
                <button type="button" onClick={onAskDeactivate} className={actionBtn}>
                  {s.active ? t("admin.skus.deactivate") : t("admin.skus.reactivate")}
                </button>
              </>
            )
          ) : null}
        </>
      }
    >
      <SkuCostPanel
        skuId={s.id}
        cost={cost}
        ledger={ledger}
        consumption={consumption}
        canRecord={canRecord}
      />
    </SummaryRow>
  );
}
