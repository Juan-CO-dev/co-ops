/**
 * Digest DATA gates: the ONE place that decides whether a recipient may be shown a piece of data in a
 * digest. Pure, zero I/O.
 *
 * THE RULE (CC ruling, digests round 3): a digest never shows a recipient anything the app would refuse
 * them on screen for that shop and period. Each capability below delegates to the app's OWN predicate for
 * the screen that shows the data, so widening a screen in the app widens the digest with no digest change,
 * and nothing here is a second opinion about a role or a level. A composer never asks a role or a level
 * itself: it tags a line `needs: <capability>` and `finishSection` (lib/report-digests-layout-shared.ts)
 * cuts the line BEFORE anything is counted.
 *
 * FAIL CLOSED. For LINKS an absent viewer means "unscoped" (lib/report-digests-links.ts: fixtures and
 * callers that compose for no one in particular). For DATA an absent or null access means NO: a fixture
 * that wants gated lines passes an explicit access. The engine builds the recipient's access once per send
 * (beside `viewerFor`) and passes it in the envelope.
 *
 * | Capability     | The app's own predicate                                          | Period          |
 * |----------------|------------------------------------------------------------------|-----------------|
 * | `sales_detail` | the Sales page gate, `canOpen(viewer, { to: "sales", … })`       | the digest's day |
 *
 * Adding a capability = one row here, its predicate below, and a test of the access matrix on rendered
 * HTML and text.
 */
import { canOpen, type LinkViewer } from "@/lib/report-digests-links";
import { validReportDate } from "@/lib/report-range";

/** Every gated kind of digest data. A line carries at most one (`DigestLine.needs`). */
export type DigestCapability = "sales_detail";

/** Who a digest is composed for, for its DATA gates: the recipient's real role, level and active shops. */
export interface DigestAccess { viewer: LinkViewer }

/** The shop (null = no shop set; "all" = every shop) and business day a piece of data is about. */
export interface DigestScope { locationId: string | null; day: string }

/** The recipient's access from their link viewer. No viewer = no access (null), never "unscoped". */
export function digestAccessFor(viewer: LinkViewer | null | undefined): DigestAccess | null {
  return viewer ? { viewer } : null;
}

/** May this recipient be shown `capability` data for this shop and day? Absent or null access = no. */
export function digestCan(access: DigestAccess | null | undefined, capability: DigestCapability, scope: DigestScope): boolean {
  if (!access || !access.viewer) return false;
  // A real calendar date only (the report screens' own validator): "2026-02-31" is no day at all.
  if (scope.locationId === null || !validReportDate(scope.day)) return false;
  switch (capability) {
    // Every Sales figure beyond the pulse lines the digest has always carried: the Sales page's own gate
    // (SALES_READ_MIN = 7, own shop below level 8; "all" at the all-shops level).
    case "sales_detail": return canOpen(access.viewer, { to: "sales", location: scope.locationId, day: scope.day });
  }
}
