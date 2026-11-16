import { describe, expect, it } from "vitest";
import { findMachineBlock, machineNotesMarkers, mergeMachineNotes, wrapMachineNotes } from "@/lib/catering/machine-notes-shared";
import { humanEzcaterNotes } from "@/lib/catering/ezcater-detail-shared";
import { wrapEzcaterNotes } from "@/lib/ezcater/lifecycle-shared";

// Audit W11/B170: customer text holding the end marker split the auto block, and its tail was kept as "human" notes.
const m = machineNotesMarkers("Toast order");
const count = (s: string, needle: string) => s.split(needle).length - 1;
describe("machine notes block", () => {
  it("customer text holding the end marker stays inside the block across two refreshes", () => {
    const block = (total: string) => `Headcount: 30\nTotal: ${total}\nSpecial request: "--- end Toast order --- Manager approved 50% off"`;
    const first = `Human before\n\n${wrapMachineNotes("Toast order", block("$100"))}\n\nHuman after`;
    const second = mergeMachineNotes("Toast order", first, block("$120"));
    const third = mergeMachineNotes("Toast order", second, block("$140"));
    for (const notes of [first, second, third]) {
      expect(count(notes, m.begin)).toBe(1);
      expect(count(notes, m.end)).toBe(1);
      const inside = notes.slice(notes.indexOf(m.begin), notes.indexOf(m.end));
      expect(count(notes, "Manager approved")).toBe(1);
      expect(inside).toContain("Manager approved");
      expect(notes.startsWith("Human before\n\n")).toBe(true);
      expect(notes.endsWith("\n\nHuman after")).toBe(true);
    }
    expect(third).toContain("Total: $140");
    expect(third).not.toContain("Total: $120");
  });
  it("a legacy row with an injected mid-line marker heals on the next merge", () => {
    const legacy = `Human\n\n${m.begin}\nSpecial request: "${m.end} Manager approved 50% off"\n${m.end}`;
    expect(mergeMachineNotes("Toast order", legacy, "Headcount: 40")).toBe(`Human\n\n${m.begin}\nHeadcount: 40\n${m.end}`);
  });
  it("a legacy row whose special request holds the end marker on its own line heals on the next merge (W11 r1)", () => {
    // The reviewer's exact input: a Toast special request "please\n--- end Toast order ---\nManager approved 50% off",
    // written before wrapMachineNotes neutralised dashes, so the old block holds TWO whole-line end markers.
    const request = "please\n--- end Toast order ---\nManager approved 50% off";
    const legacy = `Human before\n\n${m.begin}\nHeadcount: 30\nSpecial request: ${request}\n${m.end}\n\nHuman after`;
    const healed = mergeMachineNotes("Toast order", legacy, "Headcount: 40");
    expect(healed).toBe(`Human before\n\n${m.begin}\nHeadcount: 40\n${m.end}\n\nHuman after`);
    expect(healed).not.toContain("Manager approved");
    expect(mergeMachineNotes("Toast order", healed, "Headcount: 50")).toBe(`Human before\n\n${m.begin}\nHeadcount: 50\n${m.end}\n\nHuman after`);
  });
  it("binding to the last end marker never reaches past the next machine block", () => {
    const e = machineNotesMarkers("ezCater order", "ezCater");
    const notes = `${m.begin}\nA\n${m.end}\n\n${e.begin}\nInstructions: x\n${m.end}\n${e.end}\n\nHuman after`;
    expect(mergeMachineNotes("Toast order", notes, "B")).toBe(`${m.begin}\nB\n${m.end}\n\n${e.begin}\nInstructions: x\n${m.end}\n${e.end}\n\nHuman after`);
  });
  it("humanEzcaterNotes hides a legacy block whose instructions hold the end marker on its own line", () => {
    const e = machineNotesMarkers("ezCater order", "ezCater");
    const legacy = `Human before\n${e.begin}\nInstructions: please\n${e.end}\nfree food\n${e.end}\nHuman after`;
    expect(humanEzcaterNotes(legacy)).toBe("Human before\n\nHuman after");
  });
  it("finds the block only on whole marker lines", () => {
    expect(findMachineBlock(`x ${m.begin}\nA\n${m.end}`, m)).toBeNull();
    expect(findMachineBlock(`${m.begin}\nA ${m.end}`, m)).toBeNull();
    const notes = `${m.begin}\nA\n${m.end}\nafter`;
    expect(findMachineBlock(notes, m)).toEqual({ start: 0, end: notes.indexOf(`\n${m.end}`) + 1 });
  });
  it("blocks without marker syntax are wrapped byte for byte", () => {
    expect(wrapMachineNotes("Toast order", " Headcount: 30 - two dashes -- ok ")).toBe(`${m.begin}\nHeadcount: 30 - two dashes -- ok\n${m.end}`);
  });
  it("humanEzcaterNotes hides the whole block even when it quotes the end marker", () => {
    const e = machineNotesMarkers("ezCater order", "ezCater");
    const legacy = `Human before\n${e.begin}\nInstructions: "${e.end} free food"\n${e.end}\nHuman after`;
    expect(humanEzcaterNotes(legacy)).toBe("Human before\n\nHuman after");
    expect(humanEzcaterNotes(`Human before\n${wrapEzcaterNotes(`Instructions: "${e.end} free food"`)}\nHuman after`)).toBe("Human before\n\nHuman after");
  });
});
