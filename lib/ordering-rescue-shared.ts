/**
 * THE VENDOR-DOWN RESCUE DECISION — one pure authority for the walk and its submission
 * (audit W18/B026). Zero I/O; client-safe.
 *
 * When a par'd member of a product cannot be routed today (deactivated, or its vendor is down),
 * its par is CARRIED by another member of the same product. `loadWalkerData` showed the backup
 * row with the dropped twin's par, but `submitParPass` resolved the backup's OWN par, found none
 * and refused the whole walk `no_par`. Both now ask this function, so the row the walk shows is
 * the row the submit accepts.
 *
 * The rules, carried verbatim from the walker:
 *   · a product with no index entry cannot be rescued (its dropped pars stay faults);
 *   · a product already walked today through another member is COVERED (no backup row);
 *   · otherwise the carried par is the HIGHEST dropped par, ties broken by sku id (a TOTAL order);
 *   · the target is the product's RESOLVED member first, then any member in index order, and must
 *     be a different SKU than every dropped one, active here, with a live vendor.
 */

/** A par'd member that could not be routed today. */
export interface RescueDroppedPar {
  skuId: string;
  par: number;
}

export interface RescueMember {
  skuId: string;
  active: boolean;
  vendorId: string | null;
}

export interface RescueProductEntry {
  resolution: { skuId: string | null };
  members: ReadonlyArray<RescueMember>;
}

export interface RescueTarget<D extends RescueDroppedPar> {
  productId: string;
  /** The dropped par this member carries (the walk's `reroutedFromSkuId` is its sku). */
  carried: D;
  /** Every dropped par of the product; the walk releases them once the row exists. */
  dropped: D[];
}

export interface RescueDecision<D extends RescueDroppedPar> {
  /** target member sku id → what it carries. */
  targets: Map<string, RescueTarget<D>>;
  /** Products another walked member already covers (with their dropped pars). */
  covered: Array<{ productId: string; dropped: D[] }>;
  /** Products with no index entry (each dropped par stays a fault). */
  noEntry: Array<{ productId: string; dropped: D[] }>;
  /** Products with an entry but no member able to carry the par. */
  unroutable: string[];
}

export function resolveRescueTargets<D extends RescueDroppedPar>(input: {
  droppedByProduct: ReadonlyMap<string, ReadonlyArray<D>>;
  /** Products with at least one member walked today. */
  coveredProductIds: ReadonlySet<string>;
  byProduct: ReadonlyMap<string, RescueProductEntry>;
  liveVendorIds: ReadonlySet<string>;
}): RescueDecision<D> {
  const out: RescueDecision<D> = { targets: new Map(), covered: [], noEntry: [], unroutable: [] };
  for (const [productId, droppedList] of input.droppedByProduct) {
    const dropped = [...droppedList];
    if (dropped.length === 0) continue;
    const entry = input.byProduct.get(productId) ?? null;
    if (entry == null) { out.noEntry.push({ productId, dropped }); continue; }
    // Highest par first: if two members dropped, the survivor carries the larger demand.
    // `par` ties are the common case (two twins on the same number), so the sku id makes
    // the order TOTAL rather than dependent on the unordered select that filled the walk.
    const carried = [...dropped].sort((a, b) => (b.par !== a.par ? b.par - a.par : a.skuId.localeCompare(b.skuId)))[0]!;
    if (input.coveredProductIds.has(productId)) { out.covered.push({ productId, dropped }); continue; }
    const droppedIds = new Set(dropped.map((d) => d.skuId));
    const byPreference = [
      ...entry.members.filter((m) => m.skuId === entry.resolution.skuId),
      ...entry.members,
    ];
    const target = byPreference.find(
      (m) => m.active && !droppedIds.has(m.skuId) && m.vendorId != null && input.liveVendorIds.has(m.vendorId),
    );
    if (!target) { out.unroutable.push(productId); continue; }
    out.targets.set(target.skuId, { productId, carried, dropped });
  }
  return out;
}
