/**
 * D-17 (Juan 2026-10-13) — the closing checklist's amber AM-prep note shows only from 6 PM ET
 * on the closing's business day; before that it stays hidden.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AM_PREP_GAP_NOTE_FROM_ET, amPrepGapNoteDue } from "@/lib/am-prep-gap-shared";
import { etReachedClockOn } from "@/lib/operational-day";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("etReachedClockOn", () => {
  it("summer (EDT −4): 17:59 ET is before 18:00, 18:00 ET is on it", () => {
    expect(etReachedClockOn("2026-07-10T21:59:00Z", "2026-07-10", "18:00")).toBe(false);
    expect(etReachedClockOn("2026-07-10T22:00:00Z", "2026-07-10", "18:00")).toBe(true);
  });

  it("winter (EST −5): the same wall clock is an hour later in UTC", () => {
    expect(etReachedClockOn("2026-01-14T22:30:00Z", "2026-01-14", "18:00")).toBe(false); // 17:30 EST
    expect(etReachedClockOn("2026-01-14T23:00:00Z", "2026-01-14", "18:00")).toBe(true); // 18:00 EST
  });

  it("late evening ET is still the same business day even though UTC has rolled over", () => {
    // 01:45Z on the 11th = 21:45 EDT on the 10th.
    expect(etReachedClockOn("2026-07-11T01:45:00Z", "2026-07-10", "18:00")).toBe(true);
  });

  it("a past business day has reached any time; a future one has reached none", () => {
    expect(etReachedClockOn("2026-07-11T14:00:00Z", "2026-07-10", "18:00")).toBe(true);
    expect(etReachedClockOn("2026-07-09T23:59:00Z", "2026-07-10", "00:00")).toBe(false);
  });

  it("refuses a malformed date or time", () => {
    expect(() => etReachedClockOn("2026-07-10T22:00:00Z", "2026-7-10", "18:00")).toThrow();
    expect(() => etReachedClockOn("2026-07-10T22:00:00Z", "2026-07-10", "6 PM")).toThrow();
  });
});

describe("amPrepGapNoteDue — the amber note's 6 PM rule", () => {
  it("the note starts at 6 PM ET", () => {
    expect(AM_PREP_GAP_NOTE_FROM_ET).toBe("18:00");
  });

  it("hidden during the day, shown from 6 PM ET, still shown late at night", () => {
    expect(amPrepGapNoteDue("2026-10-13T14:00:00Z", "2026-10-13")).toBe(false); // 10:00 EDT
    expect(amPrepGapNoteDue("2026-10-13T21:59:59Z", "2026-10-13")).toBe(false); // 17:59 EDT
    expect(amPrepGapNoteDue("2026-10-13T22:00:00Z", "2026-10-13")).toBe(true); // 18:00 EDT
    expect(amPrepGapNoteDue("2026-10-14T03:30:00Z", "2026-10-13")).toBe(true); // 23:30 EDT
  });

  it("after midnight a new business day starts and the note waits for its own 6 PM", () => {
    // 00:30 EDT on the 14th, viewing the 14th's closing.
    expect(amPrepGapNoteDue("2026-10-14T04:30:00Z", "2026-10-14")).toBe(false);
  });
});

describe("the closing page gates the note on the rule", () => {
  it("amPrepGap is computed only when amPrepGapNoteDue says so, for the closing's own date", () => {
    const page = read("app", "(authed)", "operations", "closing", "page.tsx");
    expect(page).toContain("if (!isHistorical && amPrepGapNoteDue(new Date().toISOString(), targetDate)) {");
    // The client still renders the note only from that flag.
    const client = read("app", "(authed)", "operations", "closing", "closing-client.tsx");
    expect(client).toContain("{!readOnly && amPrepGap ? (");
  });
});
