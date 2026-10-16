/**
 * Scheduling Phase 1 — Astra's chunk F review (2026-10-16): 4 P2 + 1 P3, each pinned here first.
 *
 *  1. PmCopyForm: a saved note can be CLEARED (the saved baseline moves with every successful save), and a draft
 *     survives a collapse (drafts live in the form, and a person card holding unsaved work stays locked open, D10).
 *  2. PmCopyForm: autosaves are SERIALIZED per copy, in order — the latest wins, an answer superseded while queued
 *     is never sent, an older in-flight result is ignored — and Done / Submit await every pending save and refuse
 *     (en + es message) when one failed.
 *  3. SkillsSection: Adjust and Starting rating are tracked as SEPARATE dirty editors, aggregated per position —
 *     incrementing one and returning the other to its start keeps the position dirty.
 *  4. PmCriteriaEditor: a canceled step-up is its own outcome — the Add form keeps both language fields.
 *  5. (P3) PmDayResults' Copies tab: Spanish criterion and position labels are carried and rendered in es.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import {
  applyNoteResult, applyGradeResult, chooseGrade, createSaveQueue, editNote, initialCopyDrafts, noteNeedsSave,
  notePendingSave, personHasUnsaved, answerKey, noteKey, queueNote, type CopyDrafts,
} from "@/lib/pm-copy-drafts-shared";
import { dirtyUnder, editorKey, withDirty } from "@/lib/disclosure-lock-shared";
import { addFormAfter, criteriaWriteOutcome } from "@/lib/pm-criteria-shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { TranslationProvider } = await import("@/lib/i18n/provider");
const { PmCopyForm } = await import("@/components/pm-report-v2/PmCopyForm");
const { PmDayResults } = await import("@/components/pm-report-v2/PmDayResults");

const render = (node: ReturnType<typeof createElement>, language: "en" | "es" = "en") =>
  renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: language, children: node }));

const EMP = "00000000-0000-4000-8000-000000000006", P = "00000000-0000-4000-8000-000000000021", C1 = "c1", C2 = "c2";
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };

function view(note: string | null = null) {
  return {
    locationId: "loc", date: "2026-10-15", formState: "editable", mvpUserId: null,
    copy: { id: "copy", status: "open", observedFrom: "2026-10-15T18:00:00Z", observedTo: null },
    others: { started: 0, done: 0 }, summary: { people: 1, rated: 0 }, availablePositions: [],
    people: [{ subjectId: EMP, name: "Eli", rated: false, positions: [{
      positionId: P, name: "Expeditor", nameEs: "Expedidor", minutes: 60, added: null, note,
      criteria: [{ id: C1, label: "Ticket accuracy", labelEs: "Precisión de tickets" }, { id: C2, label: "Pace", labelEs: "Ritmo" }],
      answers: [],
    }] }],
  } as never;
}

describe("1. a saved note can be cleared; drafts survive a collapse", () => {
  it("blank → save 'Kept the line moving' → erase → blur: the clear IS sent (the baseline moved)", () => {
    let d: CopyDrafts = initialCopyDrafts(view(null));
    const k = noteKey(EMP, P);
    d = editNote(d, k, "Kept the line moving");
    expect(noteNeedsSave(d, k)).toBe(true);
    const sent = notePendingSave(d, k);
    d = applyNoteResult(d, k, sent, { ok: true, stale: false });
    expect(noteNeedsSave(d, k)).toBe(false);
    d = editNote(d, k, "");
    expect(noteNeedsSave(d, k)).toBe(true); // the old code compared with the ORIGINAL (blank) note and sent nothing
    d = applyNoteResult(d, k, "", { ok: true, stale: false });
    expect(noteNeedsSave(d, k)).toBe(false);
  });

  // Chunk G final round: saves are serialized, so a stale ok that was SENT is what the server holds and moves the
  // acknowledged value; the newer save stays outstanding through its PENDING value (tests/sched-p1-final-fixes).
  it("a stale note result never ends the pending state (a newer save of that note is on its way)", () => {
    const k = noteKey(EMP, P);
    let d = queueNote(editNote(initialCopyDrafts(view("first")), k, "second"), k, "second");
    d = queueNote(editNote(d, k, "third"), k, "third");
    d = applyNoteResult(d, k, "second", { ok: true, stale: true });
    expect(d.pendingNotes[k]).toBe("third");
    expect(personHasUnsaved(d, EMP)).toBe(true);
  });

  it("a person with an unsaved note draft, a pending or a failed save holds unsaved work", () => {
    const base = initialCopyDrafts(view(null));
    expect(personHasUnsaved(base, EMP)).toBe(false);
    expect(personHasUnsaved(editNote(base, noteKey(EMP, P), "x"), EMP)).toBe(true);
    expect(personHasUnsaved(chooseGrade(base, answerKey(EMP, P, C1), "great"), EMP)).toBe(true); // pending until its result
  });

  it("SSR: a card holding an unsaved draft renders OPEN (locked) with the draft and the Unsaved badge; a clean one is collapsed", () => {
    const clean = render(createElement(PmCopyForm, { view: view(null) }));
    expect(clean).not.toContain("<textarea");
    const dirty = render(createElement(PmCopyForm, { view: view(null), initialNoteDrafts: { [noteKey(EMP, P)]: "Draft kept across a collapse" } }));
    expect(dirty).toContain("Draft kept across a collapse");
    expect(dirty).toContain(en["pmv2.person.unsaved"]);
    expect(dirty).toContain('aria-expanded="true"');
  });

  it("the form keeps drafts in ONE store above the cards and toggles through the disclosure lock", () => {
    const src = readFileSync("components/pm-report-v2/PmCopyForm.tsx", "utf8");
    expect(src).toContain("toggleDisclosure(");
    expect(src).toContain("disclosureIsOpen(");
    expect(src).not.toMatch(/useState\(position\.note/);
  });
});

describe("2. autosaves are serialized per copy; Done / Submit wait for them", () => {
  it("in order: the second save is not sent until the first finished; Great → Good persists Good", async () => {
    const sent: string[] = [];
    const gates = [deferred<{ ok: true }>(), deferred<{ ok: true }>()];
    const q = createSaveQueue(async (body: { grade: string }) => { sent.push(body.grade); return gates[sent.length - 1]!.promise; });
    const a = q.save("g:emp|p|c1", { grade: "great" });
    const b = q.save("g:emp|p|c2", { grade: "good" });
    await Promise.resolve(); await Promise.resolve();
    expect(sent).toEqual(["great"]);
    gates[0]!.resolve({ ok: true });
    await a;
    await vi.waitFor(() => expect(sent).toEqual(["great", "good"]));
    gates[1]!.resolve({ ok: true });
    expect(await b).toMatchObject({ ok: true, stale: false });
  });

  it("the latest wins: an answer superseded while queued is never sent, and the older in-flight result is stale", async () => {
    const sent: string[] = [];
    const first = deferred<{ ok: true }>();
    const q = createSaveQueue(async (body: { grade: string }) => { sent.push(body.grade); return body.grade === "great" ? first.promise : { ok: true as const }; });
    const great = q.save("g:k", { grade: "great" });
    await vi.waitFor(() => expect(sent).toEqual(["great"])); // Great is in flight before the next taps
    const good = q.save("g:k", { grade: "good" });
    const needs = q.save("g:k", { grade: "needs_work" });
    first.resolve({ ok: true });
    expect(await great).toMatchObject({ ok: true, stale: true });
    expect(await good).toMatchObject({ skipped: true, stale: true });
    expect(await needs).toMatchObject({ ok: true, stale: false });
    expect(sent).toEqual(["great", "needs_work"]);
  });

  it("settle() waits for every pending save — including one queued while waiting — and reports a failure", async () => {
    const gate = deferred<{ ok: false; code: string }>();
    const q = createSaveQueue(async (body: { n: number }) => (body.n === 1 ? gate.promise : { ok: true as const }));
    void q.save("n:a", { n: 1 });
    let settled = false;
    const s = q.settle().then((r) => { settled = true; return r; });
    void q.save("n:b", { n: 2 });
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve({ ok: false, code: "copy_done" });
    expect(await s).toEqual({ ok: false, code: "copy_done" });
    // A later successful save of the SAME key clears that failure.
    await q.save("n:a", { n: 3 });
    expect(await q.settle()).toEqual({ ok: true });
  });

  it("a failed latest grade reverts to the SAVED answer; a stale failure changes nothing", () => {
    let d = initialCopyDrafts(view(null));
    const k = answerKey(EMP, P, C1);
    d = chooseGrade(d, k, "great");
    d = applyGradeResult(d, k, "great", { ok: true, stale: false });
    d = chooseGrade(d, k, "good");
    const stale = applyGradeResult(d, k, "good", { ok: false, stale: true, code: "x" });
    expect(stale.draft.answers[k]).toBe("good");
    d = applyGradeResult(d, k, "good", { ok: false, stale: false, code: "x" });
    expect(d.draft.answers[k]).toBe("great");
    expect(personHasUnsaved(d, EMP)).toBe(true); // the failure keeps the card flagged
  });

  it("Done and Submit settle the queue first and refuse with a clear message (en + es) when a save failed", () => {
    const src = readFileSync("components/pm-report-v2/PmCopyForm.tsx", "utf8");
    expect(src).toContain("settleSaves(");
    expect(src.match(/await store\.settleSaves\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(en["pmv2.error.unsaved"]).toBeTruthy();
    expect(es["pmv2.error.unsaved"]).toBeTruthy();
    expect(es["pmv2.error.unsaved"]).not.toBe(en["pmv2.error.unsaved"]);
    expect(es["pmv2.person.unsaved"]).toBeTruthy();
  });
});

describe("3. Adjust and Starting rating are separate dirty editors, aggregated per position", () => {
  it("increment Adjust, increment Starting rating, return Starting rating to its start: the position stays dirty", () => {
    let s: ReadonlySet<string> = new Set();
    s = withDirty(s, editorKey("P1", "adjust"), true);
    s = withDirty(s, editorKey("P1", "rate"), true);
    s = withDirty(s, editorKey("P1", "rate"), false);
    expect(dirtyUnder(s, "P1")).toBe(true);
    s = withDirty(s, editorKey("P1", "adjust"), false);
    expect(dirtyUnder(s, "P1")).toBe(false);
    expect(dirtyUnder(withDirty(s, editorKey("P10", "adjust"), true), "P1")).toBe(false); // no prefix bleed
  });

  it("SkillsSection reports dirtiness per (position, control)", () => {
    const src = readFileSync("components/people/SkillsSection.tsx", "utf8");
    expect(src).toContain("onDirtyChange(positionId, kind, isDirty)");
    expect(src).toContain("dirtyUnder(");
  });
});

describe("4. a canceled step-up keeps the new criterion's draft", () => {
  it("the outcome names the cancel; the Add form clears ONLY on a save", () => {
    expect(criteriaWriteOutcome("cancelled")).toEqual({ kind: "canceled" });
    expect(criteriaWriteOutcome("ok", { ok: true })).toEqual({ kind: "saved" });
    expect(criteriaWriteOutcome("ok", { ok: false, code: "duplicate_label" })).toEqual({ kind: "error", code: "duplicate_label" });
    const draft = { label: "Greets guests", labelEs: "Saluda" };
    expect(addFormAfter({ kind: "canceled" }, draft)).toEqual(draft);
    expect(addFormAfter({ kind: "error", code: "x" }, draft)).toEqual(draft);
    expect(addFormAfter({ kind: "saved" }, draft)).toEqual({ label: "", labelEs: "" });
  });

  it("the editor routes every write through the outcome", () => {
    const src = readFileSync("components/pm-report-v2/PmCriteriaEditor.tsx", "utf8");
    expect(src).toContain("criteriaWriteOutcome(");
    expect(src).toContain("addFormAfter(");
  });
});

describe("5. (P3) the Copies tab speaks Spanish", () => {
  it("renders the Spanish criterion and position labels in es, the English ones in en", () => {
    const results = {
      reportId: "r", date: "2026-10-15", locationId: "loc", submittedByName: "Alex", submittedAt: "2026-10-16T03:00:00Z",
      copies: [{ copyId: "c", authorName: "Kim", status: "sealed", observedFrom: null, observedTo: null,
        entries: [{ subjectName: "Eli", positionName: "Expeditor", positionNameEs: "Expedidor", criterion: "Ticket accuracy", criterionEs: "Precisión de tickets", grade: "great" }],
        notes: [{ subjectName: "Eli", positionName: "Expeditor", positionNameEs: "Expedidor", text: "nota" }] }],
      people: [],
    } as never;
    const esHtml = render(createElement(PmDayResults, { results, initialTab: "copies" }), "es");
    expect(esHtml).toContain("Precisión de tickets");
    expect(esHtml).toContain("Expedidor");
    expect(esHtml).not.toContain("Ticket accuracy");
    const enHtml = render(createElement(PmDayResults, { results, initialTab: "copies" }), "en");
    expect(enHtml).toContain("Ticket accuracy");
  });

  it("the lib carries both languages into the Copies projection", () => {
    const src = readFileSync("lib/pm-report-v2.ts", "utf8");
    expect(src).toContain("criterionEs:");
    expect(src).toContain("positionNameEs:");
  });
});
