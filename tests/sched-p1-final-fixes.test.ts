/**
 * Scheduling Phase 1 — the FINAL fix round after Astra's chunk G review (2026-10-16), fix 1 (P2, BC-007 / BC-042).
 *
 * An erased note could be sealed by Done / Submit: blur compared the erased draft with the still-blank ACKNOWLEDGED
 * value (the first save was still pending), so the clear was never sent, and Done / Submit found no dirty note before
 * settling — the pending "temporary" then persisted while the screen showed "". The copy's sync now tracks the PENDING
 * note value beside the acknowledged one; blur compares against the latest of the two; Done / Submit FLUSH until every
 * draft equals its acknowledged persisted value, and refuse (pmv2.error.unsaved, en + es) when a save fails.
 *
 * The regression drives the real controller with a deferred server: displayed == persisted == "".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  applyNoteResult, createCopySync, editNote, initialCopyDrafts, noteKey, noteNeedsSave, queueNote, type CopyDrafts,
} from "@/lib/pm-copy-drafts-shared";

const EMP = "00000000-0000-4000-8000-000000000006", P = "00000000-0000-4000-8000-000000000021";
const K = noteKey(EMP, P);
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

function view(note: string | null = null) {
  return { people: [{ subjectId: EMP, positions: [{ positionId: P, note, answers: [] }] }] };
}

type Body = { kind: "note" | "grade"; key: string; note?: string; grade?: unknown };
type Reply = { ok: true } | { ok: false; code: unknown };

/** A fake server: every save waits for the test to answer it; an ok answer persists the note, in arrival order. */
function harness(initialNote: string | null = null) {
  const server = { note: initialNote ?? "" };
  const calls: Array<{ body: Body; answer: (r: Reply) => void }> = [];
  const sync = createCopySync<Body>({
    initial: initialCopyDrafts(view(initialNote)),
    send: (body) => {
      const gate = deferred<Reply>();
      calls.push({ body, answer: (r) => { if (r.ok && body.kind === "note") server.note = body.note ?? ""; gate.resolve(r); } });
      return gate.promise;
    },
    noteBody: (key, text) => ({ kind: "note", key, note: text }),
    gradeBody: (key, grade) => ({ kind: "grade", key, grade }),
  });
  const displayed = () => sync.get().draft.notes[K] ?? "";
  return { server, calls, sync, displayed };
}

describe("fix 1: an erased note can never be sealed by Done / Submit", () => {
  it("pure: blur after an erase compares with the PENDING value, not the stale acknowledged one", () => {
    let d: CopyDrafts = initialCopyDrafts(view(null));
    d = editNote(d, K, "temporary");
    d = queueNote(d, K, "temporary"); // the blur's save is pending
    d = editNote(d, K, "");
    expect(noteNeedsSave(d, K)).toBe(true); // the old code compared "" with the acknowledged "" and skipped the clear
  });

  it("pure: an older in-flight ok records what the server holds; the newer pending value stays outstanding", () => {
    let d = queueNote(editNote(initialCopyDrafts(view(null)), K, "temporary"), K, "temporary");
    d = queueNote(editNote(d, K, ""), K, "");
    d = applyNoteResult(d, K, "temporary", { ok: true, stale: true });
    expect(d.saved.notes[K]).toBe("temporary");
    expect(d.pendingNotes[K]).toBe("");
    expect(noteNeedsSave(d, K)).toBe(false); // the clear is already queued
    d = applyNoteResult(d, K, "", { ok: true, stale: false });
    expect(d.saved.notes[K]).toBe("");
    expect(K in d.pendingNotes).toBe(false);
  });

  it("type → blur → erase → blur while the first save is pending → Done: displayed == persisted == \"\"", async () => {
    const { server, calls, sync, displayed } = harness();
    sync.type(K, "temporary"); void sync.blur(K, "temporary");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    sync.type(K, ""); void sync.blur(K, "");
    const done = sync.flush();
    calls[0]!.answer({ ok: true });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body.note).toBe("");
    calls[1]!.answer({ ok: true });
    expect(await done).toEqual({ ok: true });
    expect(displayed()).toBe("");
    expect(server.note).toBe("");
    expect(sync.get().saved.notes[K]).toBe("");
  });

  it("type → blur → erase (Submit tapped, no second blur) while the first save is pending: displayed == persisted == \"\"", async () => {
    const { server, calls, sync, displayed } = harness();
    sync.type(K, "temporary"); void sync.blur(K, "temporary");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    sync.type(K, "");
    const submit = sync.flush();
    calls[0]!.answer({ ok: true });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body.note).toBe("");
    calls[1]!.answer({ ok: true });
    expect(await submit).toEqual({ ok: true });
    expect(displayed()).toBe("");
    expect(server.note).toBe("");
  });

  it("a failed clear refuses Done / Submit (never ok while displayed ≠ persisted); a later flush resends it", async () => {
    const { server, calls, sync, displayed } = harness();
    sync.type(K, "temporary"); void sync.blur(K, "temporary");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    sync.type(K, "");
    const first = sync.flush();
    calls[0]!.answer({ ok: true });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    calls[1]!.answer({ ok: false, code: "copy_done" });
    expect((await first).ok).toBe(false);
    expect(displayed()).toBe("");
    expect(server.note).toBe("temporary");
    const second = sync.flush();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2]!.body.note).toBe("");
    calls[2]!.answer({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(server.note).toBe("");
  });

  it("a note typed while the flush is waiting is flushed too (it loops until drafts equal the acknowledged values)", async () => {
    const { server, calls, sync } = harness();
    sync.type(K, "one"); void sync.blur(K, "one");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const done = sync.flush();
    sync.type(K, "two");
    calls[0]!.answer({ ok: true });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.body.note).toBe("two");
    calls[1]!.answer({ ok: true });
    expect(await done).toEqual({ ok: true });
    expect(server.note).toBe("two");
  });

  it("the form routes typing, blur, Done and Submit through the ONE sync; the refusal is named in en + es", () => {
    const src = readFileSync("components/pm-report-v2/PmCopyForm.tsx", "utf8");
    expect(src).toMatch(/createCopySync[<(]/);
    expect(src).toContain("sync.flush()");
    expect(src.match(/await store\.settleSaves\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/dirtyNoteKeys\(/); // the one-shot pre-settle sweep is gone
    expect(en["pmv2.error.unsaved"]).toBeTruthy();
    expect(es["pmv2.error.unsaved"]).toBeTruthy();
    expect(es["pmv2.error.unsaved"]).not.toBe(en["pmv2.error.unsaved"]);
  });
});
