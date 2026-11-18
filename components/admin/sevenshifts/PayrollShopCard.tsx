"use client";
/**
 * The "Payroll shop" card on /admin/sevenshifts (item 2, salaried cost to the payroll shop; owner / CGS / MoO only,
 * decided on the server before anything is read). Disclosure doctrine: a default-collapsed CollapsibleSection with
 * the account count on its header and the GAP alert in the never-collapse badge slot; one summary row per 7shifts
 * account (gap rows first), each a full-row 44px toggle that opens its drawer (history + the form). useState only.
 *
 * Every 7shifts account in the mirror is classified (Astra r2 P1): an account with no wage at all and no decision
 * is "Needs a decision", never missing. No wage figure is ever shown (has-salary flags only). A save asks for the
 * password (Tier B, always prompted) and goes to POST /api/admin/labor/payroll-shop; a backdated start shows
 * "This changes labor cost from <date> on" before the password is asked for.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { formatDateLabelWithYear } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { isSunday, PAYROLL_SHOP_ERROR_CODES, type CensusRow, type PayrollCensus } from "@/lib/facts/labor-payroll-shared";

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const control = "min-h-[44px] items-center min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const fieldLabel = "grid min-w-0 max-w-full flex-1 basis-[14rem] gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const GAP_CHIP = "rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text";
const OK_CHIP = "rounded-full bg-co-surface-inset px-2 py-0.5 text-xs font-bold text-co-text-muted";
const EXCLUDED = "excluded";

export interface PayrollShopCardData {
  census: PayrollCensus; shops: { id: string; name: string; linked: boolean }[]; userNames: Record<string, string>;
}

function errorKey(code: string | undefined): TranslationKey {
  return (PAYROLL_SHOP_ERROR_CODES as readonly string[]).includes(code ?? "") ? (`labor.payroll.error.${code}` as TranslationKey) : "labor.payroll.error.generic";
}

export function PayrollShopCard({ data }: { data: PayrollShopCardData | null }) {
  const { t, language } = useTranslation();
  if (!data) return <section className="co-card p-4"><p className="text-co-text-muted">{t("labor.payroll.unavailable")}</p></section>;
  const { census } = data;
  const date = (ymd: string) => formatDateLabelWithYear(ymd, language);
  return <CollapsibleSection idBase="payroll-shop" title={t("labor.payroll.title")} count={t("labor.payroll.count", { n: census.rows.length })}
    badge={census.gapCount > 0 ? <span className={GAP_CHIP}>{t("labor.payroll.gaps", { n: census.gapCount })}</span> : null}>
    <div className="space-y-3">
      <p className="text-co-text-muted">{t("labor.payroll.intro")}</p>
      <p className="text-sm text-co-text-dim">{t("labor.payroll.week", { date: date(census.weekStart) })}</p>
      {census.gapCount > 0 && <p role="alert" className="rounded-lg bg-co-warning-surface p-3 font-bold text-co-warning-text">
        {t("labor.payroll.alert", { n: census.gapCount })}</p>}
      {census.rosterNoAccount.length > 0 && <div className="rounded-lg border-2 border-co-border p-3">
        <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("labor.payroll.roster_title")}</h3>
        <ul className="mt-1 list-disc pl-5">{census.rosterNoAccount.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
        <p className="mt-1 text-sm text-co-text-dim">{t("labor.payroll.roster_help")}</p>
      </div>}
      <ul className="space-y-2">{census.rows.map((row) => <li key={row.account}><PayrollRow row={row} data={data} /></li>)}</ul>
      {census.hourlyHidden > 0 && <p className="text-sm text-co-text-dim">{t("labor.payroll.hourly_hidden", { n: census.hourlyHidden })}</p>}
    </div>
  </CollapsibleSection>;
}

function PayrollRow({ row, data }: { row: CensusRow; data: PayrollShopCardData }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState("");
  const [starts, setStarts] = useState(data.census.weekStart);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  const shopName = (id: string | null) => data.shops.find((s) => s.id === id)?.name ?? "";
  const date = (ymd: string) => formatDateLabelWithYear(ymd, language);
  const name = row.name || t("labor.payroll.employee_id", { id: row.employeeId ?? row.account });
  const chip = row.chip === "shop" ? t("labor.payroll.chip.shop", { shop: shopName(row.locationId) }) : t(`labor.payroll.chip.${row.chip}` as TranslationKey);
  const backdated = isSunday(starts) && starts < data.census.weekStart;
  const needsNote = shop === EXCLUDED || backdated;
  const ready = shop !== "" && isSunday(starts) && (!needsNote || note.trim() !== "");
  const panelId = `payroll-row-${row.account}`;

  async function save() {
    setBusy(true); setError(null); setSaved(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      const payload = { account: row.account, disposition: shop === EXCLUDED ? "excluded" : "shop", locationId: shop === EXCLUDED ? null : shop,
        validFrom: starts, note, expectedSeq: row.newestSeq };
      const post = () => fetch("/api/admin/labor/payroll-shop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let response = await post();
      let body: { code?: string } = {};
      if (!response.ok) {
        body = await response.json().catch(() => ({})) as { code?: string };
        if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
          response = await post();
          if (!response.ok) body = await response.json().catch(() => ({})) as { code?: string };
        }
      }
      if (!response.ok || response.redirected) { setError(errorKey(body.code)); return; }
      setSaved(true); setShop(""); setNote("");
      startTransition(() => router.refresh());
    } catch { setError("labor.payroll.error.generic"); } finally { setBusy(false); }
  }

  return <div className="rounded-lg border-2 border-co-border">
    <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={t("labor.payroll.aria.row", { name })} onClick={() => setOpen((o) => !o)}
      className="flex min-h-[44px] w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
      <span className="font-bold text-co-text">{name}</span>
      {row.employeeId && <span className="text-sm text-co-text-dim">{t("labor.payroll.employee_id", { id: row.employeeId })}</span>}
      <span className={row.gap ? GAP_CHIP : OK_CHIP}>{chip}</span>
      {!row.active && <span className="text-sm text-co-text-dim">{t("labor.payroll.inactive")}</span>}
    </button>
    {open && <div id={panelId} className="space-y-3 border-t-2 border-co-border p-3">
      <p className="text-sm text-co-text-muted">{row.linkedUsers.length > 0
        ? t("labor.payroll.linked", { names: row.linkedUsers.map((u) => u.name).join(", ") }) : t("labor.payroll.not_linked")}</p>
      <div>
        <h4 className="text-xs font-bold tracking-wide text-co-text-muted">{t("labor.payroll.history")}</h4>
        {row.history.length === 0 ? <p className="text-sm text-co-text-dim">{t("labor.payroll.history_empty")}</p>
          : <ul className="text-sm text-co-text">{row.history.map((h) => <li key={h.seq}>
            {t("labor.payroll.history_row", { date: date(h.validFrom),
              shop: h.disposition === "excluded" ? t("labor.payroll.option.excluded") : shopName(h.locationId),
              who: (h.createdBy && data.userNames[h.createdBy]) || "-" })}{h.hasNote ? ` (${t("labor.payroll.history_note")})` : ""}</li>)}</ul>}
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={fieldLabel}>{t("labor.payroll.field.shop")}
          <select className={control} value={shop} aria-label={t("labor.payroll.aria.shop", { name })} onChange={(e) => { setShop(e.target.value); setSaved(false); }}>
            <option value="">{t("labor.payroll.option.choose")}</option>
            {data.shops.filter((s) => s.linked).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value={EXCLUDED}>{t("labor.payroll.option.excluded")}</option>
          </select>
        </label>
        <label className={fieldLabel}>{t("labor.payroll.field.starts")}
          <input type="date" className={control} value={starts} min="2026-07-19" step={7} aria-label={t("labor.payroll.aria.starts", { name })}
            onChange={(e) => { setStarts(e.target.value); setSaved(false); }} />
        </label>
      </div>
      {starts !== "" && !isSunday(starts) && <p className="text-sm font-bold text-co-cta-text">{t("labor.payroll.error.invalid_date")}</p>}
      <label className={fieldLabel}>{t("labor.payroll.field.note")}
        <textarea className={`${control} py-2`} value={note} maxLength={500} aria-label={t("labor.payroll.aria.note", { name })}
          onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-sm text-co-text-dim">{t("labor.payroll.note_help")}</p>
      {backdated && <p aria-live="polite" className="rounded-lg bg-co-warning-surface p-2 text-sm font-bold text-co-warning-text">
        {t("labor.payroll.backdate_confirm", { date: date(starts) })}</p>}
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      {saved && <p aria-live="polite" className="text-sm font-bold text-co-confirm-text">{t("labor.payroll.success")}</p>}
      <button type="button" className={button} disabled={!ready || busy || refreshing} onClick={save}>
        {busy ? t("labor.payroll.saving") : t("labor.payroll.save")}</button>
    </div>}
  </div>;
}
