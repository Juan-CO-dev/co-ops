/** Advisory marketplace links. Pure; names never become strong identity or a merge. */

export const MARKETPLACE_LINK_REASONS = ["same_name", "same_initial", "same_shop", "shared_items"] as const;
export type MarketplaceLinkReason = (typeof MARKETPLACE_LINK_REASONS)[number];
export interface MarketplacePerson {
  nameKey: string;
  locationId: string;
  items: readonly string[];
  dates: readonly string[];
}
export interface MarketplaceCandidate extends MarketplacePerson { customerId: string }
export interface MarketplaceLinkVerdict {
  customerId: string;
  confidence: number;
  reasons: MarketplaceLinkReason[];
}

function parts(raw: string): { key: string; first: string; last: string } | null {
  // Match SQL's stored-name comparison exactly; do not fold accents into another identity.
  const key = raw.toLowerCase().replaceAll(".", "").trim().replace(/\s+/g, " ");
  const tokens = key.split(" ");
  const first = tokens[0];
  const last = tokens.at(-1);
  return key && tokens.length >= 2 && first && first.length > 1 && last ? { key, first, last } : null;
}

export function marketplaceLinkVerdict(input: {
  guest: MarketplacePerson;
  candidates: readonly MarketplaceCandidate[];
}): MarketplaceLinkVerdict | null {
  const guest = parts(input.guest.nameKey);
  if (!guest) return null;
  const compatible = input.candidates.filter((candidate) => {
    const direct = parts(candidate.nameKey);
    if (!direct || candidate.locationId !== input.guest.locationId || direct.first !== guest.first) return false;
    return direct.last === guest.last || ((direct.last.length === 1 || guest.last.length === 1) && direct.last[0] === guest.last[0]);
  });
  // Count ALL compatible identities before examining evidence: shared items cannot erase ambiguity.
  if (compatible.length !== 1) return null;
  const candidate = compatible[0]!;
  const direct = parts(candidate.nameKey)!;
  const sameName = guest.key === direct.key && guest.last.length > 1 && direct.last.length > 1;
  const topItems = new Set(candidate.items.slice(0, 5).map((item) => item.trim().toLowerCase()).filter(Boolean));
  const shared = new Set(input.guest.items.map((item) => item.trim().toLowerCase()).filter((item) => topItems.has(item))).size;
  // Initial-only names need two shared top items: one shared sub is near-certain at a sandwich shop.
  const sharedItems = shared >= (sameName ? 1 : 2);
  if (!sameName && !sharedItems) return null;
  const reasons: MarketplaceLinkReason[] = [sameName ? "same_name" : "same_initial", "same_shop"];
  if (sharedItems) reasons.push("shared_items");
  return { customerId: candidate.customerId, confidence: sameName ? (sharedItems ? 0.9 : 0.8) : 0.7, reasons };
}
