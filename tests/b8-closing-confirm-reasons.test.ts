import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// B8 #11 (sim walk 2026-10-14): after a manager confirmed a closing with incomplete items the
// page said "Closing submitted with incomplete items · <time> by you" with no reasons under it.
// The reasons list exists (2026-09-09 guide-walk fix) but is fed only by the server load, which
// runs only when the page OPENS on a confirmed closing. A confirm made on the page now lists the
// reasons the closer just gave.

const src = readFileSync("app/(authed)/operations/closing/closing-client.tsx", "utf8");

describe("B8 #11 confirm-here shows the reasons", () => {
  it("the list renders the server record, else the reasons just given", () => {
    expect(src).toContain("const shownReasons = incompleteReasons.length > 0 ? incompleteReasons : confirmedReasons;");
    expect(src).toContain("{readOnly && shownReasons.length > 0 ? (");
    expect(src).toContain("{shownReasons.map((r) => {");
  });
  it("an incomplete confirm captures the submitted reasons (same drafts the PIN modal sent)", () => {
    const confirmed = src.slice(src.indexOf("const handlePinConfirmed"), src.indexOf("const handlePinError"));
    expect(confirmed).toContain('incompleteRequiredIds.map((id) => ({ templateItemId: id, reason: (reasonDrafts.get(id) ?? "").trim(), byName: who }))');
    expect(confirmed).toContain("[t, incompleteRequiredIds, reasonDrafts]");
    expect(src).toContain('reason: (reasonDrafts.get(id) ?? "").trim(),\n          }))}\n          onConfirmed={handlePinConfirmed}');
  });
});
