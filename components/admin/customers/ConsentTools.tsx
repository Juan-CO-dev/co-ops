"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import { useStepUp } from "@/components/admin/StepUpProvider";
import type { TranslationKey } from "@/lib/i18n/types";
import { STEP_UP_CODES, postCustomerJson } from "./customer-post";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text";
const quiet = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 font-bold text-co-text";
const control = "min-h-[44px] min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const label = "grid min-w-0 max-w-full gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";

const ERRORS: Record<string, TranslationKey> = {
  consent_import_large_opt_out: "customers.import.error.largeOptOut",
  consent_import_older_than_last: "customers.import.error.older",
  consent_import_busy: "customers.import.error.busy",
  consent_import_future_date: "customers.import.error.future",
  csv_no_email_column: "customers.import.error.noEmail",
  csv_unknown_status: "customers.import.error.status",
  csv_mixed_status: "customers.import.error.mixed",
  csv_too_large: "customers.import.error.tooLarge",
  csv_empty: "customers.import.error.empty",
  csv_no_rows: "customers.import.error.empty",
  meta_export_off: "customers.export.metaOff",
  invalid_contact: "customers.lookup.invalid",
};

interface Summary { replay: boolean; baseline: boolean; rowsTotal: number; newOptIns: number; optOuts: number; unchanged: number; stale: number; suppressed: number; newCustomers: number; masked: number; invalid: number; explicitStatus: boolean }

/** Level 9+ consent desk: the Toast list import, the two opted-in-only exports, the delete-request intake, retention. */
export function ConsentTools({ metaEnabled, today }: { metaEnabled: boolean; today: string }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [allowLarge, setAllowLarge] = useState(false);
  const [found, setFound] = useState<{ customerId: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const disabled = busy || refreshing;

  async function unlocked(tier: "A" | "B") { return (tier === "B" ? await requestStepUp("B") : await requestStepUp("A")) === "ok"; }
  async function send(url: string, tier: "A" | "B", payload: Record<string, unknown>) {
    if (!await unlocked(tier)) return null;
    let r = await postCustomerJson(url, payload);
    if (!r.ok && STEP_UP_CODES.has(r.code ?? "") && await unlocked(tier)) r = await postCustomerJson(url, payload);
    return r;
  }

  async function onImport(form: HTMLFormElement) {
    const data = new FormData(form);
    const files = data.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const exportDate = String(data.get("exportDate") || "");
    if (files.length === 0 || !exportDate) { setError("customers.import.error.empty"); return; }
    setBusy(true); setError(null); setSummary(null);
    try {
      const payload = { operation: "import", exportDate, allowLargeOptOut: allowLarge, files: await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))) };
      const r = await send("/api/admin/customers/confirm", "B", payload);
      if (!r) return;
      if (!r.ok) {
        if (r.code === "consent_import_large_opt_out") setNeedsConfirm(true);
        setError(ERRORS[r.code ?? ""] ?? "customers.error.generic");
        return;
      }
      setNeedsConfirm(false); setAllowLarge(false);
      setSummary(r.body.summary as Summary);
      startTransition(() => router.refresh());
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }

  async function onExport(kind: "marketing_email" | "meta_audience") {
    setBusy(true); setError(null);
    try {
      if (!await unlocked("B")) return;
      const post = () => fetch("/api/admin/customers/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      let response = await post();
      if (!response.ok) {
        const body = await response.clone().json().catch(() => ({})) as { code?: string };
        if (STEP_UP_CODES.has(body.code ?? "") && await unlocked("B")) response = await post();
      }
      if (!response.ok || response.redirected) {
        const body = await response.json().catch(() => ({})) as { code?: string };
        setError(ERRORS[body.code ?? ""] ?? "customers.error.generic");
        return;
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "export.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      setNotice(t("customers.export.done", { count: Number(response.headers.get("x-row-count") ?? 0) }));
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }

  async function onLookup(form: HTMLFormElement) {
    const query = String(new FormData(form).get("query") || "").trim();
    if (!query) return;
    setBusy(true); setError(null); setFound(null);
    try {
      const r = await send("/api/admin/customers", "A", { operation: "lookup", query });
      if (!r) return;
      if (!r.ok) { setError(ERRORS[r.code ?? ""] ?? "customers.error.generic"); return; }
      setFound({ customerId: (r.body.customerId as string | null) ?? null });
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }

  async function onSimple(url: string, tier: "A" | "B", operation: string, doneKey: TranslationKey) {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await send(url, tier, { operation });
      if (!r) return;
      if (!r.ok) { setError(ERRORS[r.code ?? ""] ?? "customers.error.generic"); return; }
      setNotice(t(doneKey, { count: Number(r.body.erased ?? r.body.linked ?? 0) }));
      startTransition(() => router.refresh());
    } catch { setError("customers.error.generic"); } finally { setBusy(false); }
  }

  return <div className="space-y-4" aria-busy={disabled}>
    {error && <p role="alert" className="text-co-cta-text">{t(error)}</p>}
    {notice && <p role="status" className="font-bold text-co-confirm-text">{notice}</p>}

    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("customers.import.title")}</h2>
      <p className="text-sm text-co-text-muted">{t("customers.import.hint")}</p>
      <p className="text-sm text-co-text">{t("customers.import.basis")}</p>
      <form className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void onImport(e.currentTarget); }}>
        <label className={`${label} flex-1 basis-[14rem]`}>{t("customers.import.files")}
          <input name="files" aria-label={t("customers.import.files")} type="file" accept=".csv,text/csv" multiple className={control} disabled={disabled} />
        </label>
        <label className={label}>{t("customers.import.exportDate")}
          <input name="exportDate" aria-label={t("customers.import.exportDate")} type="date" defaultValue={today} max={today} className={control} disabled={disabled} />
        </label>
        <button type="submit" className={button} disabled={disabled}>{t("customers.import.submit")}</button>
      </form>
      {needsConfirm && <label className="flex min-h-[44px] items-center gap-3 text-co-text">
        <input type="checkbox" aria-label={t("customers.import.allowLarge")} className="h-5 w-5" checked={allowLarge} onChange={(e) => setAllowLarge(e.target.checked)} disabled={disabled} />
        {t("customers.import.allowLarge")}
      </label>}
      {summary && <div role="status" className="space-y-1 rounded-xl border border-co-border p-3 text-co-text">
        <p className="font-bold">{t(summary.replay ? "customers.import.replay" : "customers.import.summary", { in: summary.newOptIns, out: summary.optOuts })}</p>
        <p className="text-sm text-co-text-muted">{t("customers.import.detail", { rows: summary.rowsTotal, same: summary.unchanged, stale: summary.stale, suppressed: summary.suppressed, created: summary.newCustomers, invalid: summary.invalid, masked: summary.masked })}</p>
        {summary.baseline && <p className="text-sm text-co-text-muted">{t("customers.import.baseline")}</p>}
        <p className="text-sm text-co-text-muted">{t(summary.explicitStatus ? "customers.import.modeExplicit" : "customers.import.modeAbsence")}</p>
      </div>}
    </section>

    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("customers.export.title")}</h2>
      <p className="text-sm text-co-text-muted">{t("customers.export.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={disabled} onClick={() => void onExport("marketing_email")}>{t("customers.export.email")}</button>
        <button type="button" className={quiet} disabled={disabled || !metaEnabled} onClick={() => void onExport("meta_audience")}>{t("customers.export.meta")}</button>
      </div>
      {!metaEnabled && <p className="text-sm text-co-text-muted">{t("customers.export.metaOff")}</p>}
    </section>

    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("customers.lookup.title")}</h2>
      <p className="text-sm text-co-text-muted">{t("customers.lookup.hint")}</p>
      <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void onLookup(e.currentTarget); }}>
        <label className={`${label} flex-1 basis-[14rem]`}>{t("customers.lookup.label")}
          <input name="query" aria-label={t("customers.lookup.label")} type="text" inputMode="email" autoComplete="off" className={control} disabled={disabled} />
        </label>
        <button type="submit" className={button} disabled={disabled}>{t("customers.lookup.submit")}</button>
      </form>
      {found && (found.customerId
        ? <Link className={quiet} href={`/admin/customers/${found.customerId}`}>{t("customers.lookup.open")}</Link>
        : <p className="text-sm text-co-text-muted">{t("customers.lookup.notFound")}</p>)}
    </section>

    <section className="co-card min-w-0 space-y-3 p-4">
      <h2 className="text-lg font-bold text-co-text">{t("customers.maintenance.title")}</h2>
      <p className="text-sm text-co-text-muted">{t("customers.maintenance.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={quiet} disabled={disabled} onClick={() => void onSimple("/api/admin/customers", "A", "link_catering", "customers.maintenance.linked")}>{t("customers.maintenance.linkCatering")}</button>
        <button type="button" className={quiet} disabled={disabled} onClick={() => void onSimple("/api/admin/customers/confirm", "B", "retention", "customers.maintenance.retained")}>{t("customers.maintenance.retention")}</button>
      </div>
    </section>
  </div>;
}
