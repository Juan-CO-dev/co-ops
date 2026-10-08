"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { SummaryRow } from "@/components/ui/SummaryRow";
import type { RecipientsAdminView } from "@/lib/report-recipients";
import { DIGEST_DELIVERY_MODES, DIGEST_KINDS } from "@/lib/report-digests-shared";
import { PACKAGE_CADENCES, PACKAGE_FORMATS, PACKAGE_SECTIONS } from "@/lib/report-recipients-shared";

const input = "flex min-h-[44px] w-full items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base font-normal tracking-normal text-co-text";
const label = "grid gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const check = "flex min-h-[44px] items-center gap-2 font-bold text-co-text";
const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold tracking-[0.1em] text-co-text";
const badge = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold";

type Row = RecipientsAdminView["rows"][number];

function RecipientForm({ row, kind, view, disabled, onSave }: {
  row: Row | null; kind: "internal" | "external"; view: RecipientsAdminView; disabled: boolean;
  onSave: (form: HTMLFormElement, row: Row | null, kind: "internal" | "external") => Promise<boolean>;
}) {
  const { t } = useTranslation();
    return <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (await onSave(form, row, kind) && !row) form.reset();
    }}>
      <fieldset disabled={disabled} className="contents">
        {kind === "internal" && !row && <label className={label}>{t("reportRecipients.field.user")}
          <select className={input} name="userId" required aria-label={t("reportRecipients.field.user")} defaultValue="">
            <option value="" disabled>{t("reportRecipients.field.pick_user")}</option>
            {view.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></label>}
        <label className={label}>{t("reportRecipients.field.display_name")}
          <input className={input} name="displayName" required maxLength={120} aria-label={t("reportRecipients.field.display_name")} defaultValue={row?.display_name ?? ""} /></label>
        {kind === "external" && <label className={label}>{t("reportRecipients.field.email")}
          <input className={input} name="email" type="email" maxLength={254} aria-label={t("reportRecipients.field.email")} defaultValue={row?.email ?? ""} /></label>}
        <label className={check}><input className="h-5 w-5" type="checkbox" name="active" aria-label={t("reportRecipients.field.active")} defaultChecked={row?.active ?? kind === "internal"} />{t("reportRecipients.field.active")}</label>
        {kind === "internal" && <>
          <label className={check}><input className="h-5 w-5" type="checkbox" name="cateringDigest" aria-label={t("reportRecipients.field.catering_digest")} defaultChecked={row?.catering_digest ?? false} />{t("reportRecipients.field.catering_digest")}</label>
          <label className={check}><input className="h-5 w-5" type="checkbox" name="shopDigest" aria-label={t("reportRecipients.field.shop_digest")} defaultChecked={row?.shop_digest ?? false} />{t("reportRecipients.field.shop_digest")}</label>
        </>}
        <fieldset className="grid gap-1 sm:col-span-2">
          <legend className={label}>{t("reportRecipients.field.shops")}</legend>
          <p className="text-xs text-co-text-muted">{t("reportRecipients.field.shops_hint")}</p>
          <div className="flex flex-wrap gap-3">{view.locations.map((l) => <label key={l.id} className={check}><input className="h-5 w-5" type="checkbox" name="locationIds" value={l.id} aria-label={l.name} defaultChecked={row?.location_ids?.includes(l.id) ?? false} />{l.name}</label>)}</div>
        </fieldset>
        <fieldset className="grid gap-1 sm:col-span-2">
          <legend className={label}>{t("reportRecipients.field.packages")}</legend>
          <p className="text-xs text-co-text-muted">{t("reportRecipients.field.packages_hint")}</p>
          <div className="flex flex-wrap gap-3">{PACKAGE_SECTIONS.map((p) => <label key={p} className={check}><input className="h-5 w-5" type="checkbox" name="packages" value={p} aria-label={t(`reportRecipients.package.${p}` as TranslationKey)} defaultChecked={row?.packages.includes(p) ?? false} />{t(`reportRecipients.package.${p}` as TranslationKey)}</label>)}</div>
        </fieldset>
        <label className={label}>{t("reportRecipients.field.cadence")}
          <select className={input} name="cadence" aria-label={t("reportRecipients.field.cadence")} defaultValue={row?.cadence ?? ""}>
            <option value="">{t("reportRecipients.cadence.none")}</option>
            {PACKAGE_CADENCES.map((c) => <option key={c} value={c}>{t(`reportRecipients.cadence.${c}` as TranslationKey)}</option>)}
          </select></label>
        <fieldset className="grid gap-1">
          <legend className={label}>{t("reportRecipients.field.formats")}</legend>
          <div className="flex flex-wrap gap-3">{PACKAGE_FORMATS.map((f) => <label key={f} className={check}><input className="h-5 w-5" type="checkbox" name="formats" value={f} aria-label={f.toUpperCase()} defaultChecked={row?.formats.includes(f) ?? true} />{f.toUpperCase()}</label>)}</div>
        </fieldset>
        {view.canManage && <button className={`${button} sm:col-span-2`} type="submit">{t("common.save")}</button>}
      </fieldset>
    </form>;
  }


export function ReportRecipientsAdmin({ view }: { view: RecipientsAdminView }) {
  const { t } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const disabled = !view.canManage || busy || refreshing;

  async function post(url: string, payload: unknown): Promise<boolean> {
    setBusy(true); setError(null);
    try {
      if (await requestStepUp("B") !== "ok") return false;
      const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let response = await send();
      let code: string | undefined;
      if (!response.ok) {
        code = (await response.json().catch(() => ({})) as { code?: string }).code;
        if ((code === "step_up_required" || code === "step_up_stale") && await requestStepUp("B") === "ok") {
          response = await send();
          code = response.ok ? undefined : (await response.json().catch(() => ({})) as { code?: string }).code;
        }
      }
      if (!response.ok || response.redirected) { setError(code ?? "internal_error"); return false; }
      startTransition(() => router.refresh());
      return true;
    } catch { setError("internal_error"); return false; } finally { setBusy(false); }
  }

  function recipientPayload(form: HTMLFormElement, row: Row | null, kind: "internal" | "external") {
    const data = new FormData(form);
    const shops = data.getAll("locationIds").map(String);
    return {
      id: row?.id ?? null, kind,
      userId: kind === "internal" ? (row?.user_id ?? String(data.get("userId") ?? "")) : null,
      email: kind === "external" ? String(data.get("email") ?? "") : null,
      displayName: String(data.get("displayName") ?? ""),
      active: data.get("active") === "on",
      cateringDigest: kind === "internal" && data.get("cateringDigest") === "on",
      shopDigest: kind === "internal" && data.get("shopDigest") === "on",
      locationIds: shops.length > 0 ? shops : null,
      packages: data.getAll("packages").map(String),
      cadence: String(data.get("cadence") ?? "") || null,
      formats: data.getAll("formats").map(String),
    };
  }

  const save = (form: HTMLFormElement, row: Row | null, kind: "internal" | "external") =>
    post("/api/admin/report-recipients", recipientPayload(form, row, kind));
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const errorText = (code: string) => {
    const key = `reportRecipients.error.${code}` as TranslationKey;
    const text = t(key);
    return text === key ? t("reportRecipients.error.internal_error") : text;
  };

  const modeTone = view.settings.mode === "live" ? "bg-co-success text-co-text" : view.settings.mode === "preview" ? "bg-co-warning-surface text-co-warning-text" : "bg-co-surface-2 text-co-text-muted";

  return <div className="space-y-4" aria-busy={busy || refreshing}>
    {error && <p role="alert" className="font-bold text-co-cta-text">{errorText(error)}</p>}
    {!view.canManage && <p className="text-sm text-co-text-muted">{t("reportRecipients.view_only")}</p>}

    <section className="co-card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-co-text">{t("reportRecipients.settings.title")}</h2>
        <span className={`${badge} ${modeTone}`}>{t(`reportRecipients.mode.${view.settings.mode}` as TranslationKey)}</span>
      </div>
      <p className="text-sm text-co-text-muted">{t(`reportRecipients.mode.${view.settings.mode}_hint` as TranslationKey)}</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void post("/api/admin/report-recipients/settings", {
          mode: String(data.get("mode")), cateringTimeEt: String(data.get("cateringTimeEt")),
          unifiedFallbackTimeEt: String(data.get("unifiedFallbackTimeEt")), graceMinutes: Number(data.get("graceMinutes")),
        });
      }}>
        <fieldset disabled={disabled} className="contents">
          <label className={label}>{t("reportRecipients.settings.mode")}
            <select className={input} name="mode" aria-label={t("reportRecipients.settings.mode")} defaultValue={view.settings.mode}>
              {DIGEST_DELIVERY_MODES.map((m) => <option key={m} value={m}>{t(`reportRecipients.mode.${m}` as TranslationKey)}</option>)}
            </select></label>
          <label className={label}>{t("reportRecipients.settings.catering_time")}
            <input className={input} name="cateringTimeEt" type="time" required aria-label={t("reportRecipients.settings.catering_time")} defaultValue={view.settings.cateringTimeEt} /></label>
          <label className={label}>{t("reportRecipients.settings.fallback_time")}
            <input className={input} name="unifiedFallbackTimeEt" type="time" required aria-label={t("reportRecipients.settings.fallback_time")} defaultValue={view.settings.unifiedFallbackTimeEt} /></label>
          <label className={label}>{t("reportRecipients.settings.grace")}
            <input className={input} name="graceMinutes" type="number" min={10} max={720} step={1} required aria-label={t("reportRecipients.settings.grace")} defaultValue={view.settings.graceMinutes} /></label>
          {view.canManage && <button className={`${button} sm:col-span-2`} type="submit">{t("common.save")}</button>}
        </fieldset>
      </form>
    </section>

    <section className="space-y-2">
      <h2 className="text-xs font-bold tracking-wide text-co-text-muted">{t("reportRecipients.automatic.title")}</h2>
      {DIGEST_KINDS.map((kind) => {
        const list = view.automatic[kind];
        const missing = list.filter((r) => r.skip !== null).length;
        return <CollapsibleSection key={kind} idBase={`auto-${kind}`} title={t(`reportRecipients.kind.${kind}` as TranslationKey)}
          count={t("reportRecipients.count", { n: list.length })}
          badge={missing > 0 ? <span className={`${badge} bg-co-warning-surface text-co-warning-text`}>{t("reportRecipients.not_receiving", { n: missing })}</span> : undefined}>
          <ul className="space-y-2">
            {list.length === 0 && <li className="text-sm text-co-text-muted">{t("reportRecipients.automatic.none")}</li>}
            {list.map((r, i) => <li key={`${r.name}-${i}`} className="co-card flex flex-wrap items-center gap-2 p-3 text-sm">
              <span className="font-bold text-co-text">{r.name}</span>
              <span className="text-co-text-muted">{r.shops.join(", ")}</span>
              {r.email && <span className="text-co-text-muted">{r.email}</span>}
              {r.skip && <span className={`${badge} bg-co-warning-surface text-co-warning-text`}>{t(`reportRecipients.skip.${r.skip}` as TranslationKey)}</span>}
            </li>)}
          </ul>
        </CollapsibleSection>;
      })}
    </section>

    <section className="space-y-2">
      <h2 className="text-xs font-bold tracking-wide text-co-text-muted">{t("reportRecipients.rows.title")}</h2>
      {view.rows.map((row) => {
        const noEmail = row.kind === "external" && !row.hasEmail;
        return <SummaryRow key={row.id} drawerId={`recipient-${row.id}`} expanded={open.has(row.id)} onToggle={() => toggle(row.id)}
          toggleLabel={t(open.has(row.id) ? "reportRecipients.hide" : "reportRecipients.show")}
          summary={<><span className="font-bold text-co-text">{row.display_name}</span><span className="text-sm text-co-text-muted">{t(`reportRecipients.rowkind.${row.kind}` as TranslationKey)}{row.userName ? ` · ${row.userName}` : ""}</span></>}
          badges={<>
            {!row.active && <span className={`${badge} bg-co-surface-2 text-co-text-muted`}>{t("reportRecipients.disabled")}</span>}
            {noEmail && <span className={`${badge} bg-co-warning-surface text-co-warning-text`}>{t("reportRecipients.add_email_to_enable")}</span>}
          </>}>
          <RecipientForm row={row} kind={row.kind} view={view} disabled={disabled} onSave={save} />
        </SummaryRow>;
      })}
    </section>

    {view.canManage && <section className="space-y-2">
      <CollapsibleSection idBase="add-internal" title={t("reportRecipients.add.internal")}><RecipientForm row={null} kind="internal" view={view} disabled={disabled} onSave={save} /></CollapsibleSection>
      <CollapsibleSection idBase="add-external" title={t("reportRecipients.add.external")}><RecipientForm row={null} kind="external" view={view} disabled={disabled} onSave={save} /></CollapsibleSection>
    </section>}
  </div>;
}
