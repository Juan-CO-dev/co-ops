/**
 * Demand signals (item 4 PR 2): WHO MAY DO WHAT, by trusted ROLE (never a level alone). Pure.
 * Juan's answers of 2026-11-18:
 *   · a source is marked verified or revoked by MoO+ (moo / owner / cgs), Tier B, audited who and when;
 *   · a signal's GO-LIVE is approved by MoO+ too, not only by the owner (the approval itself ships in PR 4 / 6);
 *   · events are entered by hand by GM+ : a GM for their own shop, MoO+ for any shop or for all shops.
 * Level-6 roles (AGM, prep, catering and social media managers) are refused all three in v1.
 * 0343's writers re-read the role on the users row; these are the early, friendly refusals.
 */
const MOO_PLUS: ReadonlyArray<string> = ["moo", "owner", "cgs"];
const GM_PLUS: ReadonlyArray<string> = ["gm", ...MOO_PLUS];

export const canMarkSource = (role: string): boolean => MOO_PLUS.includes(role);
export const canApproveSignalGoLive = (role: string): boolean => MOO_PLUS.includes(role);
export const canEnterDemandEvent = (role: string): boolean => GM_PLUS.includes(role);

/** May this person enter (or correct) an event for this shop? `null` = every shop. */
export function demandEventShopAllowed(role: string, memberLocationIds: ReadonlyArray<string>, locationId: string | null): boolean {
  if (MOO_PLUS.includes(role)) return true;
  if (role !== "gm") return false;
  return locationId !== null && memberLocationIds.includes(locationId);
}

/**
 * PR 5: who may OPEN the signals page: a GM for a shop they belong to, MoO / Owner / CGS for any shop. Level-6
 * roles (the social media manager among them) are refused by ROLE, never by level.
 */
export const canViewDemandSignals = (role: string): boolean => GM_PLUS.includes(role);
/** The shops this person may see signals for, out of the active shops. */
export function demandSignalShops<T extends { id: string }>(role: string, memberLocationIds: ReadonlyArray<string>, shops: ReadonlyArray<T>): T[] {
  if (MOO_PLUS.includes(role)) return [...shops];
  if (role !== "gm") return [];
  return shops.filter((s) => memberLocationIds.includes(s.id));
}
