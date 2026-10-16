/**
 * Scheduling Phase 2, Task 14 — the persisted shapes, TS side: validScheduleSegments and validGapCertificateShape run
 * the SAME case files as 0275's valid_schedule_segments / valid_gap_certificate (scripts/sql-harness-0275.mjs), and
 * everything the generator actually emits (all 27 goldens) has the shape SQL will accept.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validGapCertificateShape, validScheduleSegments } from "@/lib/scheduling/shapes-shared";
import type { DeclaredGap, Shift } from "@/lib/scheduling/rules-shared";

const DIR = path.resolve(__dirname, "fixtures/schedule");
const segmentCases = JSON.parse(readFileSync(path.join(DIR, "segment-cases.json"), "utf8")).cases as Array<{ name: string; startQ: number; endQ: number; segments: unknown; valid: boolean }>;
const certificateCases = JSON.parse(readFileSync(path.join(DIR, "certificate-cases.json"), "utf8")).cases as Array<{ name: string; cause: string; certificate: unknown; valid: boolean }>;
const goldens = readdirSync(DIR).filter((f) => f.startsWith("golden-")).map((f) => ({ f, j: JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as { shifts: Shift[]; gaps: DeclaredGap[] } }));

describe("the shared shape case files, TS side", () => {
  it.each(segmentCases)("segments: $name → $valid", (c) => {
    expect(validScheduleSegments(c.segments, c.startQ, c.endQ)).toBe(c.valid);
  });

  it.each(certificateCases)("certificate: $name → $valid", (c) => {
    expect(validGapCertificateShape(c.cause, c.certificate)).toBe(c.valid);
  });

  it("the case files exercise both verdicts and every cause", () => {
    expect(segmentCases.filter((c) => c.valid).length).toBeGreaterThan(3);
    expect(segmentCases.filter((c) => !c.valid).length).toBeGreaterThan(10);
    for (const cause of ["budget_limited", "floor_limit", "eligibility", "availability", "capacity", "structure", "unresolved_search"]) {
      expect(certificateCases.some((c) => c.cause === cause && c.valid), cause).toBe(true);
      expect(certificateCases.some((c) => c.cause === cause && !c.valid), cause).toBe(true);
    }
  });
});

describe("what the generator emits has the persisted shape", () => {
  it("every shift's segments and every gap's certificate in all 27 goldens", () => {
    expect(goldens).toHaveLength(27);
    let shifts = 0;
    let gaps = 0;
    for (const { f, j } of goldens) {
      for (const s of j.shifts) { expect(validScheduleSegments(s.segments, s.startQ, s.endQ), `${f} ${s.userId} ${s.date}`).toBe(true); shifts++; }
      for (const g of j.gaps) { expect(validGapCertificateShape(g.cause, g.certificate), `${f} ${g.date} ${g.cause}`).toBe(true); gaps++; }
    }
    expect(shifts).toBeGreaterThan(1000);
    expect(gaps).toBeGreaterThan(50);
  });
});
