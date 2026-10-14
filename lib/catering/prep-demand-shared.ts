/**
 * Prep Demand — PURE quote-line → demand resolution (no I/O, client-safe, unit-testable).
 * `lib/catering/prep-demand.ts` loads the rows and calls `resolveDemandFromLines`.
 *
 * ONE RULE SET — EVERY PACKAGE LINE SAYS WHAT IT IS (B7c, migration 0251, Juan 2026-10-14).
 * A line is read by its `line_kind`; no price, description or position heuristic decides what a
 * line is:
 *   · a referenced line (item or menu item) counts at its own Qty — à la carte lines and
 *     package_component lines alike;
 *   · package_header — `components_listed = true`: expands ONLY the package's choice slots (the
 *     listed components count themselves), even when every listed component was removed.
 *     `false`/NULL: the whole package (the portal's line). A slot with the customer's stored
 *     picks expands to those picks;
 *   · package_pick — display only while the quote has a package_header of that package (the
 *     header reserves the slot exactly once). With NO header of the package left on the quote it
 *     counts its own Qty as "needs a pick", so deleting a header never silently zeroes visible
 *     pick lines.
 *
 * NO LEGACY RULES. The write paths refuse a package line without a kind (409
 * `quote_lines_outdated`), migration 0252 refuses one in SQL (CHECK
 * `catering_quote_items_package_line_has_kind`, applied after the deploy — until then only the
 * pre-B7c server in the deploy window can write one), and production had no package quote lines
 * when the kinds landed. So a
 * bare package line with NO kind is never guessed at: it counts NOTHING, and
 * `unkindedPackageLineIds` names it so the loader can warn (ids only). Counting nothing is the
 * least surprising answer for a row the database says cannot exist: guessing was the source of
 * three review rounds of over-counting, and throwing would block confirming the lead.
 *
 * Totals are untouched by any of this: demand is read from the lines; price never moves.
 */
import type { Portion } from "@/lib/catering/pricing-derivation";

export const QUOTE_LINE_KINDS = ["package_header", "package_component", "package_pick"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];
export function isQuoteLineKind(v: unknown): v is QuoteLineKind {
  return typeof v === "string" && (QUOTE_LINE_KINDS as readonly string[]).includes(v);
}

/**
 * The line-kind CHECKs on catering_quote_items, mirrored in TypeScript (Postgres CHECK
 * semantics: a NULL result passes). `after: "0251"` = the expand half only (a NULL-kind package
 * line still passes — the old server's rows in the deploy window); `after: "0252"` adds the
 * contract CHECK (every package line carries its kind). Pinned against both migration texts by
 * tests/catering-quote-line-kind.test.ts so the two cannot drift.
 */
export function quoteLineRowAllowed(r: {
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  lineKind: string | null;
  componentsListed: boolean | null;
}, after: "0251" | "0252" = "0252"): boolean {
  const hasRef = r.itemId != null || r.menuItemId != null;
  // 0251 line_kind_check: line_kind in (...) — NULL passes.
  if (r.lineKind != null && !isQuoteLineKind(r.lineKind)) return false;
  // 0252 package_line_has_kind: package_id is null or line_kind is not null.
  if (after === "0252" && r.packageId != null && r.lineKind == null) return false;
  // line_kind_shape.
  if (r.lineKind != null) {
    if (r.packageId == null) return false;
    if (r.lineKind === "package_component" ? !hasRef : hasRef) return false;
  }
  // components_listed_header_only: components_listed is null or coalesce(line_kind = 'package_header', false).
  if (r.componentsListed != null && r.lineKind !== "package_header") return false;
  return true;
}

export interface DemandQuoteLine {
  id: string;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  quantity: number;
  portion: Portion | null;
  description: string | null;
  lineKind: QuoteLineKind | null;
  componentsListed: boolean | null;
}
export interface DemandPackageComp {
  id: string;
  packageId: string;
  slotType: string;
  itemId: string | null;
  menuItemId: string | null;
  quantity: number;
  description: string | null;
  displayOrder: number;
}
export interface DemandPick {
  quoteItemId: string;
  packageItemId: string;
  itemId: string | null;
  menuItemId: string | null;
  quantity: number;
}
/** A resolved demand row (exactly one of item/menuItem/choice ref set). */
export interface ResolvedDemand {
  itemId: string | null;
  menuItemId: string | null;
  choicePackageItemId: string | null;
  portion: Portion | null;
  qty: number;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
/** The label the builder gave a slot line (lib/catering/menu.ts: description, else "Item"). */
const slotLabel = (c: DemandPackageComp): string => norm(c.description) || "item";

/** True for a line with a package id and no catalog reference (a header or a pick line). */
export function isBarePackageLine(l: Pick<DemandQuoteLine, "packageId" | "itemId" | "menuItemId">): boolean {
  return l.packageId != null && l.itemId == null && l.menuItemId == null;
}

/** Package lines that carry no kind — a shape 0252 forbids. Ids only (for a warning). */
export function unkindedPackageLineIds(lines: readonly DemandQuoteLine[]): string[] {
  return lines.filter((l) => l.packageId != null && l.lineKind == null).map((l) => l.id);
}

export function resolveDemandFromLines(input: {
  lines: readonly DemandQuoteLine[];
  comps: readonly DemandPackageComp[];
  picks: readonly DemandPick[];
}): ResolvedDemand[] {
  const out: ResolvedDemand[] = [];
  const { lines } = input;

  const compsByPackage = new Map<string, DemandPackageComp[]>();
  for (const c of [...input.comps].sort((a, b) => a.displayOrder - b.displayOrder)) {
    const arr = compsByPackage.get(c.packageId) ?? [];
    arr.push(c);
    compsByPackage.set(c.packageId, arr);
  }
  const choiceSlots = (pkgId: string) => (compsByPackage.get(pkgId) ?? []).filter((c) => c.slotType === "choice");
  const picksBySlot = new Map<string, DemandPick[]>();
  for (const p of input.picks) {
    const key = `${p.quoteItemId}:${p.packageItemId}`;
    const arr = picksBySlot.get(key) ?? [];
    arr.push(p);
    picksBySlot.set(key, arr);
  }

  const pushPositive = (d: ResolvedDemand) => { if (d.qty > 0) out.push(d); };
  /** The choice slot a pick line stands for: by its label, else the package's first slot. */
  const slotFor = (pkgId: string, description: string | null): DemandPackageComp | null => {
    const slots = choiceSlots(pkgId);
    const d = norm(description);
    return (d && slots.find((s) => slotLabel(s) === d)) || slots[0] || null;
  };
  /** Expand one header line. `fixed` = expand the package's fixed components too. */
  const expandHeader = (h: DemandQuoteLine, fixed: boolean) => {
    for (const c of compsByPackage.get(h.packageId!) ?? []) {
      if (c.slotType === "choice") {
        const picks = picksBySlot.get(`${h.id}:${c.id}`);
        if (picks && picks.length > 0) {
          for (const p of picks) pushPositive({ itemId: p.itemId, menuItemId: p.menuItemId, choicePackageItemId: null, portion: null, qty: h.quantity * p.quantity });
        } else {
          pushPositive({ itemId: null, menuItemId: null, choicePackageItemId: c.id, portion: null, qty: h.quantity * c.quantity });
        }
      } else if (fixed) {
        if (c.menuItemId) pushPositive({ itemId: null, menuItemId: c.menuItemId, choicePackageItemId: null, portion: null, qty: h.quantity * c.quantity });
        else if (c.itemId) pushPositive({ itemId: c.itemId, menuItemId: null, choicePackageItemId: null, portion: null, qty: h.quantity * c.quantity });
      }
    }
  };

  // 1. Every referenced line counts at its own Qty (à la carte lines and package components).
  for (const l of lines) {
    if (l.itemId) pushPositive({ itemId: l.itemId, menuItemId: null, choicePackageItemId: null, portion: l.portion, qty: l.quantity });
    else if (l.menuItemId) pushPositive({ itemId: null, menuItemId: l.menuItemId, choicePackageItemId: null, portion: l.portion, qty: l.quantity });
  }

  // 2. Headers and pick lines, by kind. A bare package line with no kind counts nothing.
  const headerPackages = new Set(
    lines.filter((l) => l.lineKind === "package_header" && l.packageId).map((l) => l.packageId!),
  );
  for (const l of lines) {
    if (!l.packageId || !isBarePackageLine(l)) continue;
    if (l.lineKind === "package_header") {
      expandHeader(l, l.componentsListed !== true);
    } else if (l.lineKind === "package_pick" && !headerPackages.has(l.packageId)) {
      const slot = slotFor(l.packageId, l.description);
      if (slot) pushPositive({ itemId: null, menuItemId: null, choicePackageItemId: slot.id, portion: null, qty: l.quantity });
    }
  }
  return out;
}
