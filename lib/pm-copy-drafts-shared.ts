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
 *
 * FINAL ROUND (Astra chunk G review #1, BC-007 / BC-042): an erased note could be sealed. Blur compared the erased
 * draft with the ACKNOWLEDGED value while the first save was still PENDING, so the clear was never sent; Done/Submit
 * then saw no dirty note and settled on the pending text. Now every note also carries its PENDING value (the latest
 * text queued for it): blur compares the draft with the latest of pending / acknowledged, and `createCopySync().flush()`
 * (what Done and Submit call) loops — save every draft that differs, wait for the queue and for every result to land —
 * until each draft EQUALS its acknowledged persisted value with nothing pending, refusing when a save failed.
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
  /** Note keys with a save outstanding → the LATEST text queued for that note (cleared when its result lands). */
  pendingNotes: Readonly<Record<string, string>>;
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
  return { saved: { answers, notes }, draft: { answers: { ...answers }, notes: { ...notes, ...noteDrafts } }, pending: {}, pendingNotes: {}, failed: {} };
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
/** The value a note is heading to: its latest PENDING save if one is outstanding, else its acknowledged value. */
export function noteTarget(d: CopyDrafts, key: string): string {
  return key in d.pendingNotes ? d.pendingNotes[key]! : (d.saved.notes[key] ?? "");
}
/** Blur's question: does the draft differ from the latest of pending / acknowledged (a cleared note included)? */
export function noteNeedsSave(d: CopyDrafts, key: string): boolean {
  return (d.draft.notes[key] ?? "") !== noteTarget(d, key);
}
/** The text a save of this note sends (the draft). */
export function notePendingSave(d: CopyDrafts, key: string): string {
  return d.draft.notes[key] ?? "";
}
/** A note save was queued with `text`: it is now the note's pending value. */
export function queueNote(d: CopyDrafts, key: string, text: string): CopyDrafts {
  return { ...d, pendingNotes: { ...d.pendingNotes, [key]: text } };
}
/**
 * A note's save came back. Saves run one at a time, in order, so ANY ok that was really sent (stale or not) is what
 * the server now holds: the acknowledged value becomes `sent`. A skipped save was never sent and moves nothing. The
 * LATEST result (not stale) ends the pending state; a latest failure keeps the draft and flags it.
 */
export function applyNoteResult(d: CopyDrafts, key: string, sent: string, r: SaveResult): CopyDrafts {
  let next = d;
  if (r.ok && !r.skipped) next = { ...next, saved: { ...next.saved, notes: { ...next.saved.notes, [key]: sent } } };
  if (r.stale) return next;
  next = { ...next, pendingNotes: without(next.pendingNotes, key) };
  return r.ok ? { ...next, failed: without(next.failed, `n:${key}`) } : { ...next, failed: { ...next.failed, [`n:${key}`]: true } };
}

/** The note's draft equals its acknowledged persisted value and nothing is outstanding or failed for it. */
export function noteIsSettled(d: CopyDrafts, key: string): boolean {
  return (d.draft.notes[key] ?? "") === (d.saved.notes[key] ?? "") && !(key in d.pendingNotes) && !d.failed[`n:${key}`];
}

/** Every note key whose draft differs from its saved value (Done / Submit save them before settling). */
export function dirtyNoteKeys(d: CopyDrafts): string[] {
  return Object.keys(d.draft.notes).filter((k) => noteNeedsSave(d, k));
}

/** The person holds work not yet safely saved: a changed note, a pending answer, or a failed save. */
export function personHasUnsaved(d: CopyDrafts, subjectId: string): boolean {
  const mine = (k: string) => subjectOf(k.startsWith("n:") ? k.slice(2) : k) === subjectId;
  return Object.keys(d.draft.notes).some((k) => mine(k) && !noteIsSettled(d, k))
    || Object.keys(d.pendingNotes).some(mine)
    || Object.keys(d.pending).some(mine)
    || Object.keys(d.failed).some(mine);
}

/** Nothing is outstanding anywhere: every note settled, no answer pending, no failure standing. */
export function copyIsSettled(d: CopyDrafts): boolean {
  return Object.keys(d.draft.notes).every((k) => noteIsSettled(d, k)) && Object.keys(d.pendingNotes).length === 0
    && Object.keys(d.pending).length === 0 && Object.keys(d.failed).length === 0;
}

// ─── the copy's sync: the drafts and the queue in one place (what the form drives) ──────────────────────────

export type FlushResult = { ok: true } | { ok: false; code: unknown };
export interface CopySync {
  /** The current drafts — always the latest (updated synchronously, before any listener runs). */
  get(): CopyDrafts;
  choose(key: string, grade: PmGrade | null): Promise<void>;
  type(key: string, text: string): void;
  /** On blur: queue a save when the draft differs from the latest of pending / acknowledged. Null = nothing to save. */
  blur(key: string, text: string): Promise<void> | null;
  /**
   * Done / Submit: save every note whose draft differs from where it is heading (and re-send a failed one), wait for
   * the queue AND for every result to land, and repeat until every draft equals its acknowledged persisted value with
   * nothing pending. A failed save — or no convergence within `maxRounds` — refuses (the form: pmv2.error.unsaved).
   */
  flush(): Promise<FlushResult>;
}

export function createCopySync<B>(opts: {
  initial: CopyDrafts;
  send: SaveSend<B>;
  noteBody: (key: string, text: string) => B;
  gradeBody: (key: string, grade: PmGrade | null) => B;
  onChange?: (d: CopyDrafts) => void;
  onResult?: (kind: "note" | "grade", key: string, r: SaveResult) => void;
  maxRounds?: number;
}): CopySync {
  let drafts = opts.initial;
  const queue = createSaveQueue(opts.send);
  const landing = new Set<Promise<void>>();
  const set = (next: CopyDrafts) => { drafts = next; opts.onChange?.(next); };
  const track = (p: Promise<void>): Promise<void> => {
    landing.add(p);
    void p.finally(() => landing.delete(p));
    return p;
  };
  const saveNote = (key: string, text: string): Promise<void> => {
    set(queueNote(drafts, key, text));
    return track(queue.save(`n:${key}`, opts.noteBody(key, text)).then((r) => {
      set(applyNoteResult(drafts, key, text, r));
      opts.onResult?.("note", key, r);
    }));
  };
  /** The queue is idle AND every result has been applied to the drafts. */
  const landed = async (): Promise<FlushResult> => {
    let r: FlushResult;
    do { r = await queue.settle(); await Promise.all([...landing]); } while (landing.size > 0);
    return r;
  };
  return {
    get: () => drafts,
    choose(key, grade) {
      set(chooseGrade(drafts, key, grade));
      return track(queue.save(`g:${key}`, opts.gradeBody(key, grade)).then((r) => {
        set(applyGradeResult(drafts, key, grade, r));
        opts.onResult?.("grade", key, r);
      }));
    },
    type(key, text) { set(editNote(drafts, key, text)); },
    blur(key, text) {
      set(editNote(drafts, key, text));
      return noteNeedsSave(drafts, key) ? saveNote(key, text) : null;
    },
    async flush() {
      const rounds = opts.maxRounds ?? 5;
      for (let i = 0; i < rounds; i++) {
        const resend = Object.keys(drafts.draft.notes).filter((k) => noteNeedsSave(drafts, k) || drafts.failed[`n:${k}`]);
        for (const k of resend) void saveNote(k, drafts.draft.notes[k] ?? "");
        const r = await landed();
        if (!r.ok) return r;
        if (copyIsSettled(drafts)) return { ok: true };
      }
      return { ok: false, code: "unsaved" };
    },
  };
}
