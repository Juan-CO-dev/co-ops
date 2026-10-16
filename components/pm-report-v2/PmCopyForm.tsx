"use client";
/**
 * PM v2 — the manager's OWN copy of today's report (Scheduling Phase 1, Task 21).
 *
 * Phone-first, one person per card, the disclosure doctrine: a header ("Your copy · only you can see it until
 * the closing manager submits"), "My time on the floor", a summary row ("8 people · 5 rated"), then one
 * collapsed card per person (name + positions worked); expanding shows, per position, each criterion as a
 * Great / Good / Needs work / Didn't see control, a private free-text box, and "Worked somewhere else?".
 *
 * THE ONE LIFECYCLE (r1 P2-9, `copyFormState` from PM_COPY_TRANSITIONS): an OPEN copy is editable; a DONE copy
 * renders read-only — every control disabled — with "You marked this done · Reopen to change it" and Reopen;
 * a SEALED copy renders no controls (the page shows the results). Other managers' copies are COUNTS only: the
 * view this component receives never contains them. Autosave per answer (the save-status pattern). 44 px
 * controls with items-center; useState only; no email, no notification.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/types";
import type { PmCopyPositionView, PmCopyView } from "@/lib/pm-report-v2";
import { PM_GRADES, PM_V2_ERROR_CODES, wallTimeOf, type PmGrade } from "@/lib/pm-report-v2-shared";
import { SaveStatus } from "@/components/ui/SaveStatus";
import type { SavePhase } from "@/lib/save-status-shared";

const button = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-gold-deep bg-co-gold px-4 font-bold text-co-text disabled:opacity-60";
const quiet = "inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 border-co-border bg-co-surface px-4 font-bold text-co-text disabled:opacity-60";
const control = "flex min-h-[44px] w-full min-w-0 items-center rounded-lg border-2 border-co-border bg-co-surface px-3 text-base text-co-text disabled:opacity-60";
const fieldLabel = "grid min-w-0 gap-1 text-[11px] font-bold tracking-[0.12em] text-co-text-dim";
const groupLabel = "text-xs font-bold tracking-wide text-co-text-muted";

export function pmV2ErrorKey(code: unknown): TranslationKey {
  return typeof code === "string" && (PM_V2_ERROR_CODES as readonly string[]).includes(code) ? (`pmv2.error.${code}` as TranslationKey) : "pmv2.error.generic";
}
async function post(body: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; code: unknown }> {
  try {
    const res = await fetch("/api/pm-report/v2", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return res.ok ? { ok: true, data: json } : { ok: false, code: json.code };
  } catch {
    return { ok: false, code: null };
  }
}
function minutesLabel(t: (k: TranslationKey, p?: Record<string, string | number>) => string, minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? t("pmv2.duration.hm", { h, m }) : t("pmv2.duration.m", { m });
}

export function PmCopyForm({ view, prefillFrom = null, initiallyOpen = false }: { view: PmCopyView; prefillFrom?: string | null; initiallyOpen?: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const editable = view.formState === "editable";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [from, setFrom] = useState(wallTimeOf(view.copy.observedFrom) || wallTimeOf(prefillFrom));
  const [to, setTo] = useState(wallTimeOf(view.copy.observedTo));
  const [confirming, setConfirming] = useState(false);
  const [mvp, setMvp] = useState(view.mvpUserId ?? "");

  async function act(body: Record<string, unknown>, after?: () => void) {
    setBusy(true); setError(null);
    const r = await post({ locationId: view.locationId, ...body });
    setBusy(false);
    if (!r.ok) { setError(pmV2ErrorKey(r.code)); return; }
    after?.();
    router.refresh();
  }
  const windowSaved = Boolean(view.copy.observedFrom);

  return (
    <section className="grid gap-3" aria-label={t("pmv2.copy.title")}>
      <div className="co-card grid gap-2 p-4">
        <h2 className="text-base font-bold text-co-text">{t("pmv2.copy.header")}</h2>
        {view.formState === "done_readonly" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-co-warning bg-co-warning-surface px-3 py-2">
            <p className="min-w-0 flex-1 text-sm font-bold text-co-warning-text">{t("pmv2.copy.doneBanner")}</p>
            <button type="button" className={quiet} disabled={busy} onClick={() => act({ action: "reopen", copyId: view.copy.id })}>{t("pmv2.copy.reopen")}</button>
          </div>
        )}
        {view.formState === "sealed" && <p className="text-sm text-co-text-muted">{t("pmv2.copy.sealed")}</p>}
        <div className="grid gap-2">
          <span className={groupLabel}>{t("pmv2.window.title")}</span>
          <div className="flex flex-wrap items-end gap-2">
            <label className={fieldLabel}>{t("pmv2.window.from")}
              <input type="time" className={control} value={from} onChange={(e) => setFrom(e.target.value)} disabled={!editable || busy} />
            </label>
            <label className={fieldLabel}>{t("pmv2.window.to")}
              <input type="time" className={control} value={to} onChange={(e) => setTo(e.target.value)} disabled={!editable || busy} />
            </label>
            {editable && (
              <button type="button" className={quiet} disabled={busy || !from} onClick={() => act({ action: "window", copyId: view.copy.id, from, to: to || null })}>
                {t("pmv2.window.save")}
              </button>
            )}
          </div>
          {!windowSaved && <p className="text-sm text-co-text-muted">{t(prefillFrom ? "pmv2.window.prefilled" : "pmv2.window.required")}</p>}
        </div>
        <p className="text-sm text-co-text">{t("pmv2.copy.summary", { people: view.summary.people, rated: view.summary.rated })}</p>
        {view.others.started > 0 && <p className="text-sm text-co-text-muted">{t("pmv2.copy.others", { n: view.others.started })}</p>}
      </div>

      {view.people.map((p) => <PersonCard key={p.subjectId} person={p} view={view} editable={editable && !busy} initiallyOpen={initiallyOpen} />)}

      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      {view.formState !== "sealed" && (
        <div className="co-card grid gap-2 p-4">
          {editable && (
            <button type="button" className={quiet} disabled={busy || !windowSaved} onClick={() => act({ action: "done", copyId: view.copy.id })}>{t("pmv2.copy.markDone")}</button>
          )}
          {!confirming ? (
            <button type="button" className={button} disabled={busy} onClick={() => setConfirming(true)}>{t("pmv2.submit.button")}</button>
          ) : (
            <div className="grid gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-3">
              <p className="text-sm font-bold text-co-text">{t("pmv2.submit.confirm", { started: view.others.started + 1, done: view.others.done + (view.copy.status === "done" ? 1 : 0) })}</p>
              <label className={fieldLabel}>{t("pmv2.submit.mvp")}
                <select className={control} value={mvp} onChange={(e) => setMvp(e.target.value)} disabled={busy}>
                  <option value="">{t("pmv2.submit.noMvp")}</option>
                  {view.people.map((p) => <option key={p.subjectId} value={p.subjectId}>{p.name}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={button} disabled={busy} onClick={async () => {
                  setBusy(true); setError(null);
                  if ((view.mvpUserId ?? "") !== mvp) {
                    const m = await post({ action: "set_mvp", locationId: view.locationId, mvpUserId: mvp || null });
                    if (!m.ok) { setBusy(false); setError(pmV2ErrorKey(m.code)); return; }
                  }
                  const r = await post({ action: "submit", locationId: view.locationId });
                  setBusy(false);
                  if (!r.ok) { setError(pmV2ErrorKey(r.code)); return; }
                  setConfirming(false);
                  router.refresh();
                }}>{t("pmv2.submit.confirmButton")}</button>
                <button type="button" className={quiet} disabled={busy} onClick={() => setConfirming(false)}>{t("pmv2.submit.cancel")}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PersonCard({ person, view, editable, initiallyOpen }: { person: PmCopyView["people"][number]; view: PmCopyView; editable: boolean; initiallyOpen: boolean }) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const name = (p: PmCopyPositionView) => p.positionId === null ? t("pmv2.position.none") : (language === "es" && p.nameEs ? p.nameEs : p.name ?? "");
  const worked = person.positions.map((p) => p.positionId === null ? name(p) : `${name(p)} ${p.added ? t("pmv2.position.addedShort") : minutesLabel(t, p.minutes)}`).join(" · ");
  const id = `pmv2-${person.subjectId}`;
  return (
    <div className="co-card p-0">
      <button type="button" className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left" aria-expanded={open} aria-controls={id}
        aria-label={t("pmv2.person.toggle", { name: person.name })} onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0 flex-1 basis-[10rem] font-bold text-co-text">{person.name}</span>
        <span className="text-sm text-co-text-muted">{worked}</span>
        {person.rated && <span className="rounded-full bg-co-gold/20 px-2 py-0.5 text-xs font-bold text-co-text">{t("pmv2.person.rated")}</span>}
      </button>
      {open && (
        <div id={id} className="grid gap-4 border-t border-co-border/50 px-4 pb-4 pt-3">
          {person.positions.map((p) => <PositionBlock key={p.positionId ?? "none"} subjectId={person.subjectId} position={p} positionName={name(p)} view={view} editable={editable} />)}
          {editable && <AddPosition subjectId={person.subjectId} view={view} />}
        </div>
      )}
    </div>
  );
}

function PositionBlock({ subjectId, position, positionName, view, editable }: { subjectId: string; position: PmCopyPositionView; positionName: string; view: PmCopyView; editable: boolean }) {
  const { t, language } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, PmGrade | null>>(() => Object.fromEntries(position.answers.map((a) => [a.criterionId, a.grade])));
  const [note, setNote] = useState(position.note ?? "");
  const [phase, setPhase] = useState<SavePhase>("idle");
  const [error, setError] = useState<TranslationKey | null>(null);
  async function save(body: Record<string, unknown>, onFail: () => void) {
    setPhase("saving"); setError(null);
    const r = await post({ locationId: view.locationId, copyId: view.copy.id, subjectId, positionId: position.positionId, ...body });
    if (r.ok) setPhase("saved"); else { setPhase("failed"); setError(pmV2ErrorKey(r.code)); onFail(); }
  }
  function choose(criterionId: string, grade: PmGrade | null) {
    const before = answers[criterionId];
    setAnswers((a) => ({ ...a, [criterionId]: grade }));
    void save({ action: "grade", criterionId, grade }, () => setAnswers((a) => {
      const next = { ...a };
      if (before === undefined) delete next[criterionId]; else next[criterionId] = before;
      return next;
    }));
  }
  const choices: Array<{ grade: PmGrade | null; key: TranslationKey }> = [
    ...PM_GRADES.map((g) => ({ grade: g, key: `pmv2.grade.${g}` as TranslationKey })),
    { grade: null, key: "pmv2.grade.didntSee" },
  ];
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-bold text-co-text">
        {positionName}{position.added ? ` · ${t("pmv2.position.added", { reason: position.added.reason })}` : ""}
      </h3>
      {position.criteria.map((c) => {
        const current = c.id in answers ? answers[c.id] : undefined;
        return (
          <fieldset key={c.id} className="grid gap-1" disabled={!editable}>
            <legend className="text-sm text-co-text">{language === "es" && c.labelEs ? c.labelEs : c.label}</legend>
            <div className="flex flex-wrap gap-2" role="group">
              {choices.map((ch) => (
                <button key={String(ch.grade)} type="button" aria-pressed={current === ch.grade}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border-2 px-3 text-sm font-bold disabled:opacity-60 ${current === ch.grade ? "border-co-text bg-co-gold text-co-text" : "border-co-border bg-co-surface text-co-text"}`}
                  disabled={!editable} onClick={() => choose(c.id, ch.grade)}>{t(ch.key)}</button>
              ))}
            </div>
          </fieldset>
        );
      })}
      <label className={fieldLabel}>{t("pmv2.note.label")}
        <textarea className={`${control} min-h-[88px] py-2`} value={note} maxLength={500} disabled={!editable}
          onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note !== (position.note ?? "")) void save({ action: "note", note }, () => undefined); }} />
      </label>
      <SaveStatus phase={phase} />
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
    </div>
  );
}

function AddPosition({ subjectId, view }: { subjectId: string; view: PmCopyView }) {
  const { t, language } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [positionId, setPositionId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  if (!open) return <button type="button" className={quiet} onClick={() => setOpen(true)}>{t("pmv2.add.open")}</button>;
  return (
    <div className="grid gap-2 rounded-lg border-2 border-co-border bg-co-surface-inset p-3">
      <label className={fieldLabel}>{t("pmv2.add.position")}
        <select className={control} value={positionId} onChange={(e) => setPositionId(e.target.value)} disabled={busy}>
          <option value="">{t("pmv2.add.pick")}</option>
          {view.availablePositions.map((p) => <option key={p.positionId} value={p.positionId}>{language === "es" && p.nameEs ? p.nameEs : p.name}</option>)}
        </select>
      </label>
      <label className={fieldLabel}>{t("pmv2.add.reason")}
        <input className={control} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      </label>
      {error && <p role="alert" className="text-sm font-bold text-co-cta-text">{t(error)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={busy || !positionId || !reason.trim()} onClick={async () => {
          setBusy(true); setError(null);
          const r = await post({ action: "add_position", locationId: view.locationId, copyId: view.copy.id, subjectId, positionId, reason });
          setBusy(false);
          if (!r.ok) { setError(pmV2ErrorKey(r.code)); return; }
          setOpen(false); setPositionId(""); setReason("");
          router.refresh();
        }}>{t("pmv2.add.save")}</button>
        <button type="button" className={quiet} disabled={busy} onClick={() => setOpen(false)}>{t("pmv2.add.cancel")}</button>
      </div>
    </div>
  );
}
