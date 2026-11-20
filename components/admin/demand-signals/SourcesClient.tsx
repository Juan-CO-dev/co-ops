"use client";
/**
 * The source verification page (item 4 PR 5; MoO / Owner / CGS, decided on the server before anything is read).
 * One summary row per registered source (name, its status NOW, its gate), a lens over the list (D6), and a
 * drawer with what the register holds: where the data is, the terms page, the sentence quoted from it, the
 * conditions. The mark form is TRIGGERED: the person says they read the terms, writes why, and is asked for
 * their password (Tier B, always prompted) before POST /api/admin/demand-signals/sources/mark.
 * THE FORM IS BOUND TO THE DEFINITION IT WAS OPENED ON (review r1 P2): the hash is captured when the form opens
 * and THAT hash is what is sent. A refresh that brings a replacement definition (another save on this page
 * refreshes every row) never re-points an open form, its tick or its note at details the person did not read:
 * the form says the details changed, Save is off, and the writer would refuse the old hash anyway
 * (`source_definition_moved`). To mark the new definition the person closes the form and reads it.
 * Only "Allowed" and "Allowed with conditions" sources can be verified; the screen says why the others cannot.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useStepUp } from "@/components/admin/StepUpProvider";
import { SOURCE_MARK_NOTE_MAX, SOURCE_MARK_NOTE_MIN } from "@/lib/demand-signals/input-shared";
import type { SourceDefinitionView } from "@/lib/demand-signals/sources-shared";
import { formatDateLabelWithYear, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { etDisplayDate } from "@/lib/operational-day";

export interface SourceView {
  sourceId: string; definitionHash: string; name: string; category: string; gate: string; adapter: string | null;
  status: "unverified" | "verified" | "revoked"; termsStatus: string; termsUrl: string | null; markedAt: string | null; markedByName: string | null;
  definition: SourceDefinitionView | null;
}
export interface SourcesView { sources: SourceView[] }

const button = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const quiet = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border bg-co-surface px-4 font-bold text-co-text disabled:opacity-60";
const danger = "inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-cta-text bg-co-surface px-4 font-bold text-co-cta-text disabled:opacity-60";
const control = "min-h-[44px] items-center min-w-0 max-w-full rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";
const fieldLabel = "grid min-w-0 max-w-full gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const CHIP = "rounded-full bg-co-surface-inset px-2 py-0.5 text-xs font-bold text-co-text-muted";
const WARN_CHIP = "rounded-full bg-co-warning-surface px-2 py-0.5 text-xs font-bold text-co-warning-text";
const OK_CHIP = "rounded-full bg-co-surface-inset px-2 py-0.5 text-xs font-bold text-co-confirm-text";

const GATES = ["allow", "allow_with_conditions", "pending_terms", "named_only", "refuse"];
const INGESTIBLE = ["allow", "allow_with_conditions"];
const MARK_ERRORS = ["forbidden", "invalid", "demand_source_forbidden", "demand_source_invalid", "source_unknown", "source_definition_moved", "source_not_ingestible",
  "source_status_unchanged", "source_terms_evidence_missing", "demand_signals_unavailable"];
const markErrorKey = (code: string | undefined): TranslationKey => (MARK_ERRORS.includes(code ?? "") ? `signals.sources.error.${code}` : "signals.sources.error.generic") as TranslationKey;
const gateKey = (gate: string): TranslationKey => `signals.sources.gate.${GATES.includes(gate) ? gate : "refuse"}` as TranslationKey;
const safeUrl = (u: string | null) => (u !== null && u.startsWith("https://") ? u : null);

const LENSES = ["all", "can_verify", "verified", "revoked", "by_hand", "not_allowed"] as const;
type Lens = (typeof LENSES)[number];
function inLens(s: SourceView, lens: Lens): boolean {
  if (lens === "all") return true;
  if (lens === "verified") return s.status === "verified";
  if (lens === "revoked") return s.status === "revoked";
  if (lens === "can_verify") return INGESTIBLE.includes(s.gate) && s.status !== "verified";
  if (lens === "by_hand") return s.gate === "named_only";
  return s.gate === "pending_terms" || s.gate === "refuse";
}

export function SourcesClient({ view }: { view: SourcesView }) {
  const { t } = useTranslation();
  const [lens, setLens] = useState<Lens>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const shown = view.sources.filter((s) => inLens(s, lens) && (q === "" || s.name.toLowerCase().includes(q) || s.sourceId.includes(q)));
  const toggle = (id: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <div className="space-y-3">
    {view.sources.length === 0 && <p className="co-card p-4 text-co-text-muted">{t("signals.sources.none")}</p>}
    {view.sources.length > 0 && <>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("signals.sources.lens.aria")}>
        {LENSES.map((l) => <button key={l} type="button" aria-pressed={lens === l} onClick={() => setLens(l)}
          className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-pressed:border-co-text">
          {t(`signals.sources.lens.${l}` as TranslationKey, { n: view.sources.filter((s) => inLens(s, l)).length })}</button>)}
      </div>
      <label className={fieldLabel}>{t("signals.sources.search")}
        <input type="search" className={control} value={query} aria-label={t("signals.sources.search")} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className="text-sm text-co-text-dim">{t("signals.sources.shown", { n: shown.length, total: view.sources.length })}</p>
      <ul className="space-y-2">{shown.map((s) => <li key={s.sourceId}><SourceRowView source={s} open={open.has(s.sourceId)} onToggle={() => toggle(s.sourceId)} /></li>)}</ul>
    </>}
  </div>;
}

function SourceRowView({ source, open, onToggle }: { source: SourceView; open: boolean; onToggle: () => void }) {
  const { t, language } = useTranslation();
  const { requestStepUp } = useStepUp();
  const router = useRouter();
  // What the open form is about: the act AND the definition the person was shown when they opened it.
  const [form, setForm] = useState<{ status: "verified" | "revoked"; definitionHash: string } | null>(null);
  const marking = form?.status ?? null;
  const moved = form !== null && form.definitionHash !== source.definitionHash;
  const [read, setRead] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<TranslationKey | null>(null);
  const [saved, setSaved] = useState(false);
  const panelId = `signals-source-${source.sourceId}`;
  const d = source.definition;
  const ingestible = INGESTIBLE.includes(source.gate);
  const canVerify = ingestible && source.status !== "verified";
  const canRevoke = source.status === "verified";
  const termsUrl = safeUrl(source.termsUrl);
  const noteOk = note.trim().length >= SOURCE_MARK_NOTE_MIN && note.trim().length <= SOURCE_MARK_NOTE_MAX;
  const ready = marking !== null && !moved && noteOk && (marking === "revoked" || read);
  // A drawer with an open form stays mounted and locked open (D10).
  const isOpen = open || marking !== null;

  async function save() {
    if (form === null || marking === null || moved) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      if (await requestStepUp("B") !== "ok") return;
      // The hash captured when the form opened, never the row's current one.
      const payload = { sourceId: source.sourceId, definitionHash: form.definitionHash, status: marking, note: note.trim() };
      const post = () => fetch("/api/admin/demand-signals/sources/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      let response = await post();
      let body: { code?: string } = {};
      if (!response.ok) {
        body = await response.json().catch(() => ({})) as { code?: string };
        if ((body.code === "step_up_required" || body.code === "step_up_stale") && await requestStepUp("B") === "ok") {
          response = await post();
          if (!response.ok) body = await response.json().catch(() => ({})) as { code?: string };
        }
      }
      if (!response.ok || response.redirected) { setError(markErrorKey(body.code)); return; }
      setSaved(true); setForm(null); setNote(""); setRead(false);
      startTransition(() => router.refresh());
    } catch { setError("signals.sources.error.generic"); } finally { setBusy(false); }
  }

  return <div className="rounded-lg border-2 border-co-border">
    <button type="button" aria-expanded={isOpen} aria-controls={panelId} aria-label={t("signals.sources.aria.row", { name: source.name })}
      onClick={() => { if (marking === null) onToggle(); }} className="flex min-h-[44px] w-full flex-wrap items-center gap-2 px-3 py-2 text-left">
      <span className="font-bold text-co-text">{source.name}</span>
      <span className={source.status === "verified" ? OK_CHIP : source.status === "revoked" ? WARN_CHIP : CHIP}>{t(`signals.source.status.${source.status}` as TranslationKey)}</span>
      <span className={CHIP}>{t(gateKey(source.gate))}</span>
      {source.adapter !== null && <span className={CHIP}>{t("signals.sources.has_adapter")}</span>}
    </button>
    {isOpen && <div id={panelId} className="space-y-3 border-t-2 border-co-border p-3 text-sm text-co-text">
      <p className="text-co-text-muted">{t(`signals.sources.gate_help.${GATES.includes(source.gate) ? source.gate : "refuse"}` as TranslationKey)}</p>
      {d === null && <p role="alert" className="font-bold text-co-cta-text">{t("signals.sources.definition_unreadable")}</p>}
      {d !== null && <dl className="space-y-2">
        {d.gives && <div><dt className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.sources.field.gives")}</dt><dd>{d.gives}</dd></div>}
        <div><dt className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.sources.field.terms")}</dt>
          <dd>{termsUrl ? <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center break-all font-bold underline">{termsUrl}</a>
            : t("signals.sources.no_terms_url")}</dd>
          <dd className="text-co-text-muted">{source.termsStatus === "verified" ? t("signals.sources.terms_read", { date: d.termsCheckedOn ? formatDateLabelWithYear(d.termsCheckedOn, language) : "-" }) : t("signals.sources.terms_unread")}</dd>
        </div>
        {d.termsQuote && <div><dt className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.sources.field.quote")}</dt><dd className="italic">{d.termsQuote}</dd></div>}
        {d.conditions.length > 0 && <div><dt className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.sources.field.conditions")}</dt>
          <dd><ul className="list-disc pl-5">{d.conditions.map((c, i) => <li key={i}>{c}</li>)}</ul></dd></div>}
        {d.endpoints.length > 0 && <div><dt className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.sources.field.endpoints")}</dt>
          <dd><ul className="space-y-1">{d.endpoints.map((u, i) => <li key={i} className="break-all">{u}</li>)}</ul></dd></div>}
        {d.rateLimit && <div><dt className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.sources.field.rate")}</dt><dd>{d.rateLimit}</dd></div>}
        {d.caveats && <div><dt className="text-xs font-bold tracking-wide text-co-text-muted">{t("signals.sources.field.caveats")}</dt><dd>{d.caveats}</dd></div>}
      </dl>}
      <p className="text-co-text-muted">{t("signals.sources.register_text")}</p>
      <p>{source.markedAt
        ? t("signals.sources.marked", { status: t(`signals.source.status.${source.status}` as TranslationKey), who: source.markedByName ?? t("signals.sources.marked_unknown"),
          when: `${formatDateLabelWithYear(etDisplayDate(source.markedAt), language)}, ${formatTime(source.markedAt, language)}` })
        : t("signals.sources.never_marked")}</p>
      {saved && <p role="status" className="font-bold text-co-confirm-text">{t("signals.sources.saved")}</p>}
      {error && <p role="alert" className="font-bold text-co-cta-text">{t(error)}</p>}
      {marking === null && <div className="flex flex-wrap gap-2">
        {canVerify && <button type="button" className={button} onClick={() => { setForm({ status: "verified", definitionHash: source.definitionHash }); setRead(false); setNote(""); setSaved(false); setError(null); }}>{t("signals.sources.verify")}</button>}
        {canRevoke && <button type="button" className={danger} onClick={() => { setForm({ status: "revoked", definitionHash: source.definitionHash }); setRead(false); setNote(""); setSaved(false); setError(null); }}>{t("signals.sources.revoke")}</button>}
      </div>}
      {marking === null && !ingestible && <p className="text-co-text-dim">{t("signals.sources.cannot_verify")}</p>}
      {marking !== null && <div className="space-y-3 rounded-lg bg-co-surface-inset p-3">
        <p className="font-bold">{t(marking === "verified" ? "signals.sources.form.verify_title" : "signals.sources.form.revoke_title", { name: source.name })}</p>
        <p className="text-co-text-muted">{t(marking === "verified" ? "signals.sources.form.verify_help" : "signals.sources.form.revoke_help")}</p>
        {moved && <p role="alert" className="font-bold text-co-cta-text">{t("signals.sources.form.moved")}</p>}
        {marking === "verified" && <label className="flex min-h-[44px] items-center gap-3">
          <input type="checkbox" className="h-5 w-5" checked={read} aria-label={t("signals.sources.aria.read", { name: source.name })} onChange={(e) => setRead(e.target.checked)} />
          <span>{t("signals.sources.form.read")}</span>
        </label>}
        <label className={fieldLabel}>{t("signals.sources.field.note")}
          <textarea className={`${control} py-2`} value={note} maxLength={SOURCE_MARK_NOTE_MAX} aria-label={t("signals.sources.aria.note", { name: source.name })} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={marking === "verified" ? button : danger} disabled={busy || !ready} onClick={save}>
            {t(marking === "verified" ? "signals.sources.form.verify_save" : "signals.sources.form.revoke_save")}</button>
          <button type="button" className={quiet} disabled={busy} onClick={() => { setForm(null); setRead(false); setNote(""); setError(null); }}>{t("signals.event.cancel")}</button>
        </div>
      </div>}
    </div>}
  </div>;
}
