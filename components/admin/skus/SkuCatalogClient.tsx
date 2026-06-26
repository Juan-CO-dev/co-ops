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
import type { RegistryOption, SkuView } from "@/lib/admin/skus";
import { postJson, resolveErrorKey, formatSkuPack } from "./shared";
import {
  SkuForm,
  type SkuFormLocationOption,
  type SkuFormValues,
  type SkuFormVendorOption,
} from "./SkuForm";

// Filter sentinels distinct from any real vendor id.
const FILTER_ALL = "__all__";
const FILTER_MANUAL = "__manual__";

export function SkuCatalogClient({
  skus,
  vendors,
  locations,
  packFormats,
  measureUnits,
  actorLevel,
  canManage,
}: {
  skus: SkuView[];
  vendors: SkuFormVendorOption[];
  locations: SkuFormLocationOption[];
  packFormats: RegistryOption[];
  measureUnits: RegistryOption[];
  actorLevel: number;
  canManage: boolean; // GM+
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { requestStepUp } = useStepUp();

  const [filter, setFilter] = useState<string>(FILTER_ALL);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === FILTER_ALL) return skus;
    if (filter === FILTER_MANUAL) return skus.filter((s) => s.vendorId === null);
    return skus.filter((s) => s.vendorId === filter);
  }, [skus, filter]);

  const create = async (values: SkuFormValues) => {
    if (busy) return;
    setErrorMsg(null);
    if ((await requestStepUp("B")) !== "ok") return;
    setBusy(true);
    const result = await postJson("/api/admin/skus", values);
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
    <div className="mt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
          <SkuForm
            vendors={vendors}
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
              className={"rounded-lg border-2 border-co-border bg-co-surface p-3 " + (s.active ? "" : "opacity-60")}
            >
              {editingId === s.id ? (
                <SkuForm
                  initial={s}
                  vendors={vendors}
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
                <CatalogRow
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

/** Read row: name · vendor name or "Manual" · location · unit · item#. */
function CatalogRow({
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
  meta.push(s.vendorName ?? t("admin.skus.manual"));
  meta.push(s.locationName ?? t("admin.skus.global"));
  meta.push(formatSkuPack(s, t));
  if (s.itemNumber) meta.push(`#${s.itemNumber}`);

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
