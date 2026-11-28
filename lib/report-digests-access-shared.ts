/**
 * Digest DATA gates: the ONE place that decides whether a recipient may be shown a piece of data in a
 * digest. Pure, zero I/O.
 *
 * THE RULE: A digest never shows a recipient what Juan has not approved for them. By default that is what
 * the app shows them on screen for that shop and period: such a capability delegates to the app's OWN
 * predicate for the screen that shows the data, so widening a screen in the app widens the digest with no
 * digest change. A digest-only grant is a named row here with Juan's date. It grants nothing in the app (no
 * screen, route or RLS change), and it needs to know which digest the email is and which shops the engine
 * resolved it to deliver (`DigestAccess.digest`), so it holds only for a real resolved send.
 *
 * A composer never asks a role or a level itself: it tags a line `needs: <capability>` and `finishSection`
 * (lib/report-digests-layout-shared.ts) cuts the line BEFORE anything is counted.
 *
 * FAIL CLOSED. For LINKS an absent viewer means "unscoped" (lib/report-digests-links.ts: fixtures and
 * callers that compose for no one in particular). For DATA an absent or null access means NO: a fixture
 * that wants gated lines passes an explicit access. The engine builds the recipient's access once per send
 * (beside `viewerFor`) and passes it in the envelope; only the engine sets `digest`, from the resolved
 * recipient. No `digest` (a package send, a fixture, a direct compose) = no digest-only grant. Roles are a
 * CLOSED allowlist read through `isRoleCode`: an unknown role is nobody, and the level the viewer carries is
 * never read here.
 *
 * | Capability           | Who                                                                         | Since      | Period           |
 * |----------------------|-----------------------------------------------------------------------------|------------|------------------|
 * | `sales_detail`       | the Sales page gate, `canOpen(viewer, { to: "sales", … })`                  | app's own  | the digest's day |
 * | `sales_detail`       | DIGEST ONLY (b): AGM or prep manager, SHOP digest, own shop                 | 2026-11-27 | the digest's day |
 * | `published_staffing` | DIGEST ONLY (a): MoO / Owner / CGS at a delivered shop; GM, AGM, prep or    | 2026-11-27 | the digest's day |
 * |                      | catering manager at an own delivered shop; shift lead the same, catering    |            |                  |
 * |                      | digest only                                                                 |            |                  |
 *
 * "Own shop" for a digest-only grant = the shop is in `digest.shops` AND in the viewer's active memberships;
 * for MoO / Owner / CGS the shop is in `digest.shops`. "all" and "no shop set" are never a shop for a
 * digest-only grant (the Sales page path keeps its own "all" reading). The social media manager gets nothing
 * from either grant, by role.
 *
 * Adding a capability or a grant = one row here, its predicate below, and a test of the access matrix on
 * rendered HTML and text.
 */
import { canOpen, type LinkViewer } from "@/lib/report-digests-links";
import { validReportDate } from "@/lib/report-range";
import { isRoleCode, type RoleCode } from "@/lib/roles";

/** Every gated kind of digest data. A line carries at most one (`DigestLine.needs`). */
export type DigestCapability = "sales_detail" | "published_staffing";

/**
 * Which digest an email is and the shops it was resolved to deliver (`ResolvedRecipient.locationIds`, the
 * recipient's authorized scope already narrowed by any override). Set ONLY by the engine, from the resolved
 * recipient.
 */
export interface DigestDelivery { kind: "gm_shop" | "unified" | "catering"; shops: readonly string[] }

/** Who a digest is composed for, for its DATA gates: the recipient's real role, level and active shops, and the delivery. */
export interface DigestAccess { viewer: LinkViewer; digest?: DigestDelivery }

/** The shop (null = no shop set; "all" = every shop) and business day a piece of data is about. */
export interface DigestScope { locationId: string | null; day: string }

/** The recipient's access from their link viewer (and, from the engine only, the delivery). No viewer = no access (null), never "unscoped". */
export function digestAccessFor(viewer: LinkViewer | null | undefined, digest?: DigestDelivery | null): DigestAccess | null {
  if (!viewer) return null;
  return digest ? { viewer, digest: { kind: digest.kind, shops: [...digest.shops] } } : { viewer };
}

// Juan 2026-11-27, the closed role sets of the two digest-only grants.
const ALL_DELIVERED_SHOPS: readonly RoleCode[] = ["moo", "owner", "cgs"];
const STAFFING_OWN_SHOP: readonly RoleCode[] = ["gm", "agm", "prep_mgr", "catering_mgr"];
const SALES_DETAIL_SHOP_DIGEST: readonly RoleCode[] = ["agm", "prep_mgr"];

/** A real shop of this delivery: never "all", never empty, and one the engine resolved the email to deliver. */
function delivered(digest: DigestDelivery, locationId: string): boolean {
  return locationId !== "all" && locationId !== "" && digest.shops.includes(locationId);
}
/** A delivered shop that is also one of the viewer's active memberships. */
function ownDelivered(access: DigestAccess & { digest: DigestDelivery }, locationId: string): boolean {
  return delivered(access.digest, locationId) && access.viewer.locations.includes(locationId);
}

/** May this recipient be shown `capability` data for this shop and day? Absent or null access = no. */
export function digestCan(access: DigestAccess | null | undefined, capability: DigestCapability, scope: DigestScope): boolean {
  if (!access || !access.viewer) return false;
  // A real calendar date only (the report screens' own validator): "2026-02-31" is no day at all.
  if (scope.locationId === null || !validReportDate(scope.day)) return false;
  const locationId = scope.locationId;
  const role = isRoleCode(access.viewer.role) ? access.viewer.role : null;
  const withDigest = access.digest ? (access as DigestAccess & { digest: DigestDelivery }) : null;
  switch (capability) {
    // Every Sales figure beyond the pulse lines the digest has always carried: the Sales page's own gate
    // (SALES_READ_MIN = 7, own shop below level 8; "all" at the all-shops level), UNCHANGED. OR Juan
    // 2026-11-27 (b), digest only: a flagged AGM or prep manager on the SHOP digest, at their own delivered shop.
    case "sales_detail": {
      if (canOpen(access.viewer, { to: "sales", location: locationId, day: scope.day })) return true;
      return !!withDigest && !!role && withDigest.digest.kind === "gm_shop"
        && SALES_DETAIL_SHOP_DIGEST.includes(role) && ownDelivered(withDigest, locationId);
    }
    // Juan 2026-11-27 (a), digest only: scheduled staff for more roles than the app's schedule screen allows.
    case "published_staffing": {
      if (!withDigest || !role || !delivered(withDigest.digest, locationId)) return false;
      if (ALL_DELIVERED_SHOPS.includes(role)) return true;
      if (!ownDelivered(withDigest, locationId)) return false;
      return STAFFING_OWN_SHOP.includes(role) || (role === "shift_lead" && withDigest.digest.kind === "catering");
    }
  }
}
