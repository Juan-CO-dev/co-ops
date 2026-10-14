/**
 * B7c — quote line kinds (migration 0251). PURE: resolveDemandFromLines + the 0251 CHECK mirror
 * (lib/catering/prep-demand-shared.ts), resolveQuoteLineKind and expandPackageLines
 * (lib/catering/quotes-shared.ts). No I/O.
 *
 *   Round 2  P2-1 a listed header never re-expands its fixed components · P2-2 price never
 *            decides what a line is · the edited/removed header and pick cases.
 *   Round 3  The legacy (no line_kind) rules are GONE (production had no package quote lines):
 *            a package line without a kind counts nothing and is reported by id; the write path
 *            refuses it as `outdated` (409 quote_lines_outdated); 0251 refuses it in SQL, and the
 *            CHECK mirror is pinned to the migration text (incl. Astra's P3: components_listed on
 *            a NULL-kind line).
 *   TOTALS   144 package × pricing-mode × headcount cases: every line's quantity and price, the
 *            subtotal and the whole charge stack are identical to the parent commit (12e208d3).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  quoteLineRowAllowed,
  resolveDemandFromLines,
  unkindedPackageLineIds,
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

/** A saved line; the price rides along to prove it never decides what a line is. */
type TLine = DemandQuoteLine & { unitPriceCents?: number };
type LineIn = Partial<TLine> & { quantity: number };
let n = 0;
const L = (l: LineIn): TLine => ({
  id: `qi-${++n}`, itemId: null, menuItemId: null, packageId: null, portion: null, unitPriceCents: 0,
  description: null, lineKind: null, componentsListed: null, ...l,
});
/** The builder's lines for a package, as they are saved (kinds included). */
const built = (pkg: ExpandablePackage, headcount = ""): TLine[] =>
  expandPackageLines(pkg, headcount).map((x) => L({
    description: x.description, quantity: Number(x.quantity), unitPriceCents: Math.round(Number(x.unitPrice || "0") * 100),
    itemId: x.itemId, menuItemId: x.menuItemId, packageId: x.packageId, lineKind: x.lineKind, componentsListed: x.componentsListed,
  }));
const quote = (...groups: TLine[][]): TLine[] => groups.flat();

const demand = (lines: TLine[], picks: DemandPick[] = []) => {
  const d = resolveDemandFromLines({ lines, comps: COMPS, picks });
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
  const portal = (packageId: string, quantity: number) =>
    L({ packageId, quantity, unitPriceCents: 1800, description: "Mix", lineKind: "package_header", componentsListed: false });
  it("a portal line expands the whole package, picks as needs-pick", () => {
    expect(demand(quote([portal("pkg-mix", 3)]))).toMatchObject({ chips: 3, picks: 3 });
  });
  it("a portal line with stored picks → concrete subs, no needs-pick", () => {
    const line = portal("pkg-mix", 3);
    expect(demand([line], [{ quoteItemId: line.id, packageItemId: "mix-slot", itemId: null, menuItemId: "m-sub", quantity: 1 }]))
      .toMatchObject({ chips: 3, picks: 0, subs: 3 });
  });
  it("a staff revise of a portal quote (picks not carried) keeps the whole-package header", () => {
    expect(demand(quote([L({ packageId: "pkg-plat", quantity: 2, unitPriceCents: 11500, lineKind: "package_header", componentsListed: false })])))
      .toMatchObject({ picks: 32 });
  });
  it("a free (unpriced) whole-package header still counts — price never decides", () => {
    expect(demand(quote([L({ packageId: "pkg-fix", quantity: 2, lineKind: "package_header", componentsListed: false })]))).toMatchObject({ chips: 2 });
  });
  it("à la carte lines count on their own beside packages", () => {
    const sub = L({ menuItemId: "m-sub", quantity: 4, unitPriceCents: 1000 });
    expect(demand(quote([sub], built(BUILDER.mix!, "2")))).toMatchObject({ subs: 4, chips: 2, picks: 2 });
  });
});

// ── round 3 · no legacy rules ──────────────────────────────────────────────────────────
describe("round 3 · a package line without a kind is never guessed at", () => {
  /** Exactly the three shapes Astra's round 3 broke the legacy rules with — now inert. */
  const bare = (packageId: string, quantity: number, description: string, cents = 0) =>
    L({ packageId, quantity, description, unitPriceCents: cents });

  it("a bare unkinded package line counts NOTHING, whatever its price or description", () => {
    expect(demand(quote([bare("pkg-plat", 1, "16 pc platter", 11500), bare("pkg-plat", 16, "Choose your subs")])))
      .toMatchObject({ picks: 0, chips: 0 });
    expect(demand(quote([bare("pkg-plat", 1, "Party tray"), bare("pkg-plat", 16, "Choose your subs")]))).toMatchObject({ picks: 0 });
  });
  it("an unkinded package line with a reference still counts its own item — that is no guess", () => {
    expect(demand(quote([L({ packageId: "pkg-mix", itemId: "i-chips", quantity: 1 }), bare("pkg-mix", 5, "Mix", 1800)])))
      .toMatchObject({ chips: 1, picks: 0 });
  });
  it("unkinded package lines never cover for kinded ones: a kinded platter beside them is exactly 16", () => {
    expect(demand(quote([bare("pkg-plat", 16, "Choose your subs")], built(BUILDER.platter!)))).toMatchObject({ picks: 16 });
  });
  it("unkindedPackageLineIds names every package line without a kind (ids only) and nothing else", () => {
    const a = bare("pkg-plat", 1, "x");
    const b = L({ packageId: "pkg-mix", itemId: "i-chips", quantity: 1 });
    const ok = built(BUILDER.mix!, "2");
    const plain = L({ menuItemId: "m-sub", quantity: 1 });
    expect(unkindedPackageLineIds([a, ...ok, b, plain])).toEqual([a.id, b.id]);
    expect(unkindedPackageLineIds(built(BUILDER.platter!))).toEqual([]);
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
    for (const bad of [
      { itemId: "i", menuItemId: null, packageId: "p", lineKind: "package_header" },
      { itemId: null, menuItemId: null, packageId: "p", lineKind: "package_component" },
      { itemId: null, menuItemId: null, packageId: null, lineKind: "package_pick" },
      { itemId: null, menuItemId: null, packageId: "p", lineKind: "whole_package" },
    ]) expect(resolveQuoteLineKind(bad)).toMatchObject({ ok: false, reason: "invalid" });
  });
  it("round 3: ANY package line without a kind is refused as outdated — never stamped (Astra P2-1)", () => {
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: "m", packageId: "p" })).toMatchObject({ ok: false, reason: "outdated" });
    expect(resolveQuoteLineKind({ itemId: "i", menuItemId: null, packageId: "p", lineKind: null })).toMatchObject({ ok: false, reason: "outdated" });
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: "p" })).toMatchObject({ ok: false, reason: "outdated" });
  });
  it("a non-package line carries no kind", () => {
    expect(resolveQuoteLineKind({ itemId: "i", menuItemId: null, packageId: null })).toEqual({ ok: true, lineKind: null, componentsListed: null });
    expect(resolveQuoteLineKind({ itemId: null, menuItemId: null, packageId: null })).toEqual({ ok: true, lineKind: null, componentsListed: null });
  });
  it("every line the builder emits passes the gate AND the 0251 CHECKs", () => {
    for (const pkg of Object.values(BUILDER)) {
      for (const l of expandPackageLines(pkg, "12")) {
        const k = resolveQuoteLineKind(l);
        expect(k.ok).toBe(true);
        if (k.ok) expect(quoteLineRowAllowed({ ...l, lineKind: k.lineKind, componentsListed: k.componentsListed })).toBe(true);
      }
    }
  });
});

// ── the 0251 CHECKs, mirrored and pinned ───────────────────────────────────────────────
describe("0251 · the CHECK mirror (quoteLineRowAllowed) and the migration text", () => {
  const sql = readFileSync("supabase/migrations/0251_catering_quote_line_kind.sql", "utf8").replace(/\r\n/g, "\n");
  const squash = (x: string) => x.replace(/\s+/g, " ");
  const row = (r: Partial<Parameters<typeof quoteLineRowAllowed>[0]>) =>
    quoteLineRowAllowed({ itemId: null, menuItemId: null, packageId: null, lineKind: null, componentsListed: null, ...r });

  it("the migration carries the three CHECKs, the manifest ASSERT and stays one unapplied transaction", () => {
    const flat = squash(sql);
    expect(flat).toContain("check (line_kind in ('package_header', 'package_component', 'package_pick'))");
    expect(flat).toContain("add constraint catering_quote_items_package_line_has_kind check ( package_id is null or line_kind is not null )");
    expect(flat).toContain("add constraint catering_quote_items_components_listed_header_only check ( components_listed is null or coalesce(line_kind = 'package_header', false) )");
    expect(flat).toContain("(line_kind = 'package_header' and package_id is not null and item_id is null and menu_item_id is null)");
    expect(flat).toContain("(line_kind = 'package_component' and package_id is not null and (item_id is not null or menu_item_id is not null))");
    expect(flat).toContain("(line_kind = 'package_pick' and package_id is not null and item_id is null and menu_item_id is null)");
    // The ASSERT runs after the columns exist and BEFORE the constraints go on; it refuses blind runs.
    const assertAt = sql.indexOf("assert n = 0");
    expect(assertAt).toBeGreaterThan(sql.indexOf("add column components_listed boolean null"));
    expect(assertAt).toBeLessThan(sql.indexOf("add constraint catering_quote_items_package_line_has_kind"));
    expect(sql).toContain("where package_id is not null and line_kind is null");
    expect(sql).toContain("plpgsql.check_asserts");
    expect(sql).toContain("-- AUTHORED 2026-10-14, NOT YET APPLIED — GATE CC: sim first, then prod.");
    expect(sql).toContain("\nbegin;\n");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    expect(sql).not.toMatch(/^\s*(grant|revoke|update|delete)\b/im); // no grant change, no data write
  });

  it("every package line needs its kind; a non-package line needs none", () => {
    expect(row({ itemId: "i" })).toBe(true);
    expect(row({ packageId: "p" })).toBe(false);
    expect(row({ packageId: "p", itemId: "i" })).toBe(false);
  });
  it("each kind's shape", () => {
    expect(row({ packageId: "p", lineKind: "package_header" })).toBe(true);
    expect(row({ packageId: "p", lineKind: "package_pick" })).toBe(true);
    expect(row({ packageId: "p", itemId: "i", lineKind: "package_component" })).toBe(true);
    expect(row({ packageId: "p", menuItemId: "m", lineKind: "package_component" })).toBe(true);
    expect(row({ packageId: "p", itemId: "i", lineKind: "package_header" })).toBe(false);
    expect(row({ packageId: "p", menuItemId: "m", lineKind: "package_pick" })).toBe(false);
    expect(row({ packageId: "p", lineKind: "package_component" })).toBe(false);
    expect(row({ lineKind: "package_header" })).toBe(false);
    expect(row({ packageId: "p", lineKind: "whole_package" })).toBe(false);
  });
  it("P3: components_listed is a header-only field — a NULL-kind line may not carry it", () => {
    expect(row({ packageId: "p", lineKind: "package_header", componentsListed: true })).toBe(true);
    expect(row({ packageId: "p", lineKind: "package_header", componentsListed: false })).toBe(true);
    expect(row({ itemId: "i", componentsListed: true })).toBe(false); // the P3 case: NULL kind + true
    expect(row({ componentsListed: false })).toBe(false);
    expect(row({ packageId: "p", lineKind: "package_pick", componentsListed: true })).toBe(false);
    expect(row({ packageId: "p", itemId: "i", lineKind: "package_component", componentsListed: false })).toBe(false);
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
