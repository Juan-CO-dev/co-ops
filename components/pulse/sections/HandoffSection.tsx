"use client";

/** Handoff: AM→PM notes (audience-scoped server-side), done/left, "Got it" (AGM+), authoring (AGM+). */
import { useState } from "react";
import { ActionButton } from "@/components/ActionButton";
import { formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { HandoffAudience, HandoffData } from "@/lib/pulse/types";
import { subHeading } from "@/components/pulse/shared";

const control = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text";

export function HandoffSection({ data, mode, locationId, onChanged }: { data: HandoffData; mode: "card" | "detail"; locationId: string; onChanged: () => Promise<void> }) {
  const { t, language } = useTranslation();
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<HandoffAudience>("all");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const notes = mode === "card" ? data.notes.slice(0, 3) : data.notes;

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true); setFailed(false);
    try {
      const res = await fetch("/api/pulse/handoff", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locationId, ...payload }) });
      if (!res.ok) { setFailed(true); return; }
      setBody("");
      await onChanged();
    } catch { setFailed(true); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-bold text-co-text">{t("pulse.handoff.reports", { done: data.done, left: data.left })}</p>
      <ul className="flex flex-wrap gap-1.5">
        {data.reports.map((r) => (
          <li key={r.key} className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${r.progress === "done" ? "bg-co-success-surface text-co-confirm-text" : r.progress === "in_progress" ? "bg-co-warning-surface text-co-warning-text" : "bg-co-surface-2 text-co-text-dim"}`}>
            {t(`midshift.report.${r.key}` as TranslationKey)}
          </li>
        ))}
      </ul>
      {notes.length === 0 ? <p className="text-sm text-co-text-muted">{t("pulse.handoff.notes_none")}</p> : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-co-border bg-co-surface-inset p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-co-text-dim">
                <span className="rounded-full bg-co-gold/20 px-2 py-0.5 font-bold uppercase tracking-[0.12em] text-co-gold-text">{t(`pulse.handoff.audience.${n.audience}` as TranslationKey)}</span>
                <span>{n.authorName ? t("pulse.handoff.by", { name: n.authorName, time: formatTime(n.at, language) }) : formatTime(n.at, language)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-co-text">{n.body}</p>
              {n.acks.length > 0 && <p className="mt-1 text-xs text-co-confirm-text">{t("pulse.handoff.acked_by", { names: n.acks.map((a) => a.name).join(", ") })}</p>}
              {data.canAuthor && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {n.ackedByMe
                    ? <span className="inline-flex min-h-[44px] items-center text-xs font-bold text-co-confirm-text">{t("pulse.handoff.acked")}</span>
                    : <ActionButton variant="secondary" disabled={busy} onClick={() => void post({ action: "ack", noteId: n.id })}>{t("pulse.handoff.ack")}</ActionButton>}
                  {mode === "detail" && <ActionButton variant="danger" disabled={busy} onClick={() => void post({ action: "supersede", noteId: n.id })}>{t("pulse.handoff.retract")}</ActionButton>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.canAuthor && mode === "detail" && (
        <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) void post({ action: "create", audience, body }); }}>
          <h3 className={subHeading}>{t("pulse.handoff.write")}</h3>
          <label className="flex flex-col gap-1 text-xs font-bold text-co-text-muted">
            {t("pulse.handoff.audience_label")}
            <select aria-label={t("pulse.handoff.audience_label")} value={audience} onChange={(e) => setAudience(e.target.value as HandoffAudience)} className={control}>
              {(["all", "crew", "managers"] as const).map((a) => <option key={a} value={a}>{t(`pulse.handoff.audience.${a}` as TranslationKey)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-co-text-muted">
            {t("pulse.handoff.body_label")}
            <textarea aria-label={t("pulse.handoff.body_label")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3} className={`${control} py-2`} />
          </label>
          {failed && <p role="alert" className="text-sm text-co-cta-text">{t("pulse.handoff.failed")}</p>}
          <ActionButton type="submit" disabled={busy || body.trim().length === 0}>{t("pulse.handoff.send")}</ActionButton>
        </form>
      )}
    </div>
  );
}
