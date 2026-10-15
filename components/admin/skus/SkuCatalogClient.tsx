"use client";

/**
 * SkuCatalogClient — the global SKU catalog (/admin/skus). Lists ALL SKUs with
 * a vendor filter ("All" / each vendor / "Manual — no vendor"), and (GM+) an
 * Add SKU form with a vendor dropdown (so a SKU can be created vendor-less or
 * assigned to a vendor) + a per-SKU Edit (incl. reassigning the vendor — this
 * is how the 24 Baldor placeholders get moved) + deactivate.
 *
 * Authority (matches the routes): create + edit + reactivate = Tier E (the catalog edit
 * window); deactivate = a one-shot grant (a password every time).
 * Filtering is client-side over the full set the server loaded.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { useStepUpPost } from "@/components/admin/useStepUpPost";
import type { RegistryOption, MeasureUnitOption, SkuView } from "@/lib/admin/skus";
import { resolveErrorKey, formatSkuPack, STEP_UP_CANCELLED, type SaveChainResult } from "./shared";
import type { SkuReceivingLedger, SkuConsumption } from "@/lib/admin/cost";
import type { Readiness } from "@/lib/readiness";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { StarterChainLevel, SkuNameCollisionCandidate, SkuClass } from "@/lib/admin/catalog-shared";
import { SKU_CLASSES } from "@/lib/admin/catalog-shared";
import { SKU_FILTER_ALL, skuFocusPatch } from "@/lib/admin/sku-focus-shared";
import { StatusBadge, ReadinessReasons } from "@/components/admin/StatusBadge";
import { SummaryRow } from "@/components/ui/SummaryRow";
import { SkuCostPanel, type SkuCostInfo } from "./SkuCostPanel";
import { SkuBuilder } from "./SkuBuilder";
import type {
  SkuFormLocationOption,
  SkuFormProductOption,
  SkuFormValues,
  SkuFormVendorOption,
} from "./SkuBuilder";
import type { LocationSkuOverlayView } from "./SkuLocationOverlay";
import type { SkuDataShop } from "@/lib/sku-data-readiness";
import { SkuDataChips, SkuDataDrawer, SkuDataHeader } from "./SkuDataLane";

// Vendor-select sentinels distinct from any real vendor id.
const FILTER_ALL = SKU_FILTER_ALL;
const FILTER_MANUAL = "__manual__";

const tk = (k: string): TranslationKey => k as TranslationKey;

// Catalog lenses (council PR-A): the four CLASS chips filter by sku_class; the
// two cross-cutting status chips (No pack info / Unverified) carry the campaign
// counters (D2 — never collapse). Vendor stays a SELECT (17 = chip sprawl, D8).
type Lens = "all" | SkuClass | "no_pack_info" | "unverified";
const LENSES: Lens[] = ["all", ...SKU_CLASSES, "no_pack_info", "unverified"];

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
  skuDataShops,
  skuDataUnavailable = false,
  chainsBySku,
  chainVersionBySku,
  chainUnverifiedBySku,
  overlaysBySku,
  products,
  productIdBySku,
  parsFieldsReady,
  actorLevel,
  canManage,
  focusSkuId = null,
  initialVendorFilter = null,
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
  skuDataShops: SkuDataShop[];
  skuDataUnavailable?: boolean;
  /** Server batch-loaded active chains per SKU (no lazy GET). Absent = unchained. */
  chainsBySku: Record<string, PackChainLevel[]>;
  /** The GLOBAL live version id each chain was loaded at (catalog Phase 2a). Absent = unchained. */
  chainVersionBySku: Record<string, string>;
  /** Server flag: the chain fails reachability/termination ("chain unverified"). */
  chainUnverifiedBySku: Record<string, boolean>;
  /** VO-7: per-location overlay rows per SKU (edit-mode overlay section). */
  overlaysBySku: Record<string, LocationSkuOverlayView[]>;
  /** Products a SKU may join (0179). Empty until the registry has rows — the
   *  builder then renders no picker and sends no productId key. */
  products: SkuFormProductOption[];
  /** skuId → its product (0179), seeded from the registry rather than from the
   *  SKU loader (vendor_items.product_id is not in SKU_COLS while 0179 is
   *  unapplied). Absent = implicit singleton. */
  productIdBySku: Record<string, string>;
  /** True once migration 0182 (GATE M1) applied — gates the Ordering-rhythm group. */
  parsFieldsReady: boolean;
  actorLevel: number;
  canManage: boolean; // GM+
  /** ?sku=<id> deep link (catalog Phase 1): the row opens, scrolls into view and is ringed. */
  focusSkuId?: string | null;
  /** ?vendor=<id> deep link: preselect the vendor filter (a focused SKU wins). */
  initialVendorFilter?: string | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp, requestStepUpGrant } = useStepUp();
  const send = useStepUpPost();

  // The deep link's FIRST patch seeds the initial state; later param changes re-patch below.
  const [initialPatch] = useState(() =>
    skuFocusPatch({ focusSkuId: null, vendorParam: null }, { focusSkuId, vendorParam: initialVendorFilter }, new Set(vendors.map((v) => v.id))),
  );
  const [vendorFilter, setVendorFilter] = useState<string>(initialPatch?.vendorFilter ?? FILTER_ALL);
  const [lens, setLens] = useState<Lens>("all");
  const [query, setQuery] = useState("");
  const [needsErrand, setNeedsErrand] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // D7 browse multi-expand: which non-editing rows have their cost-panel drawer
  // open. Caller-owned Set (mirrors CatalogClient) so several can be open at once
  // and collapse preserves scroll. Drawer children (the SkuCostPanel) lazy-render
  // only when expanded → 0 cost panels on first paint (the ×163 fix).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialPatch?.expand ? [initialPatch.expand] : []));

  // P2-6: a client-side navigation ?sku=A → ?sku=B keeps this component mounted, so the params
  // are re-applied with the during-render prev-compare pattern (AGENTS.md), never an effect.
  const vendorIds = useMemo(() => new Set(vendors.map((v) => v.id)), [vendors]);
  const [seenParams, setSeenParams] = useState({ focusSkuId, vendorParam: initialVendorFilter });
  if (seenParams.focusSkuId !== focusSkuId || seenParams.vendorParam !== initialVendorFilter) {
    const patch = skuFocusPatch(seenParams, { focusSkuId, vendorParam: initialVendorFilter }, vendorIds);
    setSeenParams({ focusSkuId, vendorParam: initialVendorFilter });
    if (patch) {
      if (patch.vendorFilter !== null) setVendorFilter(patch.vendorFilter);
      if (patch.resetOtherFilters) {
        setLens("all");
        setQuery("");
        setNeedsErrand(false);
      }
      const target = patch.expand;
      if (target) setExpanded((prev) => new Set(prev).add(target));
    }
  }

  // The hash already scrolls on a full load; this covers a client-side navigation (A → B) too.
  useEffect(() => {
    if (!focusSkuId) return;
    document.getElementById(focusSkuId)?.scrollIntoView({ block: "start" });
  }, [focusSkuId]);
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isChained = (id: string) => (chainsBySku[id]?.length ?? 0) > 0;
  // "No pack info" = an ACTIVE SKU with no chain (the completion campaign).
  const isNoPackInfo = (s: SkuView) => s.active && !isChained(s.id);
  const isUnverified = (id: string) => chainUnverifiedBySku[id] === true;

  // Collision candidates for the builder's name warning (active raw SKUs live).
  const collisionCandidates: SkuNameCollisionCandidate[] = useMemo(
    // vendorId/vendorName ride along so the builder distinguishes a same-vendor DUPLICATE
    // from a cross-vendor backup twin (audit P7).
    () => skus.map((s) => ({ id: s.id, name: s.name, active: s.active, vendorId: s.vendorId, vendorName: s.vendorName })),
    [skus],
  );

  // Campaign counters (D2 — always visible on the chips). "No pack info" is the
  // completion clock; "Unverified" is the class-aware badge count.
  const noPackInfoCount = useMemo(
    () => skus.filter((s) => isNoPackInfo(s)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skus, chainsBySku],
  );
  const unverifiedCount = useMemo(
    () => skus.filter((s) => isUnverified(s.id)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skus, chainUnverifiedBySku],
  );

  function matchesLens(s: SkuView, l: Lens): boolean {
    switch (l) {
      case "all": return true;
      case "no_pack_info": return isNoPackInfo(s);
      case "unverified": return isUnverified(s.id);
      default: return s.skuClass === l; // one of the four class chips
    }
  }

  // Vendor select → lens chip → search (name + item #), all AND-composed.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skus.filter((s) => {
      if (vendorFilter === FILTER_MANUAL) { if (s.vendorId !== null) return false; }
      else if (vendorFilter !== FILTER_ALL) { if (s.vendorId !== vendorFilter) return false; }
      if (!matchesLens(s, lens)) return false;
      if (needsErrand && !skuDataUnavailable && !skuDataShops.some(shop => (shop.bySku[s.id]?.errands.length ?? 0) > 0)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.itemNumber?.toLowerCase().includes(q) ?? false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus, vendorFilter, lens, query, chainsBySku, chainUnverifiedBySku, needsErrand, skuDataShops, skuDataUnavailable]);

  // Group the filtered set by CLASS (the manager's mental shelf), in the fixed
  // SKU_CLASSES order; each group header carries an i18n'd count (D5).
  const groups = useMemo(() => {
    const map = new Map<SkuClass, SkuView[]>();
    for (const c of SKU_CLASSES) map.set(c, []);
    for (const s of filtered) map.get(s.skuClass)?.push(s);
    return SKU_CLASSES
      .map((c) => [c, map.get(c) ?? []] as const)
      .filter(([, rows]) => rows.length > 0);
  }, [filtered]);

  const create = async (values: SkuFormValues, chain: StarterChainLevel[] | null) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    // Atomic add: identity + optional starter/edited chain in ONE request.
    const result = await send("/api/admin/skus", { ...values, chain });
    setBusy(false);
    if (result.ok) {
      setAdding(false);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  const saveEdit = async (id: string, values: SkuFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("E")) !== "ok") return;
    setBusy(true);
    const result = await send(`/api/admin/skus/${id}`, values, "PATCH");
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  // Edit-mode chain save (the SKU exists → the pack-chain route). Its own Tier E
  // step-up (mirrors the retired SkuPackChainPanel). Returns ok so the builder
  // can close the editor + refresh the seeded chain. When the wizard hands an
  // `avgOzPerEach` (its raw count/volume leaf), PATCH it onto the SKU FIRST so
  // the chain's count leaf is oz-resolvable at validation (both writes ride the
  // one Tier E step-up). The chain editor passes no avg → skips the PATCH.
  const saveChain = async (
    id: string,
    levels: StarterChainLevel[],
    avgOzPerEach?: number | null,
  ): Promise<SaveChainResult> => {
    setErrorMsg(null);
    // The builder shows the refusal's own message (SaveChainResult.code), so nothing is set here.
    if ((await requestStepUp("E")) !== "ok") return { ok: false, code: STEP_UP_CANCELLED };
    if (avgOzPerEach !== undefined && avgOzPerEach !== null) {
      const avgResult = await send(`/api/admin/skus/${id}`, { avgOzPerEach }, "PATCH");
      if (!avgResult.ok) return { ok: false, code: avgResult.code };
    }
    const payload = levels.map((l) => ({
      label: l.label,
      containsQty: l.containsQty,
      containsIndex: l.containsIndex,
      containsMeasureUnit: l.containsMeasureUnit,
    }));
    // The GLOBAL live version this form was loaded with (null = it showed no chain) — chunk-4 P3c.
    const result = await send(`/api/admin/skus/${id}/pack-chain`, { levels: payload, expectedLiveVersionId: chainVersionBySku[id] ?? null }, "POST");
    if (result.ok) {
      router.refresh();
      return { ok: true };
    }
    return { ok: false, code: result.code };
  };

  const toggleActive = async (sku: SkuView) => {
    if (busy) return;
    setErrorMsg(null);
    // Deactivating a SKU is destructive: a one-shot password for THIS SKU, every time.
    // Reactivating is an ordinary edit inside the 15-minute window.
    const gate = sku.active
      ? await requestStepUpGrant({ action: "sku.deactivate", targetId: sku.id })
      : await requestStepUp("E");
    if (gate !== "ok") return;
    setBusy(true);
    const result = await send(`/api/admin/skus/${sku.id}`, { active: !sku.active }, "PATCH");
    setBusy(false);
    if (result.ok) {
      setConfirmDeactivateId(null);
      router.refresh();
    } else setErrorMsg(t(resolveErrorKey(result.code)));
  };

  // One SKU row — editing swaps in the SkuBuilder, else the SummaryRow. Shared
  // by every class group (avoids duplicating the block per section).
  const renderRow = (s: SkuView) => (
    <li
      key={s.id}
      id={s.id}
      className={
        // Editing rows keep the card chrome around SkuBuilder; non-editing
        // rows let SummaryRow be the card (avoids a nested double-card).
        (editingId === s.id ? "rounded-lg border-2 border-co-border bg-co-surface p-3 " : "") +
        "scroll-mt-24 " + (s.active ? "" : "opacity-60") + (s.id === focusSkuId ? " rounded-lg ring-4 ring-co-gold/60" : "")
      }
    >
      {editingId === s.id ? (
        <SkuBuilder
          initial={s}
          initialChain={chainsBySku[s.id] ?? null}
          initialChainUnverified={chainUnverifiedBySku[s.id] ?? false}
          vendors={vendors}
          locations={locations}
          products={products}
          initialProductId={productIdBySku[s.id] ?? null}
          parsFieldsReady={parsFieldsReady}
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
        <CatalogRow
          sku={s}
          chain={chainsBySku[s.id] ?? null}
          readiness={skuReadiness[s.id] ?? null}
          dataShops={skuDataShops}
          chained={isChained(s.id)}
          unverified={isUnverified(s.id)}
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
  );

  const chipCls = (active: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-3 text-xs font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 ${
      active ? "border-co-gold-deep bg-co-surface-2 text-co-text" : "border-co-border bg-co-surface text-co-text-muted hover:text-co-text"
    }`;

  // Chip label: the two cross-cutting lenses carry live campaign counters (D2/D5).
  const lensLabel = (l: Lens): string => {
    if (l === "no_pack_info") return t("admin.skus.lens.no_pack_info_n", { n: String(noPackInfoCount) });
    if (l === "unverified") return t("admin.skus.lens.unverified_n", { n: String(unverifiedCount) });
    return t(tk(`admin.skus.lens.${l}`));
  };

  return (
    <div className="mt-5 flex flex-col gap-4">
      <SkuDataHeader shops={skuDataShops} unavailable={skuDataUnavailable} />
      {/* Lens chips (D6): class set + the two cross-cutting status lenses. */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chipCls(needsErrand)} aria-pressed={needsErrand} disabled={skuDataUnavailable} onClick={() => setNeedsErrand(value => !value)}>
          {t("admin.skus.data.needs_errand")}
        </button>
        {LENSES.map((l) => (
          <button
            key={l}
            type="button"
            className={chipCls(lens === l)}
            aria-pressed={lens === l}
            onClick={() => setLens(l)}
          >
            {lensLabel(l)}
          </button>
        ))}
      </div>

      {/* Vendor select (stays a select — 17 = chip sprawl, D8) + search + count + Add. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-sm font-bold text-co-text">{t("admin.skus.filter.vendor")}</span>
            <select
              className="mt-1 min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
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
            <span className="text-sm font-bold text-co-text">{t("admin.skus.search_label")}</span>
            <input
              type="search"
              aria-label={t("admin.skus.search_label")}
              placeholder={t("admin.skus.search_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mt-1 min-h-[44px] w-full max-w-xs rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
            />
          </label>

          <span className="pb-2 text-xs font-semibold text-co-text-muted">
            {t("admin.skus.count_shown", { n: String(filtered.length) })}
          </span>
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
        <div>
          <SkuBuilder
            vendors={vendors}
            locations={locations}
            products={products}
            parsFieldsReady={parsFieldsReady}
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

      {groups.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
          {t("admin.skus.empty")}
        </div>
      ) : (
        groups.map(([klass, rows]) => (
          <section key={klass}>
            <h2 className="text-sm font-extrabold uppercase tracking-wide text-co-text-muted">
              {t(tk(`admin.skus.lens.${klass}`))} · {t("admin.skus.group_count", { n: String(rows.length) })}
            </h2>
            <ul className="mt-2 flex flex-col gap-2">
              {rows.map((s) => renderRow(s))}
            </ul>
          </section>
        ))
      )}

      {errorMsg && editingId === null && !adding ? (
        <p className="mt-2 text-sm text-co-cta-text">{errorMsg}</p>
      ) : null}
    </div>
  );
}

/**
 * Read row → summary + drawer (Disclosure W2, docs/DISCLOSURE_DOCTRINE.md).
 *
 * ALWAYS-VISIBLE summary (D1): name + meta dot-string (class · vendor/Manual ·
 * location · pack · item#). Never-collapse alerts (D2) stay on the collapsed
 * line via SummaryRow's badges slot: inactive · No pack info · Unverified (with
 * a what-to-fix tooltip) · readiness StatusBadge + ReadinessReasons — the signals
 * a broken SKU still shouts even collapsed. NOTE the readiness badge is derived
 * from the `readiness` prop (skuReadiness), NOT from the SkuCostPanel — relocating
 * the panel never hides it.
 *
 * The SkuCostPanel (cost/oz, stock, receiving ledger, "Record price") is SECONDARY
 * content → lives in the lazy drawer (D3/D10): 0 panels render on first paint.
 * Management actions (Edit / "Add ordering info" trigger + Deactivate, D4) stay
 * reachable on the summary. A no-pack-info SKU's CTA reads "Add ordering info"
 * (task-oriented) instead of "Edit".
 */
function CatalogRow({
  sku: s,
  chain,
  readiness,
  dataShops,
  chained,
  unverified,
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
  chain: PackChainLevel[] | null;
  readiness: Readiness | null;
  dataShops: SkuDataShop[];
  chained: boolean;
  unverified: boolean;
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
  meta.push(formatSkuPack(s, t, chain));
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
            <span className="inline-flex items-center rounded-full bg-co-danger-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-cta-text">
              {t("admin.skus.no_pack_info")}
            </span>
          ) : null}
          {/* Unverified = class-aware structural/oz problem — carries a
              what-to-fix tooltip (D2 alert; never hidden even collapsed). */}
          {unverified ? (
            <span
              className="inline-flex items-center rounded-full bg-co-danger-surface px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-co-cta-text"
              title={t("admin.skus.unverified_hint")}
            >
              {t("admin.skus.unverified_badge")}
            </span>
          ) : null}
          {readiness ? <StatusBadge status={readiness.status as "incomplete" | "upstream_gaps"} /> : null}
          {readiness ? <ReadinessReasons reasons={readiness.reasons} /> : null}
          <SkuDataChips skuId={s.id} shops={dataShops} />
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
                  {/* Task-oriented CTA for a no-pack-info SKU (sonnet's vocabulary find). */}
                  {s.active && !chained ? t("admin.skus.add_ordering_info") : t("admin.skus.edit")}
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
      <SkuDataDrawer skuId={s.id} shops={dataShops} />
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
