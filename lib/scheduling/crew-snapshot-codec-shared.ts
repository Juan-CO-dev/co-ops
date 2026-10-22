import type { RuleContext } from "./context-shared";
import type { CrewDaySnapshot, CrewManualOverride } from "./crew-contracts-shared";
import type { Segment } from "./rules-shared";

/** Wire-only tuples. A shared string table removes repeated UUIDs, dates and reason keys.
 * Segment optional properties retain absent vs explicit false. No operator evidence is dropped.
 * Existing small snapshots and every station snapshot keep their original JSON representation.
 */
type PackedSegment = [number, number, number, Partial<Omit<Segment, "positionId" | "startQ" | "endQ" | "reasonKey" | "coverFor">>, number | null, number | null];
type PackedShift = [number, number, number, number, boolean, boolean, boolean, number];
type PackedOverride = [number, number, number, PackedShift | null];
interface PackedOverrides { version: 1; strings: string[]; segments: PackedSegment[][]; rows: PackedOverride[] }
type WireCrew = CrewDaySnapshot & { manualOverridesPacked?: PackedOverrides };

function pack(overrides: CrewManualOverride[]): PackedOverrides {
  const strings: string[] = [], ids = new Map<string, number>();
  const id = (s: string): number => {
    const found = ids.get(s);
    if (found !== undefined) return found;
    const n = strings.length; strings.push(s); ids.set(s, n); return n;
  };
  const segments: PackedSegment[][] = [], segmentIds = new Map<string, number>();
  const segmentId = (list: Segment[]): number => {
    const tuples: PackedSegment[] = list.map(({ positionId, startQ, endQ, reasonKey, coverFor, ...rest }) =>
      [id(positionId), startQ, endQ, rest, reasonKey === undefined ? null : id(reasonKey), coverFor === undefined ? null : id(coverFor)]);
    const key = JSON.stringify(tuples);
    const found = segmentIds.get(key);
    if (found !== undefined) return found;
    const n = segments.length; segments.push(tuples); segmentIds.set(key, n); return n;
  };
  const rows: PackedOverride[] = overrides.map(({ original: o, replacement: r }) => [id(o.date), id(o.userId), o.startQ,
    r === null ? null : [id(r.date), id(r.userId), r.startQ, r.endQ, r.closingManager, r.flex, r.pinned,
      segmentId(r.segments)]]);
  return { version: 1, strings, segments, rows };
}

function unpack(p: PackedOverrides): CrewManualOverride[] {
  if (p.version !== 1 || !Array.isArray(p.strings) || !Array.isArray(p.rows)) throw new Error("Invalid crew override encoding");
  const str = (i: number): string => {
    const s = p.strings[i];
    if (!Number.isInteger(i) || typeof s !== "string") throw new Error("Invalid crew override string index");
    return s;
  };
  return p.rows.map(([date, userId, startQ, r]) => ({ original: { date: str(date), userId: str(userId), startQ },
    replacement: r === null ? null : { date: str(r[0]), userId: str(r[1]), startQ: r[2], endQ: r[3],
      closingManager: r[4], flex: r[5], pinned: r[6], segments: p.segments[r[7]]!.map(([pos, start, end, rest, reason, cover]) => ({
        ...rest, positionId: str(pos), startQ: start, endQ: end,
        ...(reason === null ? {} : { reasonKey: str(reason) }), ...(cover === null ? {} : { coverFor: str(cover) }),
      })) } }));
}

/** Pure wire transform: no mutation of the context used by validation or generation. */
export function encodeCrewContext(ctx: RuleContext): RuleContext {
  const days = { ...ctx.days };
  for (const [date, day] of Object.entries(days)) {
    if (!day.crew || day.crew.manualOverrides.length <= 5) continue;
    const crew: WireCrew = { ...day.crew, manualOverrides: [], manualOverridesPacked: pack(day.crew.manualOverrides) };
    days[date] = { ...day, crew };
  }
  return { ...ctx, days };
}

/** Called only after cloning a persisted snapshot; returns the ordinary in-memory contracts. */
export function decodeCrewContext(ctx: RuleContext): RuleContext {
  for (const day of Object.values(ctx.days)) {
    const crew = day.crew as WireCrew | undefined;
    if (!crew?.manualOverridesPacked) continue;
    if (crew.manualOverrides.length) throw new Error("Ambiguous crew override encoding");
    crew.manualOverrides = unpack(crew.manualOverridesPacked);
    delete crew.manualOverridesPacked;
  }
  return ctx;
}
