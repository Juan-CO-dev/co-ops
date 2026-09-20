"use client";

import { useReducer, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import { formatCents, formatDateLabel } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/types";
import type { ImportApplyResult, ImportBatchView } from "@/lib/vendor-import";
import type { Decision, Observation } from "@/lib/vendor-import-shared/model";
import { observationKey, planDigest, planFromDecisions } from "@/lib/vendor-import-shared/match";
import { resolveErrorKey } from "./shared";

const control = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-surface px-3 text-sm text-co-text focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-50";
const kinds = ["price", "item_number", "pack", "needs_person", "noop"] as const;
interface State {
  view: ImportBatchView | null;
  decisions: Record<string, Decision>;
  file: File | null;
  busy: "staging" | "applying" | "loading" | null;
  error: string | null;
  result: ImportApplyResult | null;
  search: string;
  refreshFailed: boolean;
}
const initial: State = { view: null, decisions: {}, file: null, busy: null, error: null, result: null, search: "", refreshFailed: false };
const editable = (o: Observation) => o.kind === "price" || o.kind === "item_number" || o.kind === "pack";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// A keyed child resets all draft and disclosure state when the vendor changes.
export function VendorImportPanel(props: { vendorId: string; vendorName: string; canStage: boolean; canApply: boolean }) {
  return <ImportPanel key={props.vendorId} {...props} />;
}

function ImportPanel({ vendorId, vendorName, canStage, canApply }: { vendorId: string; vendorName: string; canStage: boolean; canApply: boolean }) {
  const { t, language } = useTranslation();
  const [state, patch] = useReducer((s: State, change: Partial<State>) => ({ ...s, ...change }), initial);
  const [expanded, setExpanded] = useState(false);
  const [showNoop, setShowNoop] = useState(false);
  const inFlight = useRef(false);
  const { view, decisions, busy, error, result } = state;
  const url = `/api/admin/vendors/${vendorId}/import`;
  const contentId = `vendor-import-${vendorId}`;
  const dirty = !!view && !result && view.batch.status === "staged" && Object.keys(decisions).some(key => decisions[key] !== view.decisions[key]);
  const locked = !!busy || dirty || !!state.file;
  const accepted = view?.observations.filter(o => editable(o) && decisions[observationKey(o)] === "accept").length ?? 0;
  const changed = error === "plan_changed" || error === "stale_before_state";
  const unavailable = t("admin.vendor_import.unknown");
  const kindLabel = (kind: Observation["kind"], n: number) => t(`admin.vendor_import.kind.${kind}`, { n });
  const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? formatCents(Math.round(value * 100), language) : unavailable;
  const packLabel = (value: unknown) => {
    const pack = record(value);
    return typeof pack.quantity === "number" && typeof pack.unit === "string" ? `${pack.quantity} ${pack.unit}` : unavailable;
  };

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(path, { ...options, credentials: "same-origin", redirect: "manual", cache: "no-store" });
    if (response.status === 401 || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) throw new Error("auth");
    const body = await response.json();
    if (!response.ok) throw new Error(typeof body.code === "string" ? body.code : "generic");
    return body as T;
  }
  const receive = (fresh: ImportBatchView) => patch({ view: fresh, decisions: fresh.decisions, refreshFailed: false });
  async function stage() {
    if (inFlight.current || !canStage || !state.file) return;
    inFlight.current = true;
    patch({ busy: "staging", error: null, result: null });
    try {
      const body = new FormData(); body.append("file", state.file);
      receive(await request<ImportBatchView>(url, { method: "POST", body }));
      patch({ file: null, search: "" });
      setExpanded(true); setShowNoop(false);
    } catch (e) { patch({ error: e instanceof Error ? e.message : "generic" }); }
    finally { inFlight.current = false; patch({ busy: null }); }
  }
  async function reload() {
    if (inFlight.current || !view) return;
    inFlight.current = true; patch({ busy: "loading", error: null });
    try { receive(await request<ImportBatchView>(`${url}/${view.batch.id}`)); }
    catch (e) { patch({ error: e instanceof Error ? e.message : "generic" }); }
    finally { inFlight.current = false; patch({ busy: null }); }
  }
  async function apply() {
    if (inFlight.current || !canApply || !view || !accepted || view.batch.status !== "staged" || result || changed) return;
    inFlight.current = true; patch({ busy: "applying", error: null });
    try {
      // The server hashes the selected plan, so skips must change the digest too.
      let expectedDigest: string;
      try { expectedDigest = await planDigest(planFromDecisions(view.observations, decisions, view.beforeState), view.beforeState); }
      catch { throw new Error("invalid_plan"); }
      const applied = await request<ImportApplyResult>(`${url}/${view.batch.id}/apply`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions, expectedDigest }),
      });
      patch({ result: applied });
      try { receive(await request<ImportBatchView>(`${url}/${view.batch.id}`)); }
      catch (e) { patch({ refreshFailed: true, error: e instanceof Error ? e.message : "generic" }); }
    } catch (e) { patch({ error: e instanceof Error ? e.message : "generic" }); }
    finally { inFlight.current = false; patch({ busy: null }); }
  }
  function errorText(code: string) {
    if (code === "plan_changed" || code === "stale_before_state") return t("admin.vendor_import.error.plan_changed");
    const own = ["auth", "too_large", "unknown_adapter", "adapter_vendor_mismatch", "multiple_accounts", "invalid_plan"];
    return own.includes(code) ? t(`admin.vendor_import.error.${code}` as TranslationKey) : t(resolveErrorKey(code));
  }
  function current(o: Observation) {
    // Snapshots differ by kind; never invent catalog values for noop/needs_person.
    const before = view?.beforeState[observationKey(o)] ?? {};
    const price = o.kind === "price" ? before.unit_price : record(before.latest_price).unit_price;
    return `${money(price)} · ${packLabel(o.kind === "pack" ? before : before.root)}`;
  }
  function table(rows: Observation[]) {
    return <div className="max-w-full overflow-x-auto" role="region" aria-label={t("admin.vendor_import.table", { vendor: vendorName })} tabIndex={0}>
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead><tr>{[t("admin.vendor_import.item"), t("admin.vendor_import.match"), t("admin.vendor_import.current"), t("admin.vendor_import.proposed"), t("admin.vendor_import.reason_label"), t("admin.vendor_import.decision_heading")].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
        <tbody>{rows.map(o => {
          const key = observationKey(o);
          const warning = o.match.rule === "ambiguous" || o.match.rule === "unmatched";
          // The plan can change a price when its paired pack is accepted.
          const before = view?.beforeState[key] ?? {};
          const pairedPack = view?.observations.find(p => p.source_row === o.source_row && p.kind === "pack" && p.match.sku_id === o.match.sku_id);
          const proposal = o.kind === "price" && pairedPack && decisions[observationKey(pairedPack)] === "accept" && before.price_with_pack
            ? record(before.price_with_pack) : o.proposed;
          return <tr key={key} className="border-t border-co-border align-top">
            <th scope="row" className="p-2 font-normal">{o.row.item_no}<br />{o.row.description}</th>
            <td className="p-2"><span className={`inline-flex rounded-full px-2 py-1 text-xs ${warning ? "bg-co-warning-surface text-co-warning-text" : "bg-co-success-surface text-co-confirm-text"}`}>{t(`admin.vendor_import.match.${o.match.rule}`)}</span></td>
            <td className="p-2">{current(o)}</td>
            <td className="p-2">{proposal ? [proposal.unit_price !== undefined ? money(proposal.unit_price) : null, typeof proposal.item_number === "string" ? proposal.item_number : null, proposal.root ? packLabel(proposal.root) : null].filter(Boolean).join(" · ") : unavailable}</td>
            <td className="p-2">{t(`admin.vendor_import.reason.${o.reason}` as TranslationKey)}</td>
            <td className="p-2">{editable(o) ? <select className={control} aria-label={t("admin.vendor_import.decision", { n: o.source_row, kind: kindLabel(o.kind, 1) })}
              disabled={!!busy || !canApply || view?.batch.status !== "staged" || !!result || changed} value={decisions[key] ?? "skip"}
              onChange={e => { if (!inFlight.current) patch({ decisions: { ...decisions, [key]: e.target.value as Decision }, error: null }); }}>
              <option value="accept">{t("admin.vendor_import.accept")}</option><option value="skip">{t("admin.vendor_import.skip")}</option>
            </select> : o.kind === "needs_person" ? <><p>{t("admin.vendor_import.needs_hint")}</p><a className={`${control} mt-1`} href="#order-guide">{t("admin.vendor_import.guide")}</a><a className={`${control} mt-1`} href={`/admin/skus?vendor=${encodeURIComponent(vendorId)}`}>{t("admin.vendor_import.skus")}</a></> : null}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>;
  }
  const query = state.search.trim().toLowerCase();
  const filtered = view?.observations.filter(o => `${o.row.item_no} ${o.row.description}`.toLowerCase().includes(query)) ?? [];
  const noop = filtered.filter(o => o.kind === "noop");
  return <section className="co-card mt-4 min-w-0 max-w-full overflow-hidden p-4 text-co-text" aria-labelledby={`${contentId}-title`}>
    <h2 id={`${contentId}-title`} className="text-base font-bold">{t("admin.vendor_import.title")}</h2>
    <p className="text-sm">{vendorName}</p>
    {view ? <><p className="mt-2 break-words text-sm">{t("admin.vendor_import.summary", { adapter: view.batch.adapter, date: view.batch.exported_at ? formatDateLabel(view.batch.exported_at, language) : unavailable, n: view.batch.row_count })}</p>
      <div className="mt-2 flex flex-wrap gap-2"><span className={`rounded-full px-2 py-1 text-xs ${view.batch.status === "applied" ? "bg-co-success-surface text-co-confirm-text" : "bg-co-warning-surface text-co-warning-text"}`}>{t(`admin.vendor_import.status.${view.batch.status}`)}</span>
        {kinds.map(kind => <span key={kind} className={kind === "needs_person" && view.batch.report.counts[kind] ? "rounded-full bg-co-warning-surface px-2 py-1 text-xs text-co-warning-text" : "px-2 py-1 text-xs"}>{kindLabel(kind, view.batch.report.counts[kind] ?? 0)}</span>)}</div></> : <p className="mt-2 text-sm">{t("admin.vendor_import.empty")}</p>}
    <div aria-live="polite">
      {busy && <p>{busy === "staging" ? t("admin.vendor_import.staging") : busy === "applying" ? t("admin.vendor_import.applying") : t("common.loading")}</p>}
      {dirty && <p className="mt-2 text-sm">{t("admin.vendor_import.dirty")}</p>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-co-danger-surface p-2 text-co-cta-text">{errorText(error)}</p>}
      {result && <p className="mt-2 rounded-lg bg-co-success-surface p-2 text-co-confirm-text">{t("admin.vendor_import.success", {
        price: result.ops.filter(o => o.action === "sku.price_supersede").length, item: result.ops.filter(o => o.action === "sku.item_number_set").length,
        pack: result.ops.filter(o => o.action === "sku.pack_level_supersede").length, newPrices: result.ops.filter(o => o.action === "sku.price_supersede").reduce((n, o) => n + o.new_ids.length, 0),
      })}</p>}
      {!!result?.non_atomic.length && <p className="bg-co-warning-surface p-2 text-co-warning-text">{t("admin.vendor_import.partial")}</p>}
      {state.refreshFailed && <><p>{t("admin.vendor_import.refresh_failed")}</p><button type="button" className={control} disabled={!!busy} onClick={reload}>{t("admin.vendor_import.reload")}</button></>}
    </div>
    <button type="button" className={`${control} mt-3 w-full justify-between`} aria-expanded={expanded} aria-controls={contentId} disabled={expanded && locked} onClick={() => setExpanded(!expanded)}>{t("admin.vendor_import.details", { n: view?.observations.length ?? 0 })}<span aria-hidden="true">{expanded ? "−" : "+"}</span></button>
    {expanded && <div id={contentId} className="mt-3 min-w-0 space-y-3">
      {canStage && <div><label htmlFor={`${contentId}-file`} className="block text-xs font-bold tracking-[0.12em]">{t("admin.vendor_import.upload")}</label>
        <input key={view?.batch.id ?? "empty"} id={`${contentId}-file`} type="file" accept=".csv,.json,text/csv,application/json" className={`${control} w-full min-w-0 py-2`} disabled={!!busy} aria-label={t("admin.vendor_import.upload")} aria-describedby={`${contentId}-help`} onChange={e => patch({ file: e.target.files?.[0] ?? null })} />
        <p id={`${contentId}-help`} className="mt-1 text-sm">{t("admin.vendor_import.help")}</p>
        <button type="button" className={`${control} mt-2 bg-co-gold font-bold tracking-[0.1em]`} disabled={!!busy || !state.file} onClick={stage}>{changed ? t("admin.vendor_import.restage") : t("admin.vendor_import.stage")}</button></div>}
      {view && <>
        {view.observations.length >= 10 && <input type="search" className={`${control} w-full`} value={state.search} aria-label={t("admin.vendor_import.search")} placeholder={t("admin.vendor_import.search")} onChange={e => patch({ search: e.target.value })} />}
        {table(filtered.filter(o => o.kind !== "noop"))}
        <button type="button" className={`${control} w-full justify-between`} aria-expanded={showNoop} aria-controls={`${contentId}-noop`} onClick={() => setShowNoop(!showNoop)}>{t("admin.vendor_import.no_change", { n: noop.length })}</button>
        {showNoop && <div id={`${contentId}-noop`}>{table(noop)}</div>}
        {canApply && <button type="button" className={`${control} bg-co-gold font-bold tracking-[0.1em]`} disabled={!!busy || !accepted || view.batch.status !== "staged" || !!result || changed} onClick={apply}>{t("admin.vendor_import.apply", { n: accepted })}</button>}
      </>}
    </div>}
  </section>;
}
