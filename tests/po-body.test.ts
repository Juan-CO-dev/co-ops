import { describe, expect, it } from "vitest";
import { renderPoBodyLines, renderPoBodyText, type PoBodyLine } from "@/lib/po-body";

const t = (key: string, vars?: Record<string, string | number>) => {
  const map: Record<string, string> = {
    "ordering.email.body_po": "PO {code}", "ordering.email.body_header": "Order for {shop} · {date}",
    "ordering.email.body_line": "{sku} — {qty} {unit} (#{item})", "ordering.unit_generic": "unit",
    "ordering.body.section": "— {section} —", "ordering.body.not_on_guide": "— Not on the guide —",
  };
  return Object.entries(vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), map[key] ?? key);
};
const line = (name: string, qty: number, position: number | null, section: string | null): PoBodyLine =>
  ({ skuName: name, orderQty: qty, orderUnitLabel: "cs", itemNumber: "1", guidePosition: position, guideSection: section });

describe("renderPoBodyLines", () => {
  it("groups by section in guide order, not-on-guide last, zero-qty lines skipped", () => {
    const out = renderPoBodyLines([line("Zucchini", 1, null, null), line("Arugula", 2, 2001, "Produce"), line("Eggs", 3, 1001, "Dairy"), line("Gone", 0, 1002, "Dairy")], t);
    expect(out).toEqual(["— Dairy —", "Eggs — 3 cs (#1)", "— Produce —", "Arugula — 2 cs (#1)", "— Not on the guide —", "Zucchini — 1 cs (#1)"]);
  });
  it("no header when nothing is on a guide", () => {
    expect(renderPoBodyLines([line("B", 1, null, null), line("A", 1, null, null)], t)).toEqual(["A — 1 cs (#1)", "B — 1 cs (#1)"]);
  });
});

describe("renderPoBodyText", () => {
  it("PO code line, header, blank, then the lines", () => {
    const text = renderPoBodyText({ displayCode: "EM-0916-PFG", shopLabel: "P Street", dateLabel: "Sep 16", lines: [line("Eggs", 3, 1001, "Dairy")] }, t);
    expect(text).toBe("PO EM-0916-PFG\nOrder for P Street · Sep 16\n\n— Dairy —\nEggs — 3 cs (#1)");
  });
});
