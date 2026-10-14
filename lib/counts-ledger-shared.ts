/**
 * B9 (2026-10-14) — the Counts read path's per-window arithmetic over ledgers that are
 * loaded ONCE PER RENDER. PURE (the `*-shared.ts` pattern: zero I/O, no server imports;
 * type-only imports erase).
 *
 * WHY THIS EXISTS. The on-hand read used to ask the database the same questions once per
 * anchor GROUP (every distinct count-session / par-walk / baseline instant): the location's
 * deliveries, their lines, its live productions and their inputs, a staleness probe, and —
 * on production's ezCater-reconciled source — a full re-derivation of the effective sales
 * window per consumer. ~130 round trips per render, most of them the same rows again.
 * Now lib/counts.ts loads each ledger once from the EARLIEST instant any consumer needs,
 * and every window below is a filter over those rows.
 *
 * EVERY FUNCTION HERE IS A LINE-FOR-LINE TRANSLATION of the query it replaces: same
 * window edges (strictly after the anchor, through `until` inclusive), the same
 * row-order-insensitive sums, the same advisory-null taints. Timestamps compare as
 * INSTANTS at microsecond precision, exactly as Postgres compares timestamptz — a "Z"
 * anchor against a "+00:00" ledger row must not compare as text. The equivalence
 * proof is tests/counts-onhand-equivalence.test.ts (old read path vs this one over the
 * same database, all three sales sources).
 */
import { salesWindowUntrustworthy } from "@/lib/counts-shared";
import type { CaptureDayManifest, EffectiveSalesRow, SalesCoverage } from "@/lib/toast/effective-depletion";

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

// ── Instants ─────────────────────────────────────────────────────────────────────
const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Microseconds since the epoch for a timestamptz as PostgREST (or `toISOString`) spells it.
 * Microsecond precision matters: Postgres keeps six fractional digits and a JS Date keeps
 * three, so two rows a few µs apart must not collapse into a tie at a window edge.
 */
export function instantMicros(iso: string): number {
  const m = ISO_INSTANT.exec(iso);
  if (!m) return Date.parse(iso) * 1000;
  const base = Date.parse(`${m[1]}T${m[2]}${m[4] ?? "Z"}`);
  const frac = (m[3] ?? ".").slice(1).padEnd(6, "0").slice(0, 6);
  return base * 1000 + Number(frac || "0");
}

/** `ts` in the half-open window (after, until] — the ledger helpers' `.gt(after).lte(until)`. */
export function inInstantWindow(ts: string, afterIso: string, untilIso: string | null): boolean {
  const t = instantMicros(ts);
  return t > instantMicros(afterIso) && (untilIso == null || t <= instantMicros(untilIso));
}

/** The earliest of a set of instants (by value, not by spelling); null when empty. */
export function earliestInstant(isos: Iterable<string>): string | null {
  let best: string | null = null;
  for (const iso of isos) if (best == null || instantMicros(iso) < instantMicros(best)) best = iso;
  return best;
}

/** The earliest of a set of YYYY-MM-DD dates; null when empty. */
export function earliestDate(dates: Iterable<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) if (d != null && (best == null || d < best)) best = d;
  return best;
}

// ── The effective sales window, loaded once ──────────────────────────────────────
export type SalesSourceMode = "legacy" | "capture" | "reconciled";

/**
 * ONE effective-sales read for the whole render: [fromDate, end) of the active source
 * (legacy ledger, raw capture, or ezCater-reconciled capture), un-filtered by SKU.
 * Every consumer — the watermark check, the coverage disclosure, the three gap reads, the
 * inferred 28-day lane and every since/between sum — slices it. That is exact because
 * every source derives each business day independently of the window it was asked for
 * (rows, coverage, and the reconciled source's degraded days are all per-day facts).
 */
export interface SalesSnapshot {
  mode: SalesSourceMode;
  locationId: string;
  /** Earliest business date any consumer needs. */
  fromDate: string;
  /** Exclusive end; null = open-ended (the legacy ledger is read with no end). */
  end: string | null;
  /** ET calendar date when the read ran — the capture sums' default end, as before. */
  today: string;
  /** ET business date of the render's `now` — the open day the gap reads exclude. */
  openEtDate: string;
  rows: EffectiveSalesRow[];
  coverage: SalesCoverage;
  /** LEGACY ONLY: loadSalesGapDates' answer from the earliest gap consumer's date. */
  legacyGaps: ReadonlySet<string> | null;
  /** RAW CAPTURE ONLY: the day manifests the read was fenced against (the disclosure's input). */
  manifests?: CaptureDayManifest[];
}

/** A gap set that remembers the date it was read from (the old per-consumer read). */
export class SalesGapSet extends Set<string> {
  constructor(readonly since: string, dates: Iterable<string>) {
    super(dates);
  }
}

function missingDates(snap: SalesSnapshot): string[] {
  return snap.coverage.byLocation[snap.locationId]?.missingDates ?? [];
}

/**
 * The gap dates a consumer whose earliest window starts at `since` used to read for
 * itself (loadSalesGapDates): legacy = the event/ledger probe's dates on/after `since`;
 * capture = the source's missing days in [since, openEtDate).
 */
export function salesGapDates(snap: SalesSnapshot, since: string): SalesGapSet {
  if (snap.mode === "legacy") return new SalesGapSet(since, [...(snap.legacyGaps ?? [])].filter((d) => d >= since));
  return new SalesGapSet(since, missingDates(snap).filter((d) => d >= since && d < snap.openEtDate));
}

/**
 * SUM(direct_oz) per SKU over [fromDate, untilExclusive) — sumSalesDirectOzWindow, sliced.
 * Untrustworthy window (a gap inside it, or a collapsed between-window) → every SKU null.
 * On a capture source the window's OWN coverage is re-checked too (the old read did that
 * against whichever snapshot it used: the gap read's when it covered the window, else a
 * fresh read of exactly [fromDate, end)).
 */
export function salesDirectOz(
  snap: SalesSnapshot,
  skuIds: readonly string[],
  fromDate: string,
  untilExclusive: string | null,
  gaps: SalesGapSet,
): Map<string, number | null> {
  if (salesWindowUntrustworthy(gaps, fromDate, untilExclusive)) {
    return new Map<string, number | null>(skuIds.map((id) => [id, null]));
  }
  const out = new Map<string, number | null>(skuIds.map((id) => [id, 0]));
  const capture = snap.mode !== "legacy";
  const end = untilExclusive ?? (capture ? snap.today : null);
  if (capture) {
    const fromGapRead = fromDate >= gaps.since && end !== null && end <= snap.openEtDate;
    const limit = untilExclusive == null && fromGapRead ? snap.openEtDate : end;
    const current = missingDates(snap).filter((d) => d >= fromDate && (limit === null || d < limit));
    if (salesWindowUntrustworthy(new Set(current), fromDate, untilExclusive)) {
      return new Map<string, number | null>(skuIds.map((id) => [id, null]));
    }
  }
  const selected = new Set(skuIds);
  for (const r of snap.rows) {
    if (r.location_id !== snap.locationId || !selected.has(r.sku_id) || r.business_date < fromDate ||
      (end !== null && r.business_date >= end)) continue;
    out.set(r.sku_id, (out.get(r.sku_id) ?? 0) + (num(r.direct_oz) ?? 0));
  }
  return out;
}

/** The rows loadEffectiveSalesRows({ fromDate }) returned (no SKU filter, the source's default end). */
export function salesRowsFrom(snap: SalesSnapshot, fromDate: string): EffectiveSalesRow[] {
  const end = snap.mode === "legacy" ? null : snap.today;
  return snap.rows.filter((r) => r.location_id === snap.locationId && r.business_date >= fromDate && (end === null || r.business_date < end));
}

/** A coverage disclosure narrowed to [fromDate, end) — each date's status is its own fact. */
export function sliceSalesCoverage(coverage: SalesCoverage, fromDate: string, end: string): SalesCoverage {
  const byLocation: SalesCoverage["byLocation"] = {};
  for (const [locationId, d] of Object.entries(coverage.byLocation)) {
    const inRange = (date: string) => date >= fromDate && date < end;
    const missing = d.missingDates.filter(inRange);
    const degraded = d.degradedDates.filter(inRange);
    byLocation[locationId] = { hasGaps: missing.length > 0, degraded: degraded.length > 0, missingDates: missing, degradedDates: degraded };
  }
  const rows = Object.values(byLocation);
  return { source: coverage.source, hasGaps: rows.some((r) => r.hasGaps), degraded: rows.some((r) => r.degraded), byLocation };
}

/** Does the snapshot cover [fromDate, end) entirely? */
export function salesSnapshotCovers(snap: SalesSnapshot, fromDate: string, end: string): boolean {
  return fromDate >= snap.fromDate && (snap.end === null || end <= snap.end);
}
