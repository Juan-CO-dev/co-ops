"use client";

/**
 * ToastTab — the Toast crosswalk surface (read-track 1). Per location: the
 * restaurant-GUID field, Run match / Check drift actions, the candidate
 * confirm queue, confirmed/stale mappings, and the advisory drift report.
 * Every write is Tier-A step-up gated (same PasswordModal retry pattern as
 * MenuClient); successful writes router.refresh() so the server-loaded state
 * re-renders. Drift reports are per-location local state (advisory reads).
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { PasswordModal } from "@/components/auth/PasswordModal";
import type { ToastMapState, DriftReport } from "@/lib/admin/toast-map";
import type { EzcaterAdminState } from "@/lib/admin/ezcater-map";

const KNOWN = new Set([
  "forbidden", "invalid_payload", "invalid_guid", "invalid_uuid", "not_found", "location_not_found",
  "not_candidate", "not_confirmed", "conflict", "not_configured", "auth_failed",
  "rate_limited", "bad_payload", "step_up_required", "step_up_stale", "generic",
]);
function errKey(code: string): TranslationKey {
  return (KNOWN.has(code) ? `admin.toast.error.${code}` : "admin.toast.error.generic") as TranslationKey;
}

function ModBadge({ r, t }: { r: import("@/lib/admin/toast-map").ToastMapRow; t: (k: TranslationKey) => string }) {
  if (!r.isModifier) return null;
  const tone = r.disposition === "remove" ? "border-co-cta text-co-cta" : r.disposition === "ignore" ? "border-co-border-2 text-co-text-dim" : "border-co-gold text-co-text";
  return (
    <span className={`ml-2 rounded-full border px-2 py-0.5 text-xs font-bold ${tone}`}>
      {t(`admin.toast.disposition.${r.disposition}` as TranslationKey)}
      {r.portionQty != null ? ` · ${r.portionQty}${r.portionUnit ? " " + r.portionUnit : ""}` : ""}
    </span>
  );
}

export function ToastTab({ state, ezcater, canWrite }: { state: ToastMapState; ezcater: EzcaterAdminState; canWrite: boolean }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const pendingRef = useRef<null | { run: () => Promise<void>; busyKey: string | null }>(null);
  const [busy, setBusy] = useState<string | null>(null); // "<locId>:<action>" | mapId
  const [drift, setDrift] = useState<Record<string, DriftReport>>({});
  const [matchNote, setMatchNote] = useState<Record<string, { pulled: number; candidates: number }>>({});
  const [guidDraft, setGuidDraft] = useState<Record<string, string>>({});
  const [ezDraft, setEzDraft] = useState<Record<string, string>>({});

  const money = useCallback(
    (c: number | null) => (c != null ? new Intl.NumberFormat(language === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(c / 100) : "—"),
    [language],
  );

  const api = useCallback(async (url: string, method: string, body: unknown, onOk: (data: Record<string, unknown>) => void, busyKey: string | null = null) => {
    setErrorKey(null);
    let res: Response;
    try {
      res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
    } catch {
      setErrorKey("admin.toast.error.generic" as TranslationKey);
      return;
    }
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      onOk(data);
      setStepUpOpen(false);
      pendingRef.current = null;
      return;
    }
    const b = (await res.json().catch(() => ({}))) as { code?: string };
    if (b.code === "step_up_required" || b.code === "step_up_stale") {
      // Carry the busy key so the modal-confirm retry re-shows the spinner and
      // keeps the buttons disabled mid-flight (review finding #2).
      pendingRef.current = { run: () => api(url, method, body, onOk, busyKey), busyKey };
      setStepUpOpen(true);
      return;
    }
    setErrorKey(errKey(b.code ?? "generic"));
  }, []);

  const runMatch = (locId: string) => {
    setBusy(`${locId}:match`);
    void api("/api/admin/toast-map/match", "POST", { locationId: locId }, (data) => {
      const d = data as { pulled?: number; candidates?: number };
      setMatchNote((prev) => ({ ...prev, [locId]: { pulled: d.pulled ?? 0, candidates: d.candidates ?? 0 } }));
      router.refresh();
    }, `${locId}:match`).finally(() => setBusy(null));
  };
  const checkDrift = (locId: string) => {
    setBusy(`${locId}:drift`);
    void api(`/api/admin/toast-map/drift?locationId=${locId}`, "GET", undefined, (data) => {
      const r = (data as { report?: DriftReport }).report;
      if (r) setDrift((prev) => ({ ...prev, [locId]: r }));
      router.refresh(); // stale flips may have landed
    }, `${locId}:drift`).finally(() => setBusy(null));
  };
  const rowAction = (mapId: string, action: "confirm" | "reject" | "unmap") => {
    setBusy(mapId);
    void api(`/api/admin/toast-map/${mapId}`, "POST", { action }, () => router.refresh(), mapId).finally(() => setBusy(null));
  };
  const saveEzUuid = (locId: string) => {
    const value = (ezDraft[locId] ?? "").trim();
    setBusy(`${locId}:ez`);
    void api("/api/admin/ezcater/location", "POST", { locationId: locId, ezcaterCatererUuid: value === "" ? null : value }, () => router.refresh(), `${locId}:ez`).finally(() => setBusy(null));
  };
  const saveGuid = (locId: string) => {
    const value = (guidDraft[locId] ?? "").trim();
    setBusy(`${locId}:guid`);
    void api("/api/admin/toast-map/location", "POST", { locationId: locId, toastRestaurantGuid: value === "" ? null : value }, () => router.refresh(), `${locId}:guid`).finally(() => setBusy(null));
  };

  const btn = "inline-flex min-h-[36px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-3 text-xs font-bold text-co-text-dim transition hover:text-co-text disabled:opacity-50";
  const inputCls = "min-h-[36px] w-full max-w-md rounded-lg border-2 border-co-border-2 bg-co-surface px-2 text-sm text-co-text";

  return (
    <div className="mt-4 flex flex-col gap-6">
      {errorKey && <p className="text-sm font-semibold text-co-cta">{t(errorKey)}</p>}

      {!state.configured && (
        <div className="co-card p-4">
          <p className="text-sm font-bold text-co-text">{t("admin.toast.not_configured")}</p>
          <p className="mt-1 text-sm text-co-text-muted">{t("admin.toast.not_configured_hint")}</p>
        </div>
      )}

      {state.locations.map((loc) => {
        const rows = state.rows.filter((r) => r.locationId === loc.id);
        const candidates = rows.filter((r) => r.matchStatus === "candidate");
        const confirmed = rows.filter((r) => r.matchStatus === "confirmed");
        const stale = rows.filter((r) => r.matchStatus === "stale");
        const d = drift[loc.id];
        const note = matchNote[loc.id];
        return (
          <section key={loc.id} className="co-card flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text">{loc.name}</h2>
              <span className="flex gap-2">
                <button type="button" className={btn} disabled={!canWrite || busy === `${loc.id}:match`} onClick={() => runMatch(loc.id)}>
                  {busy === `${loc.id}:match` ? t("admin.toast.working") : t("admin.toast.run_match")}
                </button>
                <button type="button" className={btn} disabled={busy === `${loc.id}:drift`} onClick={() => checkDrift(loc.id)}>
                  {busy === `${loc.id}:drift` ? t("admin.toast.working") : t("admin.toast.check_drift")}
                </button>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wide text-co-text-dim" htmlFor={`guid-${loc.id}`}>
                {t("admin.toast.guid_label")}
              </label>
              <input
                id={`guid-${loc.id}`}
                className={inputCls}
                placeholder="00000000-0000-0000-0000-000000000000"
                defaultValue={loc.toastRestaurantGuid ?? ""}
                onChange={(e) => setGuidDraft((prev) => ({ ...prev, [loc.id]: e.target.value }))}
                disabled={!canWrite}
              />
              <button type="button" className={btn} disabled={!canWrite || busy === `${loc.id}:guid` || guidDraft[loc.id] === undefined} onClick={() => saveGuid(loc.id)}>
                {t("admin.toast.guid_save")}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wide text-co-text-dim" htmlFor={`ez-${loc.id}`}>
                {t("admin.ezcater.uuid_label")}
              </label>
              <input
                id={`ez-${loc.id}`}
                className={inputCls}
                defaultValue={ezcater.locations.find((l) => l.id === loc.id)?.ezcaterCatererUuid ?? ""}
                onChange={(e) => setEzDraft((prev) => ({ ...prev, [loc.id]: e.target.value }))}
                disabled={!canWrite}
              />
              <button type="button" className={btn} disabled={!canWrite || busy === `${loc.id}:ez` || ezDraft[loc.id] === undefined} onClick={() => saveEzUuid(loc.id)}>
                {t("admin.ezcater.uuid_save")}
              </button>
            </div>

            {note && (
              <p className="text-sm text-co-text-muted">
                {t("admin.toast.match_note")} {note.pulled} / {note.candidates}
              </p>
            )}

            {candidates.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">{t("admin.toast.candidates_heading")}</h3>
                <ul className="flex flex-col gap-1.5">
                  {candidates.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-co-border/60 bg-co-bg/40 p-3">
                      <span className="min-w-0 text-sm text-co-text">
                        <span className="font-semibold">{r.entityName ?? "—"}</span>
                        <span className="text-co-text-dim"> ↔ </span>
                        <span className="font-semibold">{r.toastItemName}</span>
                        <span className="ml-2 text-xs text-co-text-dim">{money(r.toastPriceCents)} · {t("admin.toast.score")} {r.matchScore != null ? r.matchScore.toFixed(2) : "—"}</span>
                        <ModBadge r={r} t={t} />
                      </span>
                      {canWrite && (
                        <span className="flex gap-2">
                          <button type="button" className={btn} disabled={busy === r.id} onClick={() => rowAction(r.id, "confirm")}>{t("admin.toast.confirm")}</button>
                          <button type="button" className={btn} disabled={busy === r.id} onClick={() => rowAction(r.id, "reject")}>{t("admin.toast.reject")}</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(confirmed.length > 0 || stale.length > 0) && (
              <div>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">{t("admin.toast.confirmed_heading")}</h3>
                <ul className="flex flex-col gap-1.5">
                  {[...confirmed, ...stale].map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-co-border/60 bg-co-bg/40 p-3">
                      <span className="min-w-0 text-sm text-co-text">
                        <span className="font-semibold">{r.entityName ?? "—"}</span>
                        <span className="text-co-text-dim"> ↔ </span>
                        <span className="font-semibold">{r.toastItemName}</span>
                        {r.matchStatus === "stale" && (
                          <span className="ml-2 rounded-full border border-co-cta px-2 py-0.5 text-xs font-bold text-co-cta">{t("admin.toast.stale_badge")}</span>
                        )}
                        <ModBadge r={r} t={t} />
                      </span>
                      {canWrite && (
                        <button type="button" className={btn} disabled={busy === r.id} onClick={() => rowAction(r.id, "unmap")}>{t("admin.toast.unmap")}</button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {d && <DriftPanel d={d} t={t} money={money} />}
            {rows.length === 0 && !d && <p className="text-sm text-co-text-muted">{t("admin.toast.empty_location")}</p>}
          </section>
        );
      })}

      <section className="co-card p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-co-text">{t("admin.ezcater.events_heading")}</h2>
        <p className="mt-1 text-xs text-co-text-muted">
          {ezcater.webhookConfigured ? t("admin.ezcater.webhook_on") : t("admin.ezcater.webhook_off")}
          {" · "}
          {ezcater.apiConfigured ? t("admin.ezcater.api_on") : t("admin.ezcater.api_off")}
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-co-text">
          {ezcater.events.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2">
              <span>{e.eventKey ?? "—"} · {e.entityId ?? "—"}{e.signatureValid ? "" : " ⚠"}</span>
              <span className="text-co-text-dim">{e.processingResult ?? "—"} · {e.receivedAt.slice(0, 16).replace("T", " ")}</span>
            </li>
          ))}
          {ezcater.events.length === 0 && <li className="text-co-text-muted">{t("admin.ezcater.no_events")}</li>}
        </ul>
      </section>

      <PasswordModal open={stepUpOpen} onConfirm={async () => { const p = pendingRef.current; if (p) { if (p.busyKey) setBusy(p.busyKey); try { await p.run(); } finally { setBusy(null); } } }} onCancel={() => { setStepUpOpen(false); pendingRef.current = null; }} />
    </div>
  );
}

function DriftPanel({ d, t, money }: {
  d: DriftReport;
  t: (k: TranslationKey) => string;
  money: (c: number | null) => string;
}) {
  const empty = d.priceChanged.length === 0 && d.renamed.length === 0 && d.missingOnToast.length === 0 && d.newOnToast.length === 0 && d.unmappedCo.length === 0;
  const h3 = "mb-1 text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim";
  return (
    <div className="rounded-xl border border-co-border/60 bg-co-bg/40 p-3">
      <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-co-text">{t("admin.toast.drift_heading")}</h3>
      {empty && <p className="mt-1 text-sm text-co-text-muted">{t("admin.toast.drift_empty")}</p>}
      {d.priceChanged.length > 0 && (
        <div className="mt-2">
          <h4 className={h3}>{t("admin.toast.drift_price_changed")}</h4>
          <ul className="text-sm text-co-text">
            {d.priceChanged.map((x) => (
              <li key={x.row.id}>{x.row.entityName ?? x.row.toastItemName}: Toast {money(x.toastNowCents)} · CO-OPS {money(x.coCents)}</li>
            ))}
          </ul>
        </div>
      )}
      {d.renamed.length > 0 && (
        <div className="mt-2">
          <h4 className={h3}>{t("admin.toast.drift_renamed")}</h4>
          <ul className="text-sm text-co-text">
            {d.renamed.map((x) => (
              <li key={x.row.id}>{x.row.toastItemName} → {x.toastNowName}</li>
            ))}
          </ul>
        </div>
      )}
      {d.missingOnToast.length > 0 && (
        <div className="mt-2">
          <h4 className={h3}>{t("admin.toast.drift_missing")}</h4>
          <ul className="text-sm text-co-text">
            {d.missingOnToast.map((x) => (
              <li key={x.id}>{x.entityName ?? x.toastItemName}</li>
            ))}
          </ul>
        </div>
      )}
      {d.newOnToast.length > 0 && (
        <div className="mt-2">
          <h4 className={h3}>{t("admin.toast.drift_new_on_toast")}</h4>
          <ul className="text-sm text-co-text">
            {d.newOnToast.map((x) => (
              <li key={x.itemGuid}>{x.name} · {money(x.priceCents)}</li>
            ))}
          </ul>
        </div>
      )}
      {d.unmappedCo.length > 0 && (
        <div className="mt-2">
          <h4 className={h3}>{t("admin.toast.drift_unmapped_co")}</h4>
          <ul className="text-sm text-co-text">
            {d.unmappedCo.map((x) => (
              <li key={x.id}>{x.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
