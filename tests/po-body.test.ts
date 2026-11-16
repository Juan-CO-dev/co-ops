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

// W19/B190: what goes to the vendor (Copy, mailto, the draft card) is English whatever the staff language,
// exactly like the automatic email (lib/po-email.ts). Only the on-screen chrome follows the viewer.
describe("vendorT — the vendor-facing translator", () => {
  it("renders the body in English whatever the staff language", async () => {
    const { vendorT } = await import("@/lib/po-body");
    const text = renderPoBodyText({ displayCode: "EM-0916-PFG", shopLabel: "EM · P Street", dateLabel: "Sep 16", lines: [line("Eggs", 3, null, null)] }, vendorT);
    expect(text.startsWith("PO EM-0916-PFG\nOrder for EM · P Street · Sep 16")).toBe(true);
    expect(text).not.toContain("OC ");
    expect(text).not.toContain("Pedido");
  });

  it("the panel, the draft card and the email all use it; the vendor date label is formatted in English", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (p: string) => readFileSync(p, "utf8");
    const panel = read("components/ordering/PoPanel.tsx");
    const walker = read("components/ordering/ParPassWalker.tsx");
    const email = read("lib/po-email.ts");
    const page = read("app/ordering/page.tsx");
    expect(panel).toMatch(/renderPoBodyText\(\{[\s\S]*?\}, vendorT\)/);
    expect(panel).toContain('vendorT("ordering.email.subject"');
    expect(panel).not.toMatch(/\bt\("ordering\.email\./);
    expect(walker).not.toMatch(/\bt\("ordering\.email\./);
    expect(walker).toContain('vendorT("ordering.email.subject"');
    expect(email).toMatch(/import \{[^}]*\bvendorT\b[^}]*\} from "@\/lib\/po-body"/);
    expect(page).toContain('formatDateLabel(walker.walkDate, "en")');
    expect(page).toMatch(/vendorDateLabel=\{vendorDateLabel\}/);
  });
});
