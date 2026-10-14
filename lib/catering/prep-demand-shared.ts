/**
 * Prep Demand — PURE quote-line → demand resolution (no I/O, client-safe, unit-testable).
 * `lib/catering/prep-demand.ts` loads the rows and calls `resolveDemandFromLines`.
 *
 * TWO RULE SETS, NEVER MIXED (B7c, migration 0251, Juan 2026-10-14):
 *
 * A. A line that carries a `line_kind` (every package line written from 0251 on) is read by
 *    what it SAYS it is — no price, description or position heuristic ever applies to it:
 *     · package_component — counts at its own Qty (like any referenced line).
 *     · package_header    — `components_listed = true`: expands ONLY the package's choice slots
 *                           (the listed components count themselves), even when every listed
 *                           component was removed. `false`/NULL: the whole package (the portal).
 *                           A slot with the customer's stored picks expands to those picks.
 *     · package_pick      — display only while the quote has a package_header of that package
 *                           (the header reserves the slot exactly once). With NO header of the
 *                           package left on the quote it counts its own Qty as "needs a pick",
 *                           so deleting a header never silently zeroes visible pick lines.
 *
 * B. A line with NO kind and a package id and no reference is a LEGACY line (saved before 0251).
 *    The old staff builder wrote, per "Add package", `[header?] + every composition line`, all
 *    tagged with the package id: the header (description = the package label) only when the
 *    package was priced as a whole or had no composition, then one placeholder per choice slot
 *    (description = the slot label, Qty = the slot's own count, $0). The portal wrote one header
 *    line per package with the picks in catering_quote_item_options. So, per legacy line:
 *     · HEADER when it has stored picks, or its package has no choice slot, or its description
 *       is the package label; a PLACEHOLDER when its description is a choice-slot label;
 *       otherwise priced → header, $0 → placeholder.
 *     · A placeholder counts its OWN Qty as "needs a pick" for its slot — its Qty already is
 *       the slot count, so the slot quantity is never applied a second time. It is never also
 *       a header.
 *     · A header owns the legacy lines that follow it (display order) up to the next header of
 *       the same package: it skips every choice slot one of its placeholders already reserves,
 *       and skips its fixed components when they are listed as their own lines.
 *    Legacy lines and kinded lines of one package never cover for each other: they came from
 *    different "Add package" actions.
 *
 * Totals are untouched by any of this: demand is read from the lines; price never moves.
 */
import type { Portion } from "@/lib/catering/pricing-derivation";

export const QUOTE_LINE_KINDS = ["package_header", "package_component", "package_pick"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];
export function isQuoteLineKind(v: unknown): v is QuoteLineKind {
  return typeof v === "string" && (QUOTE_LINE_KINDS as readonly string[]).includes(v);
}

export interface DemandQuoteLine {
  id: string;
  itemId: string | null;
  menuItemId: string | null;
  packageId: string | null;
  quantity: number;
  portion: Portion | null;
  unitPriceCents: number;
  displayOrder: number;
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
export interface DemandPackage {
  id: string;
  labelEn: string | null;
  labelEs: string | null;
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

/** True for a line with a package id and no catalog reference (a header, pick or placeholder). */
export function isBarePackageLine(l: Pick<DemandQuoteLine, "packageId" | "itemId" | "menuItemId">): boolean {
  return l.packageId != null && l.itemId == null && l.menuItemId == null;
}

export function resolveDemandFromLines(input: {
  lines: readonly DemandQuoteLine[];
  comps: readonly DemandPackageComp[];
  packages: readonly DemandPackage[];
  picks: readonly DemandPick[];
}): ResolvedDemand[] {
  const out: ResolvedDemand[] = [];
  const lines = [...input.lines].sort((a, b) => a.displayOrder - b.displayOrder);

  const compsByPackage = new Map<string, DemandPackageComp[]>();
  for (const c of [...input.comps].sort((a, b) => a.displayOrder - b.displayOrder)) {
    const arr = compsByPackage.get(c.packageId) ?? [];
    arr.push(c);
    compsByPackage.set(c.packageId, arr);
  }
  const choiceSlots = (pkgId: string) => (compsByPackage.get(pkgId) ?? []).filter((c) => c.slotType === "choice");
  const pkgById = new Map(input.packages.map((p) => [p.id, p] as const));
  const picksBySlot = new Map<string, DemandPick[]>();
  const linesWithPicks = new Set<string>();
  for (const p of input.picks) {
    const key = `${p.quoteItemId}:${p.packageItemId}`;
    const arr = picksBySlot.get(key) ?? [];
    arr.push(p);
    picksBySlot.set(key, arr);
    linesWithPicks.add(p.quoteItemId);
  }

  const pushPositive = (d: ResolvedDemand) => { if (d.qty > 0) out.push(d); };
  /** The choice slot a pick/placeholder line stands for: by label, else the package's first. */
  const slotFor = (pkgId: string, description: string | null): DemandPackageComp | null => {
    const slots = choiceSlots(pkgId);
    const d = norm(description);
    return (d && slots.find((s) => slotLabel(s) === d)) || slots[0] || null;
  };
  /** Expand one header line. `fixed` = expand fixed components; `skip` = choice slots covered. */
  const expandHeader = (h: DemandQuoteLine, fixed: boolean, skip: ReadonlySet<string>) => {
    for (const c of compsByPackage.get(h.packageId!) ?? []) {
      if (c.slotType === "choice") {
        if (skip.has(c.id)) continue;
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

  // 1. Every referenced line counts at its own Qty (components, à la carte, legacy or kinded).
  for (const l of lines) {
    if (l.itemId) pushPositive({ itemId: l.itemId, menuItemId: null, choicePackageItemId: null, portion: l.portion, qty: l.quantity });
    else if (l.menuItemId) pushPositive({ itemId: null, menuItemId: l.menuItemId, choicePackageItemId: null, portion: l.portion, qty: l.quantity });
  }

  // 2. Kinded package lines (rule set A).
  const kindedHeaderPackages = new Set(
    lines.filter((l) => l.lineKind === "package_header" && l.packageId).map((l) => l.packageId!),
  );
  for (const l of lines) {
    if (!l.packageId || !isBarePackageLine(l)) continue;
    if (l.lineKind === "package_header") {
      expandHeader(l, l.componentsListed !== true, new Set());
    } else if (l.lineKind === "package_pick" && !kindedHeaderPackages.has(l.packageId)) {
      const slot = slotFor(l.packageId, l.description);
      if (slot) pushPositive({ itemId: null, menuItemId: null, choicePackageItemId: slot.id, portion: null, qty: l.quantity });
    }
  }

  // 3. Legacy package lines (rule set B): NULL kind only, walked in display order.
  const isLegacyHeader = (l: DemandQuoteLine): boolean => {
    if (linesWithPicks.has(l.id)) return true;
    const slots = choiceSlots(l.packageId!);
    if (slots.length === 0) return true;
    const d = norm(l.description);
    const pkg = pkgById.get(l.packageId!);
    if (d && pkg && (d === norm(pkg.labelEn) || d === norm(pkg.labelEs))) return true;
    if (d && slots.some((s) => slotLabel(s) === d)) return false;
    return l.unitPriceCents > 0;
  };
  interface Segment { header: DemandQuoteLine; covered: Set<string>; listed: boolean }
  const segments: Segment[] = [];
  const openSegment = new Map<string, Segment>();
  for (const l of lines) {
    if (l.lineKind != null || !l.packageId) continue;
    const seg = openSegment.get(l.packageId);
    if (!isBarePackageLine(l)) {
      if (seg) seg.listed = true; // a referenced component of this package, listed as its own line
      continue;
    }
    if (isLegacyHeader(l)) {
      const next: Segment = { header: l, covered: new Set(), listed: false };
      segments.push(next);
      openSegment.set(l.packageId, next);
      continue;
    }
    // A placeholder: its own Qty is the slot count — counted once, here, never × the slot again.
    const slot = slotFor(l.packageId, l.description);
    if (!slot) continue;
    if (seg && (picksBySlot.get(`${seg.header.id}:${slot.id}`)?.length ?? 0) > 0) continue; // the header's stored picks reserve it
    seg?.covered.add(slot.id);
    pushPositive({ itemId: null, menuItemId: null, choicePackageItemId: slot.id, portion: null, qty: l.quantity });
  }
  for (const s of segments) expandHeader(s.header, !s.listed, s.covered);

  return out;
}
