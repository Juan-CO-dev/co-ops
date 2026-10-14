/**
 * B7c round 2 — quote line kinds (migration 0251) and Astra's three P2s on 12e208d3.
 * PURE: resolveDemandFromLines (lib/catering/prep-demand-shared.ts), resolveQuoteLineKind and
 * expandPackageLines (lib/catering/quotes-shared.ts). No I/O.
 *
 *   P2-1  Removing the last concrete component restores its demand → a header that lists its
 *         components (components_listed = true) never expands fixed components, even when none remain.
 *   P2-2  A paid header suppresses a legitimate free package → the legacy "unpriced placeholder"
 *         heuristic never applies to a line that carries a line_kind.
 *   P2-3  Legacy quotes still multiply pick demand → a legacy pick placeholder is never also a
 *         header, and its Qty (already the slot count) is never multiplied by the slot again.
 *   TOTALS  144 package × pricing-mode × headcount cases: every line's quantity and price, the
 *           subtotal and the whole charge stack are identical to the parent commit (12e208d3).
 */
import { describe, expect, it } from "vitest";
import {
  resolveDemandFromLines,
  type DemandPackage,
  type DemandPackageComp,
  type DemandPick,
  type DemandQuoteLine,
} from "@/lib/catering/prep-demand-shared";
import {
  computeChargeStack,
  expandPackageLines,
  lineTotalCents,
  packageHeadcountMultiplier,
  resolveQuoteLineKind,
  type ExpandablePackage,
} from "@/lib/catering/quotes-shared";

// ── catalog fixture (shaped like the live catalog: platters/lunches = one choice slot) ─────
const PACKAGES: DemandPackage[] = [
  { id: "pkg-plat", labelEn: "16 pc platter", labelEs: "Bandeja de 16" },
  { id: "pkg-ll", labelEn: "Light Lunch", labelEs: null },
  { id: "pkg-mix", labelEn: "Mix", labelEs: null },
  { id: "pkg-combo", labelEn: "Combo", labelEs: null },
  { id: "pkg-fix", labelEn: "Snack pack", labelEs: null },
];
const comp = (id: string, packageId: string, slotType: string, quantity: number, extra: Partial<DemandPackageComp> = {}): DemandPackageComp => ({
  id, packageId, slotType, itemId: null, menuItemId: null, quantity, description: null, displayOrder: 0, ...extra,
});
const COMPS: DemandPackageComp[] = [
  comp("plat-slot", "pkg-plat", "choice", 16, { description: "Choose your subs" }),
  comp("ll-slot", "pkg-ll", "choice", 1, { description: "Choose your sub" }),
  comp("mix-chips", "pkg-mix", "fixed", 1, { itemId: "i-chips", displayOrder: 0 }),
  comp("mix-slot", "pkg-mix", "choice", 1, { description: "Choose your sub", displayOrder: 1 }),
  comp("combo-chips", "pkg-combo", "fixed", 1, { itemId: "i-chips", displayOrder: 0 }),
  comp("combo-slot", "pkg-combo", "choice", 16, { description: "Choose your subs", displayOrder: 1 }),
  comp("fix-chips", "pkg-fix", "fixed", 1, { itemId: "i-chips" }),
];
/** The builder's ExpandablePackage for each fixture (labels as lib/catering/menu.ts builds them). */
const BUILDER: Record<string, ExpandablePackage> = {
  platter: { id: "pkg-plat", labelEn: "16 pc platter", pricingMode: "per_platter", priceCents: 11500,
    items: [{ itemId: null, menuItemId: null, label: "Choose your subs", quantity: 16, unitPriceCents: 0 }] },
  lightLunch: { id: "pkg-ll", labelEn: "Light Lunch", pricingMode: "per_head", priceCents: 1200,
    items: [{ itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 }] },
  mix: { id: "pkg-mix", labelEn: "Mix", pricingMode: "per_head", priceCents: 1800,
    items: [
      { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 0 },
      { itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 },
    ] },
  mixPriced: { id: "pkg-mix", labelEn: "Mix", pricingMode: "per_head", priceCents: 0,
    items: [
      { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 200 },
      { itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 },
    ] },
  snack: { id: "pkg-fix", labelEn: "Snack pack", pricingMode: "fixed", priceCents: 1500,
    items: [{ itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 0 }] },
};

type LineIn = Partial<DemandQuoteLine> & { quantity: number };
let n = 0;
const L = (l: LineIn): DemandQuoteLine => ({
  id: `qi-${++n}`, itemId: null, menuItemId: null, packageId: null, portion: null, unitPriceCents: 0,
  displayOrder: 0, description: null, lineKind: null, componentsListed: null, ...l,
});
/** The builder's lines for a package, as they are saved (kinds included). */
const built = (pkg: ExpandablePackage, headcount = ""): DemandQuoteLine[] =>
  expandPackageLines(pkg, headcount).map((x) => L({
    description: x.description, quantity: Number(x.quantity), unitPriceCents: Math.round(Number(x.unitPrice || "0") * 100),
    itemId: x.itemId, menuItemId: x.menuItemId, packageId: x.packageId, lineKind: x.lineKind, componentsListed: x.componentsListed,
  }));
/** Number the lines in the order given (display order = position on the quote). */
const quote = (...groups: DemandQuoteLine[][]): DemandQuoteLine[] => groups.flat().map((l, i) => ({ ...l, displayOrder: i }));

const demand = (lines: DemandQuoteLine[], picks: DemandPick[] = []) => {
  const d = resolveDemandFromLines({ lines, comps: COMPS, packages: PACKAGES, picks });
  const sum = (f: (x: (typeof d)[number]) => boolean) => d.filter(f).reduce((s, x) => s + x.qty, 0);
  return {
    chips: sum((x) => x.itemId === "i-chips"),
    picks: sum((x) => x.choicePackageItemId != null),
    subs: sum((x) => x.menuItemId === "m-sub"),
    rows: d,
  };
};

// ── new builder quotes ─────────────────────────────────────────────────────────────────
describe("new builder quotes (every package line carries a kind)", () => {
  it("Light Lunch for 20 reserves 20 picks; a 16 pc platter reserves 16; two platters 32", () => {
    expect(demand(quote(built(BUILDER.lightLunch!, "20")))).toMatchObject({ picks: 20, chips: 0 });
    expect(demand(quote(built(BUILDER.platter!)))).toMatchObject({ picks: 16 });
    expect(demand(quote(built(BUILDER.platter!), built(BUILDER.platter!)))).toMatchObject({ picks: 32 });
  });
  it("a mixed package (unpriced or priced components) counts its chips once and its picks once", () => {
    expect(demand(quote(built(BUILDER.mix!, "10")))).toMatchObject({ chips: 10, picks: 10 });
    expect(demand(quote(built(BUILDER.mixPriced!, "10")))).toMatchObject({ chips: 10, picks: 10 });
  });
  it("a whole-priced package with only fixed components: the header expands nothing, the components count", () => {
    expect(demand(quote(built(BUILDER.snack!)))).toMatchObject({ chips: 1, picks: 0 });
  });
  it("every pick row names its slot (the Prep Demand surface groups by it)", () => {
    const { rows } = demand(quote(built(BUILDER.platter!)));
    expect(rows).toEqual([{ itemId: null, menuItemId: null, choicePackageItemId: "plat-slot", portion: null, qty: 16 }]);
  });
});

// ── P2-1 ───────────────────────────────────────────────────────────────────────────────
describe("P2-1 · removing the last concrete component does NOT restore its demand", () => {
  it("one chips component + one pick slot; delete the chips line, keep the header → 0 chips, 1 pick", () => {
    const lines = built(BUILDER.mix!); // [header (listed), chips, pick]
    expect(demand(quote(lines))).toMatchObject({ chips: 1, picks: 1 });
    expect(demand(quote(lines.filter((l) => l.itemId !== "i-chips")))).toMatchObject({ chips: 0, picks: 1 });
  });
  it("a fixed-only package with its only component deleted reserves nothing more (no silent re-expansion)", () => {
    const lines = built(BUILDER.snack!);
    expect(demand(quote(lines.filter((l) => l.lineKind === "package_header")))).toMatchObject({ chips: 0, picks: 0 });
  });
  it("editing a component's Qty moves its demand; the header never adds the fixed component back", () => {
    const lines = built(BUILDER.mix!, "4");
    const chips = lines.find((l) => l.itemId === "i-chips")!;
    expect(demand(quote(lines.map((l) => (l === chips ? { ...l, quantity: 9 } : l))))).toMatchObject({ chips: 9, picks: 4 });
  });
});

// ── P2-2 ───────────────────────────────────────────────────────────────────────────────
describe("P2-2 · a paid header never suppresses a legitimate free package", () => {
  it("two 16-piece platters, second header price zeroed → 32 picks", () => {
    const second = built(BUILDER.platter!).map((l) => (l.lineKind === "package_header" ? { ...l, unitPriceCents: 0 } : l));
    expect(demand(quote(built(BUILDER.platter!), second))).toMatchObject({ picks: 32 });
  });
  it("both headers zeroed, or both comped to $0 everywhere → still 32", () => {
    const free = () => built(BUILDER.platter!).map((l) => ({ ...l, unitPriceCents: 0 }));
    expect(demand(quote(free(), free()))).toMatchObject({ picks: 32 });
  });
  it("a free kinded header beside a paid one of ANOTHER package is not touched", () => {
    const freeLunch = built(BUILDER.lightLunch!, "5").map((l) => ({ ...l, unitPriceCents: 0 }));
    expect(demand(quote(built(BUILDER.platter!), freeLunch))).toMatchObject({ picks: 21 });
  });
});

// ── edited / removed headers and pick slots ────────────────────────────────────────────
describe("edited and removed headers and pick slots — no double count, no silent zero", () => {
  it("removing the header keeps the components counting, and an orphaned pick line counts its own Qty", () => {
    const lines = built(BUILDER.mix!, "6").filter((l) => l.lineKind !== "package_header");
    expect(demand(quote(lines))).toMatchObject({ chips: 6, picks: 6 });
    const platterPicks = built(BUILDER.platter!).filter((l) => l.lineKind === "package_pick");
    expect(demand(quote(platterPicks))).toMatchObject({ picks: 16 });
  });
  it("removing the pick line keeps the header reserving the slot (the line was display only)", () => {
    expect(demand(quote(built(BUILDER.platter!).filter((l) => l.lineKind !== "package_pick")))).toMatchObject({ picks: 16 });
  });
  it("with a header on the quote, a pick line is display only: editing its Qty does not double the slot", () => {
    const lines = built(BUILDER.platter!).map((l) => (l.lineKind === "package_pick" ? { ...l, quantity: 20 } : l));
    expect(demand(quote(lines))).toMatchObject({ picks: 16 });
  });
  it("editing the header's Qty scales the slot (2 platters → 32)", () => {
    const lines = built(BUILDER.platter!).map((l) => (l.lineKind === "package_header" ? { ...l, quantity: 2 } : l));
    expect(demand(quote(lines))).toMatchObject({ picks: 32 });
  });
});

// ── portal lines ───────────────────────────────────────────────────────────────────────
describe("portal lines (package_header, components_listed = false) behave exactly as before", () => {
  const portal = (packageId: string, quantity: number, kinded: boolean) =>
    L({ packageId, quantity, unitPriceCents: 1800, description: "Mix", lineKind: kinded ? "package_header" : null, componentsListed: kinded ? false : null });
  for (const kinded of [true, false]) {
    it(`${kinded ? "kinded" : "legacy"} portal line expands the whole package, picks as needs-pick`, () => {
      expect(demand(quote([portal("pkg-mix", 3, kinded)]))).toMatchObject({ chips: 3, picks: 3 });
    });
    it(`${kinded ? "kinded" : "legacy"} portal line with stored picks → concrete subs, no needs-pick`, () => {
      const line = quote([portal("pkg-mix", 3, kinded)])[0]!;
      expect(demand([line], [{ quoteItemId: line.id, packageItemId: "mix-slot", itemId: null, menuItemId: "m-sub", quantity: 1 }]))
        .toMatchObject({ chips: 3, picks: 0, subs: 3 });
    });
  }
  it("a staff revise of a portal quote (picks not carried) keeps the whole-package header", () => {
    expect(demand(quote([L({ packageId: "pkg-plat", quantity: 2, unitPriceCents: 11500, lineKind: "package_header", componentsListed: false })])))
      .toMatchObject({ picks: 32 });
  });
});

// ── P2-3 · old saved quotes (no kind) ─────────────────────────────────────────────────
describe("P2-3 · old saved quotes resolve with the fixed legacy rules", () => {
  /** A legacy line exactly as the pre-0251 builders wrote it: package id on every line, no kind. */
  const legacy = (l: LineIn) => L({ lineKind: null, componentsListed: null, ...l });
  const oldHeader = (packageId: string, label: string, cents: number, quantity = 1) =>
    legacy({ packageId, description: label, unitPriceCents: cents, quantity });
  const oldPlaceholder = (packageId: string, quantity: number, label = "Choose your subs") =>
    legacy({ packageId, description: label, unitPriceCents: 0, quantity });

  it("composition-priced package: priced chips line + $0 pick placeholder at Qty 16, no header → 1 chip, 16 picks (was 256)", () => {
    expect(demand(quote([
      legacy({ packageId: "pkg-combo", itemId: "i-chips", description: "Chips", unitPriceCents: 200, quantity: 1 }),
      oldPlaceholder("pkg-combo", 16),
    ]))).toMatchObject({ chips: 1, picks: 16 });
  });
  it("zero-priced platter header + its Qty-16 placeholder → 16 picks (was 272)", () => {
    expect(demand(quote([oldHeader("pkg-plat", "16 pc platter", 0), oldPlaceholder("pkg-plat", 16)]))).toMatchObject({ picks: 16 });
  });
  it("priced platter header + placeholder → 16; two old platters → 32; one of them zeroed → still 32", () => {
    const one = () => [oldHeader("pkg-plat", "16 pc platter", 11500), oldPlaceholder("pkg-plat", 16)];
    expect(demand(quote(one()))).toMatchObject({ picks: 16 });
    expect(demand(quote(one(), one()))).toMatchObject({ picks: 32 });
    expect(demand(quote(one(), [oldHeader("pkg-plat", "16 pc platter", 0), oldPlaceholder("pkg-plat", 16)]))).toMatchObject({ picks: 32 });
  });
  it("header with its placeholder deleted reserves the slot; placeholder with its header deleted counts once", () => {
    expect(demand(quote([oldHeader("pkg-plat", "16 pc platter", 11500)]))).toMatchObject({ picks: 16 });
    expect(demand(quote([oldPlaceholder("pkg-plat", 16)]))).toMatchObject({ picks: 16 });
  });
  it("the Spanish package label also reads as a header", () => {
    expect(demand(quote([oldHeader("pkg-plat", "Bandeja de 16", 0), oldPlaceholder("pkg-plat", 16)]))).toMatchObject({ picks: 16 });
  });
  it("retyped descriptions fall back to price: a priced line is the header, a $0 line the placeholder", () => {
    expect(demand(quote([oldHeader("pkg-plat", "Party tray", 11500), oldPlaceholder("pkg-plat", 16, "Subs TBD")]))).toMatchObject({ picks: 16 });
  });
  it("old whole-priced mixed package: header + listed chips + placeholder → chips and picks once", () => {
    expect(demand(quote([
      oldHeader("pkg-mix", "Mix", 1800, 5),
      legacy({ packageId: "pkg-mix", itemId: "i-chips", description: "Chips", quantity: 5 }),
      oldPlaceholder("pkg-mix", 5, "Choose your sub"),
    ]))).toMatchObject({ chips: 5, picks: 5 });
  });
  it("an old free package with no choice slot (unpriced, alone) still counts — never a silent zero", () => {
    expect(demand(quote([oldHeader("pkg-fix", "Snack pack", 0, 2)]))).toMatchObject({ chips: 2 });
  });
  it("an old header with stored picks (portal) wins over a stray placeholder in its run", () => {
    const h = oldHeader("pkg-plat", "16 pc platter", 11500);
    const lines = quote([h, oldPlaceholder("pkg-plat", 16)]);
    expect(demand(lines, [{ quoteItemId: lines[0]!.id, packageItemId: "plat-slot", itemId: null, menuItemId: "m-sub", quantity: 16 }]))
      .toMatchObject({ picks: 0, subs: 16 });
  });
});

// ── mixed old + new ────────────────────────────────────────────────────────────────────
describe("mixed old + new lines on one quote", () => {
  it("a revised legacy platter plus a newly added platter → 32, no double count", () => {
    const old = [L({ packageId: "pkg-plat", description: "16 pc platter", unitPriceCents: 11500, quantity: 1 }), L({ packageId: "pkg-plat", description: "Choose your subs", quantity: 16 })];
    expect(demand(quote(old, built(BUILDER.platter!)))).toMatchObject({ picks: 32 });
  });
  it("legacy and kinded lines of one package never cover for each other (they are separate adds)", () => {
    const legacyPh = L({ packageId: "pkg-plat", description: "Choose your subs", quantity: 16 });
    const kindedHeader = built(BUILDER.platter!).filter((l) => l.lineKind === "package_header");
    expect(demand(quote([legacyPh], kindedHeader))).toMatchObject({ picks: 32 });
  });
  it("à la carte lines count on their own beside packages", () => {
    const sub = L({ menuItemId: "m-sub", quantity: 4, unitPriceCents: 1000 });
    expect(demand(quote([sub], built(BUILDER.mix!, "2")))).toMatchObject({ subs: 4, chips: 2, picks: 2 });
  });
});

// ── the line-kind gate on the write path ───────────────────────────────────────────────
describe("resolveQuoteLineKind — what a saved line stores", () => {
  it("accepts each kind in its own shape; components_listed is kept on a header only", () => {
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: "p", lineKind: "package_header", componentsListed: true }))
      .toEqual({ ok: true, lineKind: "package_header", componentsListed: true });
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: "p", lineKind: "package_header" }))
      .toEqual({ ok: true, lineKind: "package_header", componentsListed: false });
    expect(resolveQuoteLineKind({ itemId: "i", menuItemId: null, packageId: "p", lineKind: "package_component", componentsListed: true }))
      .toEqual({ ok: true, lineKind: "package_component", componentsListed: null });
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: "p", lineKind: "package_pick" }))
      .toEqual({ ok: true, lineKind: "package_pick", componentsListed: null });
  });
  it("refuses a kind that contradicts the line's references (the 0251 CHECKs, as a named 400)", () => {
    expect(resolveQuoteLineKind({ itemId: "i", menuItemId: null, packageId: "p", lineKind: "package_header" }).ok).toBe(false);
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: "p", lineKind: "package_component" }).ok).toBe(false);
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: null, lineKind: "package_pick" }).ok).toBe(false);
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: "p", lineKind: "whole_package" }).ok).toBe(false);
  });
  it("no kind: a referenced package line is stamped a component; anything else stays NULL", () => {
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: "m", packageId: "p" })).toEqual({ ok: true, lineKind: "package_component", componentsListed: null });
    expect(resolveQuoteLineKind({ itemId: "i", menuItemId: null, packageId: null })).toEqual({ ok: true, lineKind: null, componentsListed: null });
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: "p" })).toEqual({ ok: true, lineKind: null, componentsListed: null });
  });
  it("every line the builder emits passes the gate", () => {
    for (const pkg of Object.values(BUILDER)) {
      for (const l of expandPackageLines(pkg, "12")) expect(resolveQuoteLineKind(l).ok).toBe(true);
    }
  });
});

// ── TOTALS · identical to the parent commit (12e208d3) ─────────────────────────────────
/** expandPackageLines exactly as the parent commit shipped it (frozen for the comparison). */
function parentExpandPackageLines(pkg: ExpandablePackage, headcount: string) {
  const n = packageHeadcountMultiplier(pkg.pricingMode, headcount);
  const centsToDollarText = (c: number): string => (c ? (c / 100).toString() : "");
  const scaleQty = (q: number, k: number): string => String(Math.round(q * k * 1000) / 1000);
  const header = (priceCents: number) => ({ description: pkg.labelEn, quantity: String(n), unitPrice: (priceCents / 100).toString(), itemId: null as string | null, menuItemId: null as string | null, packageId: pkg.id as string | null });
  const isPick = (pi: ExpandablePackage["items"][number]) => pi.itemId == null && pi.menuItemId == null;
  const lines = pkg.items.map((pi) => ({ description: pi.label, quantity: scaleQty(pi.quantity, n), unitPrice: centsToDollarText(pi.unitPriceCents), itemId: pi.itemId, menuItemId: pi.menuItemId, packageId: isPick(pi) ? null : pkg.id }));
  if (lines.length === 0) return [header(pkg.priceCents)];
  const pricedAsWhole = pkg.priceCents > 0 && lines.every((l) => l.unitPrice === "");
  if (pricedAsWhole) return [header(pkg.priceCents), ...lines];
  if (pkg.items.some(isPick)) return [header(0), ...lines];
  return lines;
}

describe("TOTALS · 144 package/pricing/headcount cases match the parent commit line for line", () => {
  const shapes: Array<Omit<ExpandablePackage, "pricingMode">> = [
    { id: "s-bare", labelEn: "Bare", priceCents: 900, items: [] },
    { id: "s-ll", labelEn: "Light Lunch", priceCents: 1200, items: [{ itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 }] },
    { id: "s-plat", labelEn: "16 pc platter", priceCents: 11500, items: [{ itemId: null, menuItemId: null, label: "Choose your subs", quantity: 16, unitPriceCents: 0 }] },
    { id: "s-mix", labelEn: "Mix", priceCents: 1800, items: [
      { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 0 },
      { itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 }] },
    { id: "s-box", labelEn: "Boxed", priceCents: 1500, items: [
      { itemId: null, menuItemId: "m-sub", label: "Sub", quantity: 1, unitPriceCents: 1000 },
      { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 0.5, unitPriceCents: 200 }] },
    { id: "s-mixp", labelEn: "Mix priced", priceCents: 0, items: [
      { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 200 },
      { itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 }] },
  ];
  const modes = ["per_head", "per_platter", "fixed"];
  const headcounts = ["", "0", "1", "7", "20", "2.5", "abc", " 12 "];
  const rates = { taxRateBps: 1000, gratuityBps: 1500, serviceChargeBps: 500, depositPctBps: 5000, taxOnDelivery: true, taxOnGratuity: false };
  const cents = (dollars: string) => Math.round(Number(dollars || "0") * 100);
  const cases = shapes.flatMap((s) => modes.flatMap((pricingMode) => headcounts.map((h) => ({ pkg: { ...s, pricingMode }, h }))));

  it("covers 144 cases", () => expect(cases).toHaveLength(144));
  it.each(cases.map((c) => [`${c.pkg.id}/${c.pkg.pricingMode}/"${c.h}"`, c] as const))("%s", (_name, { pkg, h }) => {
    const now = expandPackageLines(pkg, h);
    const before = parentExpandPackageLines(pkg, h);
    // Same lines, same order, same quantity / price / references.
    expect(now.map((l) => [l.description, l.quantity, l.unitPrice, l.itemId, l.menuItemId]))
      .toEqual(before.map((l) => [l.description, l.quantity, l.unitPrice, l.itemId, l.menuItemId]));
    const totals = (ls: Array<{ quantity: string; unitPrice: string }>) => ls.map((l) => lineTotalCents(Number(l.quantity), cents(l.unitPrice)));
    expect(totals(now)).toEqual(totals(before));
    expect(computeChargeStack(totals(now), 1500, rates)).toEqual(computeChargeStack(totals(before), 1500, rates));
  });
});
