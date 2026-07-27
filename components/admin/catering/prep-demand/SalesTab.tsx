"use client";

/**
 * SalesTab — Toast sales → depletion projection (read-track 2). Self-fetching:
 * the consumption GET reads only the local ledger (cheap, auto-loads per
 * date/location); the PULL button (GM+ ≥7, Tier-A step-up) calls Toast and
 * appends ledger versions, then reloads. Includes the ingest-exclusions
 * manager (the catering double-count rule) and the advisory lists.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { SalesConsumption, ExclusionView } from "@/lib/catering/toast-sales";

type MappableEntity = { id: string; name: string; kind: "item" | "menu_item" | "package" | "sku"; locationId: string | null };

/** Behavior targets for platter assortment picks (no entityId — the parent's package supplies the pool). */
const ASSORTMENT_KINDS = ["assortment_classics", "assortment_full"] as const;

function yesterdayEt(): string {
  const nowEt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  nowEt.setDate(nowEt.getDate() - 1);
  return nowEt.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

const KNOWN = new Set([
  "forbidden", "invalid_payload", "invalid_date", "invalid_kind", "invalid_value", "not_found",
  "location_not_found", "not_configured", "auth_failed", "rate_limited", "bad_payload", "concurrent_pull", "invalid_entity", "conflict",
  "step_up_required", "step_up_stale", "generic",
]);
function errKey(code: string): TranslationKey {
  return (KNOWN.has(code) ? `admin.toastsales.error.${code}` : "admin.toastsales.error.generic") as TranslationKey;
}

export function SalesTab({ locationId, canPull }: { locationId: string | null; canPull: boolean }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(yesterdayEt());
  const [report, setReport] = useState<SalesConsumption | null>(null);
  const [exclusions, setExclusions] = useState<ExclusionView[]>([]);
  const [entities, setEntities] = useState<MappableEntity[]>([]);
  const [mapDraft, setMapDraft] = useState<Record<string, string>>({}); // guid -> "kind:id"
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<null | (() => Promise<void>)>(null);
  const loadSeq = useRef(0);
  const [exKind, setExKind] = useState("dining_option");
  const [exValue, setExValue] = useState("");
  const [showExclusions, setShowExclusions] = useState(false);

  const load = useCallback(async () => {
    if (!locationId) return;
    const seq = ++loadSeq.current; // stale responses (rapid date flips) must not overwrite newer ones
    setLoading(true);
    setErrorKey(null);
    try {
      const res = await fetch(`/api/admin/toast-sales/consumption?locationId=${locationId}&date=${date}`, { redirect: "manual" });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { code?: string };
        setErrorKey(errKey(b.code ?? "generic"));
        return;
      }
      const data = (await res.json()) as { report: SalesConsumption; exclusions: ExclusionView[]; entities?: MappableEntity[] };
      if (seq !== loadSeq.current) return;
      setReport(data.report);
      setExclusions(data.exclusions);
      setEntities(data.entities ?? []);
    } catch {
      setErrorKey("admin.toastsales.error.generic" as TranslationKey);
    } finally {
      setLoading(false);
    }
  }, [locationId, date]);

  useEffect(() => { void load(); }, [load]);

  const write = useCallback(async (url: string, body: unknown) => {
    setErrorKey(null);
    setBusy(true);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), redirect: "manual" });
      if (res.ok) { setStepUpOpen(false); pendingRef.current = null; await load(); return; }
      const b = (await res.json().catch(() => ({}))) as { code?: string };
      if (b.code === "step_up_required" || b.code === "step_up_stale") {
        pendingRef.current = () => write(url, body);
        setStepUpOpen(true);
        return;
      }
      setErrorKey(errKey(b.code ?? "generic"));
    } catch {
      setErrorKey("admin.toastsales.error.generic" as TranslationKey);
    } finally {
      setBusy(false);
    }
  }, [load]);

  const btn = "inline-flex min-h-[36px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text disabled:opacity-50";
  const inputCls = "min-h-[36px] rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text";
  const h3 = "mb-2 text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim";

  if (!locationId) return <p className="mt-5 text-sm text-co-text-muted">{t("admin.toastsales.no_location")}</p>;

  return (
    <div className="mt-5 flex flex-col gap-5">
      {errorKey && <p className="text-sm font-semibold text-co-cta">{t(errorKey)}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="sales-date" className="text-xs font-bold uppercase tracking-wide text-co-text-dim">{t("admin.toastsales.date_label")}</label>
        <input id="sales-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        {canPull && (
          <button type="button" className={btn} disabled={busy} onClick={() => write("/api/admin/toast-sales/pull", { locationId, businessDate: date })}>
            {busy ? t("admin.toastsales.working") : t("admin.toastsales.pull")}
          </button>
        )}
        <button type="button" className={btn} disabled={loading} onClick={() => void load()}>{t("admin.toastsales.refresh")}</button>
      </div>

      {loading && <p className="text-sm text-co-text-muted">{t("admin.toastsales.loading")}</p>}

      {report && !loading && (
        <>
          {report.soldLines.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-co-border p-6 text-center text-sm text-co-text-muted">
              {t("admin.toastsales.empty")}
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <section className="co-card p-4">
                <h3 className={h3}>{t("admin.toastsales.prep_heading")}</h3>
                <ul className="flex flex-col gap-1 text-sm text-co-text">
                  {report.prepConsumed.map((r) => (
                    <li key={r.itemId} className="flex justify-between gap-2">
                      <span>{r.name}{r.removedUnits > 0 ? <span className="ml-1 text-xs text-co-cta">(−{r.removedUnits.toFixed(2)} {t("admin.toastsales.removed_tag")})</span> : null}</span>
                      <span className="font-semibold">{r.units.toFixed(2)}</span>
                    </li>
                  ))}
                  {report.prepConsumed.length === 0 && <li className="text-co-text-muted">{t("admin.toastsales.none")}</li>}
                </ul>
              </section>
              <section className="co-card p-4">
                <h3 className={h3}>{t("admin.toastsales.sku_heading")}</h3>
                <ul className="flex flex-col gap-1 text-sm text-co-text">
                  {report.skuConsumed.map((r) => (
                    <li key={r.skuId} className="flex justify-between gap-2">
                      <span>{r.name}{r.removedOz > 0 ? <span className="ml-1 text-xs text-co-cta">(−{r.removedOz.toFixed(1)} oz {t("admin.toastsales.removed_tag")})</span> : null}</span>
                      <span className="font-semibold">{r.oz.toFixed(1)} oz</span>
                    </li>
                  ))}
                  {report.skuConsumed.length === 0 && <li className="text-co-text-muted">{t("admin.toastsales.none")}</li>}
                </ul>
              </section>
              <section className="co-card p-4 md:col-span-2">
                <h3 className={h3}>{t("admin.toastsales.sold_heading")}</h3>
                <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-co-text">
                  {report.soldLines.map((r) => (
                    <li key={`${r.kind}:${r.name}`}>{r.name} × {r.quantity}</li>
                  ))}
                </ul>
              </section>
            </div>
          )}

          {(report.modifierStats.depleted > 0 || report.modifierStats.removed > 0 || report.modifierStats.portionNeeded.length > 0) && (
            <p className="text-sm text-co-text-muted">
              {t("admin.toastsales.modifiers_line")}: +{report.modifierStats.depleted} · −{report.modifierStats.removed} · {t("admin.toastsales.ignored")} {report.modifierStats.ignored}
            </p>
          )}

          {(report.unmappedToastItems.length > 0 || report.suspectedCatering.length > 0 || report.excludedCount > 0 || report.modifierStats.portionNeeded.length > 0 || report.packageIssues.length > 0) && (
            <section className="rounded-xl border border-co-border/60 bg-co-bg/40 p-4">
              <h3 className={h3}>{t("admin.toastsales.advisories_heading")}</h3>
              {report.excludedCount > 0 && (
                <p className="text-sm text-co-text-muted">{t("admin.toastsales.excluded_count")}: {report.excludedCount}</p>
              )}
              {report.unmappedToastItems.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm font-semibold text-co-text">{t("admin.toastsales.unmapped_heading")}</p>
                  <ul className="flex flex-col gap-1 text-sm text-co-text-muted">
                    {report.unmappedToastItems.map((u) => (
                      <li key={u.toastItemGuid} className="flex flex-wrap items-center gap-2">
                        <span>{u.name} × {u.quantity}{u.isModifier ? ` (${t("admin.toastsales.modifier_tag")})` : ""}</span>
                        {canPull && locationId && (
                          <>
                            <select
                              aria-label={t("admin.toastsales.map_to_label")}
                              value={mapDraft[u.toastItemGuid] ?? ""}
                              onChange={(e) => setMapDraft((prev) => ({ ...prev, [u.toastItemGuid]: e.target.value }))}
                              className={inputCls}
                            >
                              <option value="">{t("admin.toastsales.map_to_label")}</option>
                              {u.isModifier && ASSORTMENT_KINDS.map((k) => (
                                <option key={k} value={k}>{t(`admin.toastsales.${k}` as TranslationKey)}</option>
                              ))}
                              {entities
                                // modifiers target items/menu_items (sub picks) + raw SKUs (Part 2:
                                // Sub Roll, condiments); base lines target items/menu_items + packages
                                // FOR THIS LOCATION (never a raw SKU — a SKU is never a sold base line).
                                .filter((en) => u.isModifier
                                  ? en.kind !== "package"
                                  : en.kind === "sku"
                                    ? false
                                    : en.kind !== "package" || en.locationId == null || en.locationId === locationId)
                                .map((en) => (
                                  <option key={`${en.kind}:${en.id}`} value={`${en.kind}:${en.id}`}>
                                    {en.name}{en.kind === "menu_item" ? ` (${t("admin.toastsales.menu_tag")})` : en.kind === "package" ? ` (${t("admin.toastsales.package_tag")})` : en.kind === "sku" ? ` (${t("admin.toastsales.raw_tag")})` : ""}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="button" className={btn}
                              disabled={busy || !(mapDraft[u.toastItemGuid] ?? "")}
                              onClick={() => {
                                const draft = mapDraft[u.toastItemGuid] ?? "";
                                const isAssortment = (ASSORTMENT_KINDS as readonly string[]).includes(draft);
                                const [kind, id] = isAssortment ? [draft, undefined] : draft.split(":");
                                if (!isAssortment && !id) return;
                                void write("/api/admin/toast-map/manual", {
                                  locationId, toastItemGuid: u.toastItemGuid, toastItemName: u.name,
                                  entityKind: kind, ...(isAssortment ? {} : { entityId: id }), isModifier: u.isModifier,
                                });
                              }}
                            >
                              {t("admin.toastsales.map_button")}
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.modifierStats.portionNeeded.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm font-semibold text-co-text">{t("admin.toastsales.portion_needed_heading")}</p>
                  <ul className="text-sm text-co-text-muted">
                    {report.modifierStats.portionNeeded.map((u) => (<li key={u.name}>{u.name} × {u.quantity}</li>))}
                  </ul>
                </div>
              )}
              {report.packageIssues.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm font-semibold text-co-text">{t("admin.toastsales.package_issues_heading")}</p>
                  <ul className="text-sm text-co-text-muted">
                    {report.packageIssues.map((u) => (
                      <li key={`${u.name}:${u.issue}`}>{u.name} — {t(`admin.toastsales.issue.${u.issue}` as TranslationKey)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report.suspectedCatering.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm font-semibold text-co-cta">{t("admin.toastsales.suspected_heading")}</p>
                  <ul className="text-sm text-co-text-muted">
                    {report.suspectedCatering.map((s) => (
                      <li key={s.checkGuid}>
                        {s.diningOption ?? "—"} · {t("admin.toastsales.qty")} {s.totalQty} · {s.reason === "name" ? t("admin.toastsales.reason_name") : t("admin.toastsales.reason_qty")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <section className="rounded-xl border border-co-border/60 bg-co-bg/40 p-4">
        <button type="button" className="text-sm font-bold text-co-text" onClick={() => setShowExclusions((v) => !v)} aria-expanded={showExclusions}>
          {t("admin.toastsales.exclusions_heading")} ({exclusions.length}) {showExclusions ? "▾" : "▸"}
        </button>
        {showExclusions && (
          <div className="mt-3 flex flex-col gap-2">
            <ul className="flex flex-col gap-1 text-sm text-co-text">
              {exclusions.map((ex) => (
                <li key={ex.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{t(`admin.toastsales.kind.${ex.kind}` as TranslationKey)}</span>
                    {" = "}{ex.value}
                    {ex.locationId == null ? ` · ${t("admin.toastsales.all_locations")}` : ""}
                  </span>
                  {canPull && (
                    <button type="button" className={btn} disabled={busy} onClick={() => write(`/api/admin/toast-sales/exclusions/${ex.id}`, { action: "deactivate" })}>
                      {t("admin.toastsales.remove")}
                    </button>
                  )}
                </li>
              ))}
              {exclusions.length === 0 && <li className="text-co-text-muted">{t("admin.toastsales.no_exclusions")}</li>}
            </ul>
            {canPull && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-co-border/50 pt-2">
                <select aria-label={t("admin.toastsales.kind_label")} value={exKind} onChange={(e) => setExKind(e.target.value)} className={inputCls}>
                  <option value="dining_option">{t("admin.toastsales.kind.dining_option")}</option>
                  <option value="menu_group">{t("admin.toastsales.kind.menu_group")}</option>
                  <option value="toast_item_guid">{t("admin.toastsales.kind.toast_item_guid")}</option>
                  <option value="item_name_contains">{t("admin.toastsales.kind.item_name_contains")}</option>
                </select>
                <input aria-label={t("admin.toastsales.value_label")} value={exValue} onChange={(e) => setExValue(e.target.value)} placeholder={t("admin.toastsales.value_label")} className={`${inputCls} w-48`} />
                <button
                  type="button" className={btn} disabled={busy || exValue.trim().length === 0}
                  onClick={() => { void write("/api/admin/toast-sales/exclusions", { locationId: null, kind: exKind, value: exValue.trim() }); setExValue(""); }}
                >
                  + {t("admin.toastsales.add_exclusion")}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <PasswordModal open={stepUpOpen} onConfirm={async () => { if (pendingRef.current) await pendingRef.current(); }} onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }} />
    </div>
  );
}
