/** Pure cached-menu pricing. Do not use the all-menu, first-wins matcher here. */
// Juan's reviewed in-store menu selector; other named menus have different prices.
export const TOAST_IN_STORE_MENU = "Compliments Only";

type Obj = Record<string, unknown>;
function object(value: unknown): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_toast_price_payload");
  return value as Obj;
}
function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("invalid_toast_price_payload");
  return value;
}

/** Default combines both lanes; callers matching crosswalk rows select the exact lane. */
export function inStorePricesByGuid(payload: unknown, lane: "item" | "modifier" | "both" = "both"): Map<string, number[]> {
  const root = object(payload);
  if (!Array.isArray(root.menus)) throw new Error("invalid_toast_price_payload");
  const prices = new Map<string, number[]>();
  function add(raw: unknown) {
    const item = object(raw);
    if (typeof item.guid !== "string" || !item.guid) throw new Error("invalid_toast_price_payload");
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price <= 0) return;
    const cents = Math.round(item.price * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) return;
    prices.set(item.guid, [...(prices.get(item.guid) ?? []), cents]);
  }
  function group(raw: unknown, depth: number) {
    if (depth > 100) throw new Error("invalid_toast_price_payload");
    const g = object(raw);
    for (const item of list(g.menuItems)) add(item);
    for (const sub of list(g.menuGroups)) group(sub, depth + 1);
  }
  if (lane !== "modifier") for (const raw of root.menus) {
    const menu = object(raw);
    if (menu.name === TOAST_IN_STORE_MENU) for (const g of list(menu.menuGroups)) group(g, 0);
  }
  if (lane !== "item" && root.modifierOptionReferences != null) {
    for (const option of Object.values(object(root.modifierOptionReferences))) add(option);
  }
  return prices;
}

export interface PriceCandidate {
  typedPrice: number | null;
  toastPrices: readonly number[];
}
export interface ResolvedMenuPrice {
  effectivePrice: number | null;
  priceSource: "typed" | "toast" | "same_as" | null;
  toastPriceCents: number | null;
  /** Cents, like toastPriceCents. */
  toastPriceVaries: { min: number; max: number } | null;
  priceFlag: boolean;
  includedInSubPrice: boolean;
}
function positive(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}
function toastRange(values: readonly number[]) {
  const valid = values.filter((v) => Number.isSafeInteger(v) && v > 0);
  return valid.length ? { min: Math.min(...valid), max: Math.max(...valid) } : null;
}
/** sameAs deliberately accepts only a direct candidate, never a resolved/chained price. */
export function resolveMenuPrice(input: PriceCandidate & { section?: string | null; sameAs?: PriceCandidate | null }): ResolvedMenuPrice {
  const typed = positive(input.typedPrice);
  const range = toastRange(input.toastPrices);
  const toast = range ? range.min / 100 : null;
  const inherited = input.sameAs
    ? positive(input.sameAs.typedPrice) ?? ((toastRange(input.sameAs.toastPrices)?.min ?? 0) / 100 || null)
    : null;
  const effectivePrice = typed ?? toast ?? inherited;
  return {
    effectivePrice,
    priceSource: typed != null ? "typed" : toast != null ? "toast" : inherited != null ? "same_as" : null,
    toastPriceCents: range?.min ?? null,
    toastPriceVaries: range && range.min !== range.max ? range : null,
    priceFlag: typed != null && range != null && Math.abs(Math.round(typed * 100) - range.min) >= 1,
    includedInSubPrice: effectivePrice == null && input.section === "Modifier builds",
  };
}

export function isValidMenuPrice(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1000
    && value === Math.round(value * 100) / 100);
}
