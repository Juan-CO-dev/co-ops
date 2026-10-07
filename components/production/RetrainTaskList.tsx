"use client";

/**
 * Retrain tasks (batch vs bottle Phase B; Juan 2026-10-07: "maybe he can assign a kh+ to help
 * retrain whoever is not making the recipe right"). Rendered inside the dashboard's "My shift"
 * widget for the ASSIGNEE only (the loader returns only the actor's own open retrains at this
 * shop). Each task persists until marked done — it is not a daily report_assignment.
 * `MarkRetrainDone` is shared with the yield page, where a GM may close an open retrain.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { ActionButton } from "@/components/ActionButton";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { RetrainTaskView } from "@/lib/yield-stats";

const KNOWN = new Set(["forbidden", "not_found", "retrain_already_done", "invalid_note", "yield_unavailable"]);

export function RetrainTaskList({ tasks }: { tasks: RetrainTaskView[] }) {
  const { t, language } = useTranslation();
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold tracking-wide text-co-text-muted">{t("yield.task.heading")}</h3>
      <ul className="space-y-2">
        {tasks.map((task) => {
          const recipe = language === "es" ? (task.recipeNameEs ?? task.recipeName) : task.recipeName;
          const names = task.traineeNames.length > 0 ? task.traineeNames.join(", ") : t("yield.task.team");
          return (
            <li key={task.noteId} className="space-y-2 rounded-xl border border-co-border p-3">
              <p className="font-bold text-co-text">{t("yield.task.title", { names, recipe, from: task.fromName ?? "—" })}</p>
              {task.note ? <p className="text-sm text-co-text-muted">{task.note}</p> : null}
              <MarkRetrainDone noteId={task.noteId} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MarkRetrainDone({ noteId }: { noteId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    const res = await fetch("/api/operations/production/yield/retrain/done", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteId, doneNote: note }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setDone(true); router.refresh(); return; }
    const j = (await res?.json().catch(() => null)) as { code?: string } | null;
    setErr(t(("yield.error." + (j?.code && KNOWN.has(j.code) ? j.code : "generic")) as TranslationKey));
  };

  if (done) return <p className="text-xs font-semibold text-co-confirm-text">{t("yield.task.done")}</p>;
  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">{t("yield.task.done_note_label")}</span>
            <input value={note} maxLength={500} disabled={busy} onChange={(e) => setNote(e.target.value)}
              placeholder={t("yield.task.done_note_hint")} aria-label={t("yield.task.done_note_label")}
              className="min-h-[44px] rounded-lg border-2 border-co-border bg-co-surface px-3 text-sm text-co-text" />
          </label>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={busy} onClick={() => void submit()}>{t("yield.task.mark_done")}</ActionButton>
            <ActionButton variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{t("yield.nudge.cancel")}</ActionButton>
          </div>
        </>
      ) : (
        <div><ActionButton variant="secondary" onClick={() => { setErr(null); setOpen(true); }}>{t("yield.task.mark_done")}</ActionButton></div>
      )}
      {err ? <p role="alert" className="text-xs font-semibold text-co-cta-text">{err}</p> : null}
    </div>
  );
}
