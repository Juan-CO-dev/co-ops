import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// B8 #2 (sim walk 2026-10-14): the catering lead "Edit details" form lives inside a
// ~15rem pipeline stage column. A VIEWPORT breakpoint (`sm:grid-cols-2`) split it in two
// at tablet width, so labels wrapped, names clipped ("Jordan Samp") and dates showed
// "10/23/20". The form stacks at every width; inputs keep the 44px floor and may shrink.

const src = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");

function editForm(): string {
  const start = src.indexOf("function EditLeadDetails(");
  const end = src.indexOf("// ── Add-lead form", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("B8 #2 lead edit form fits the pipeline column", () => {
  it("never splits into viewport columns", () => {
    const form = editForm();
    expect(form).toContain('<div className="grid grid-cols-1 gap-3">');
    expect(form).not.toMatch(/sm:grid-cols-2|sm:col-span-2/);
  });
  it("its actions wrap rather than overflow", () => {
    expect(editForm()).toContain('<div className="flex flex-wrap gap-2">');
  });
  it("Field inputs keep the 44px floor and can shrink inside the column", () => {
    const field = src.slice(src.indexOf("function Field("));
    expect(field).toContain('<label className="block min-w-0 text-sm">');
    expect(field).toMatch(/className="mt-1 min-h-\[44px\] w-full min-w-0 /);
  });
});
