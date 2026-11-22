/**
 * The positive guard fixture (plan r4, 13.8): a small, compiling file in the APPROVED shape, run through rules U1-U6 by
 * tests/day-plan-pure.test.ts with the same program and rules as lib/day-plan-shared.ts. It must pass every U-rule (a
 * guard that rejects intended code is a broken guard); each 13.7 mutation applied to it must produce its named finding.
 *
 * Self-contained on purpose: it carries its own brand, boundary and effectiveClose, written as in plan 5.1, so U2's
 * "declared once" holds inside the file and the mutations have the real shape to break.
 */
import type { DayStation, EffectiveClose } from "@/lib/day-plan-shared";
import { operationalNow } from "@/lib/midshift-shared";
import { cutoffMinutes } from "@/lib/vendor-rhythm-shared";

const usualBrand: unique symbol = Symbol("UsualClose");
interface UsualClose { readonly wall: string; readonly [usualBrand]: true }
interface NormalStation extends Omit<DayStation, "usuallyClosesAt"> {
  readonly usual: UsualClose | null;
  readonly usualRank: number | null;
}

function brandUsual(wall: string): UsualClose {
  return { wall, [usualBrand]: true };
}

function usualMinutes(u: UsualClose): number | null {
  return cutoffMinutes(u.wall);
}

/** The boundary (U1, U6): the one reader of usuallyClosesAt; ranks by string order only. */
function normalizeStations(raw: readonly DayStation[]): NormalStation[] {
  const timed = raw.filter((s) => s.usuallyClosesAt !== null)
    .sort((a, b) => (a.usuallyClosesAt! < b.usuallyClosesAt! ? -1 : a.usuallyClosesAt! > b.usuallyClosesAt! ? 1 : a.sort - b.sort));
  const rank = new Map(timed.map((s, i) => [s.id, i]));
  return raw.map((s) => {
    const { usuallyClosesAt, ...rest } = s;
    return { ...rest, usual: usuallyClosesAt === null ? null : brandUsual(usuallyClosesAt), usualRank: rank.get(s.id) ?? null };
  });
}

function effectiveClose(s: NormalStation, nowMin: number, planDate: string): EffectiveClose | null {
  if (s.closedAt !== null) return { min: operationalNow(new Date(s.closedAt)).minutesOfDay, iso: s.closedAt, by: "event" };
  const usual = s.usual === null ? null : usualMinutes(s.usual);
  void planDate;
  return usual !== null && nowMin >= usual ? { min: usual, iso: null, by: "clock" } : null;
}

/** A verbatim .wall copy into a reason's params, in a function with no nowMin (U3′, U5′). */
function pastDueParams(s: NormalStation) {
  return { station: s.name, time: s.usual!.wall };
}

/** normalize → effectiveClose in a map (nowMin beside UsualClose-typed values: allowed, U5′) → display params. */
export function approvedShape(raw: readonly DayStation[], nowMin: number, planDate: string) {
  const stations = normalizeStations(raw);
  const closes = stations.map((s) => effectiveClose(s, nowMin, planDate));
  const params = stations.filter((s) => s.usual !== null).map(pastDueParams);
  return { closes, params };
}
