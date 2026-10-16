/**
 * PM v2 — the copy form's DRAFTS and its SAVE QUEUE. Pure, client-safe (Astra chunk F review #1 and #2).
 *
 * #1 THE SAVED BASELINE MOVES. Every answer and note has a draft (what the manager sees) and a saved value (what
 * the server last accepted for it). A successful, CURRENT save moves the saved value, so erasing a note that was
 * saved a minute ago differs from the baseline and its clear is sent. The drafts live in ONE store above the
 * person cards, so collapsing a card never throws an answer away; a card holding unsaved work stays locked open
 * (disclosure D10, lib/disclosure-lock-shared).
 *
 * #2 SAVES ARE SERIALIZED PER COPY. `createSaveQueue` sends one save at a time, in the order they were made, so
 * the database sees Great then Good, never the reverse. The LATEST save of a key wins: one superseded while still
 * queued is never sent, and an older in-flight result comes back `stale` and is ignored (it neither moves the
 * baseline nor reverts the draft). `settle()` waits for every pending save, including any queued while it waits,
 * and reports the latest failure still standing — Done and Submit call it first and refuse when it failed.
 */
import type { PmGrade } from "@/lib/pm-report-v2-shared";

export type SaveSend<B> = (body: B) => Promise<{ ok: true } | { ok: false; code: unknown }>;
export interface SaveResult { ok: boolean; stale: boolean; skipped?: boolean; code?: unknown }

export interface SaveQueue<B> {
  /** Enqueue a save of `key` (one field: an answer or a note). Resolves when it ran, or was skipped as superseded. */
  save(key: string, body: B): Promise<SaveResult>;
  /** Wait for every pending save (and any queued meanwhile); ok unless a key's LATEST save failed. */
  settle(): Promise<{ ok: true } | { ok: false; code: unknown }>;
}

export function createSaveQueue<B>(send: SaveSend<B>): SaveQueue<B> {
  let tail: Promise<unknown> = Promise.resolve();
  let seq = 0;
  const latest = new Map<string, number>();
  const failures = new Map<string, unknown>();
  return {
    save(key, body) {
      const mine = ++seq;
      latest.set(key, mine);
      const run: Promise<SaveResult> = tail.then(async () => {
        if (latest.get(key) !== mine) return { ok: true, stale: true, skipped: true };
        let r: { ok: true } | { ok: false; code: unknown };
        try { r = await send(body); } catch { r = { ok: false, code: null }; }
        const stale = latest.get(key) !== mine;
        if (!stale) { if (r.ok) failures.delete(key); else failures.set(key, r.code); }
        return r.ok ? { ok: true, stale } : { ok: false, stale, code: r.code };
      });
      tail = run.catch(() => undefined);
      return run;
    },
    async settle() {
      let seen: Promise<unknown>;
      do { seen = tail; await seen; } while (seen !== tail);
      const first = failures.values().next();
      return first.done ? { ok: true } : { ok: false, code: first.value };
    },
  };
}

// ─── the drafts ──────────────────────────────────────────────────────────────

export const answerKey = (subjectId: string, positionId: string | null, criterionId: string): string => `${subjectId}|${positionId ?? ""}|${criterionId}`;
export const noteKey = (subjectId: string, positionId: string | null): string => `${subjectId}|${positionId ?? ""}`;
const subjectOf = (key: string): string => key.slice(0, key.indexOf("|"));

export interface CopyDrafts {
  saved: { answers: Readonly<Record<string, PmGrade | null>>; notes: Readonly<Record<string, string>> };
  draft: { answers: Readonly<Record<string, PmGrade | null>>; notes: Readonly<Record<string, string>> };
  /** Answer keys with a save not yet answered. */
  pending: Readonly<Record<string, number>>;
  /** Keys whose LATEST save failed. */
  failed: Readonly<Record<string, true>>;
}

interface DraftSource {
  people: ReadonlyArray<{ subjectId: string; positions: ReadonlyArray<{ positionId: string | null; note: string | null; answers: ReadonlyArray<{ criterionId: string; grade: PmGrade | null }> }> }>;
}

/** The store from the server's view: saved = draft = what the server holds. */
export function initialCopyDrafts(view: DraftSource, noteDrafts: Readonly<Record<string, string>> = {}): CopyDrafts {
  const answers: Record<string, PmGrade | null> = {};
  const notes: Record<string, string> = {};
  for (const p of view.people) {
    for (const pos of p.positions) {
      notes[noteKey(p.subjectId, pos.positionId)] = pos.note ?? "";
      for (const a of pos.answers) answers[answerKey(p.subjectId, pos.positionId, a.criterionId)] = a.grade;
    }
  }
  return { saved: { answers, notes }, draft: { answers: { ...answers }, notes: { ...notes, ...noteDrafts } }, pending: {}, failed: {} };
}

const without = <T,>(o: Readonly<Record<string, T>>, k: string): Record<string, T> => { const n = { ...o }; delete n[k]; return n; };

/** A tap on an answer: the draft shows it at once and a save is pending for it. */
export function chooseGrade(d: CopyDrafts, key: string, grade: PmGrade | null): CopyDrafts {
  return { ...d, draft: { ...d.draft, answers: { ...d.draft.answers, [key]: grade } }, pending: { ...d.pending, [key]: (d.pending[key] ?? 0) + 1 } };
}

/** An answer's save came back. Current + ok → the baseline moves; current + failed → the draft returns to the baseline. */
export function applyGradeResult(d: CopyDrafts, key: string, grade: PmGrade | null, r: SaveResult): CopyDrafts {
  const left = (d.pending[key] ?? 1) - 1;
  const pending = left > 0 ? { ...d.pending, [key]: left } : without(d.pending, key);
  if (r.stale) return { ...d, pending };
  if (r.ok) return { ...d, pending, saved: { ...d.saved, answers: { ...d.saved.answers, [key]: grade } }, failed: without(d.failed, key) };
  const answers = { ...d.draft.answers };
  if (key in d.saved.answers) answers[key] = d.saved.answers[key] ?? null; else delete answers[key];
  return { ...d, pending, draft: { ...d.draft, answers }, failed: { ...d.failed, [key]: true } };
}

export function editNote(d: CopyDrafts, key: string, text: string): CopyDrafts {
  return { ...d, draft: { ...d.draft, notes: { ...d.draft.notes, [key]: text } } };
}
export function noteNeedsSave(d: CopyDrafts, key: string): boolean {
  return (d.draft.notes[key] ?? "") !== (d.saved.notes[key] ?? "");
}
/** The text a save of this note sends (the draft). */
export function notePendingSave(d: CopyDrafts, key: string): string {
  return d.draft.notes[key] ?? "";
}
/** A note's save came back: current + ok → the baseline is what was sent; a failure keeps the draft (and flags it). */
export function applyNoteResult(d: CopyDrafts, key: string, sent: string, r: SaveResult): CopyDrafts {
  if (r.stale) return d;
  if (r.ok) return { ...d, saved: { ...d.saved, notes: { ...d.saved.notes, [key]: sent } }, failed: without(d.failed, `n:${key}`) };
  return { ...d, failed: { ...d.failed, [`n:${key}`]: true } };
}

/** Every note key whose draft differs from its saved value (Done / Submit save them before settling). */
export function dirtyNoteKeys(d: CopyDrafts): string[] {
  return Object.keys(d.draft.notes).filter((k) => noteNeedsSave(d, k));
}

/** The person holds work not yet safely saved: a changed note, a pending answer, or a failed save. */
export function personHasUnsaved(d: CopyDrafts, subjectId: string): boolean {
  const mine = (k: string) => subjectOf(k.startsWith("n:") ? k.slice(2) : k) === subjectId;
  return Object.keys(d.draft.notes).some((k) => mine(k) && noteNeedsSave(d, k))
    || Object.keys(d.pending).some(mine)
    || Object.keys(d.failed).some(mine);
}
