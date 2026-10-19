import { describe, expect, it } from "vitest";
import { carriedCompletedAt } from "@/lib/checklist-rows";

// B8 #13 (sim walk 2026-10-14): saving a note on a ticked closing line re-stamped its tick
// time (3:20 → 3:22). A note save is an append-only re-completion (supersede-then-insert under
// 0196's one-live-head law, unchanged); the new head now carries the prior head's completed_at
// when only the note changed and the same person saves it. No migration: completed_at already
// accepts an explicit value and no RLS qual or trigger reads it.

const TICK = "2026-10-14T19:20:00.000Z";
const prior = (over: Record<string, unknown> = {}) => ({ id: "old", completed_by: "kh", completed_at: TICK, count_value: null, photo_id: null, actual_completer_id: null, ...over });

describe("B8 #13 the carry rule", () => {
  const next = { actorId: "kh", countValue: null, photoId: null, inputType: null } as const;
  it("a notes-only re-save by the same person keeps the tick time", () => {
    expect(carriedCompletedAt(prior(), next)).toBe(TICK);
    expect(carriedCompletedAt(prior({ count_value: "3" }), { ...next, countValue: 3 })).toBe(TICK);
  });
  it("another person, a new count/answer or a new photo is a real re-completion", () => {
    expect(carriedCompletedAt(prior({ completed_by: "gm" }), next)).toBeNull();
    expect(carriedCompletedAt(prior({ count_value: 1 }), { ...next, countValue: 0 })).toBeNull();
    expect(carriedCompletedAt(prior(), { ...next, photoId: "p" })).toBeNull();
    expect(carriedCompletedAt(null, next)).toBeNull();
  });
  it("r2: on a free_text line the notes ARE the answer — a fresh time, never carried", () => {
    expect(carriedCompletedAt(prior(), { ...next, inputType: "free_text" })).toBeNull();
    expect(carriedCompletedAt(prior({ count_value: 1 }), { ...next, countValue: 1, inputType: "yes_no" })).toBe(TICK);
  });
  it("r2: a peer-tagged head is not carried (the re-save does not copy the tag; keep today's fresh time)", () => {
    expect(carriedCompletedAt(prior({ actual_completer_id: "trainee" }), next)).toBeNull();
  });
});

// R7: SQL now owns the carry rule at statement time. The 0276 harness
// executes notes-only preservation and the service-writer tests pin RPC payloads.
