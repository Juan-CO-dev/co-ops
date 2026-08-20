/**
 * Dashboard + mid-shift operational status — the CLIENT-SAFE pure core
 * (design: docs/superpowers/specs/2026-08-19-dashboard-operational-legibility-design.md).
 *
 * Zero I/O, no server imports, per the *-shared.ts pattern (AGENTS.md "Module
 * boundaries & testing"). Every function here is a pure transform from an
 * EXISTING loader's output to a view model; the dashboard tiles and the
 * mid-shift strip are thin renderings of these same functions, so one fact
 * reads identically on both surfaces.
 *
 * KEY-RETURNING, NOT STRING-RETURNING (the components/reports-hub/shared.ts
 * precedent): view models carry TranslationKeys + params; translation happens
 * at the call site, which already holds the viewer's language. That keeps
 * these functions testable without an i18n dictionary.
 *
 * NO INVENTED DATA (design §1): a term a loader cannot supply is modelled as
 * `null` and renders as an honest absence — never a fabricated number.
 */

import type { TranslationKey } from "@/lib/i18n/types";

// ─────────────────────────────────────────────────────────────────────────────
// View-model primitives
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Semantic pill tone. Member names are deliberately identical to
 * `AlertPillTone` (components/ui/AlertPill.tsx) so a view model's tone is
 * structurally assignable to the primitive with no conversion — while lib/
 * keeps its no-imports-from-components/ direction.
 */
export type StatusPillTone = "warn" | "danger" | "ok" | "info";

export interface StatusPill {
  /** Stable React key (unique within its pill list). */
  id: string;
  key: TranslationKey;
  params?: Record<string, string | number>;
  tone: StatusPillTone;
}

export interface StatusRow {
  /** Stable React key. */
  id: string;
  /** Already-resolved display text — a vendor name, never translated. */
  title: string;
  /** Pre-formatted secondary text (a time/date from the house formatters), or null. */
  meta: string | null;
  pills: StatusPill[];
  /** True when this row carries a problem; problem rows sort first. */
  problem: boolean;
}

/**
 * The tile's leading fact. `form: "gauge"` renders the 28px numeral treatment
 * (days-since, a cutoff clock time) with `value` as the numeral and `key` as
 * the caption; `form: "text"` renders the sentence form and ignores `value`.
 */
export interface StatusHeadline {
  key: TranslationKey;
  params?: Record<string, string | number>;
  form: "gauge" | "text";
  value: string | null;
  tone: StatusPillTone;
}

export interface TileViewModel {
  headline: StatusHeadline;
  pills: StatusPill[];
  rows: StatusRow[];
  /** Rows suppressed by the row cap; 0 when nothing was hidden. */
  overflowCount: number;
  /** True when the tile should render its own empty/action state instead. */
  empty: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Close state — ONE reading of a day's close (design §2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A day's close state. Four states, exactly as specced:
 *   pending        — no closing instance today
 *   in_progress    — an instance exists but is not finalized
 *   closed         — manually finalized
 *   auto_finalized — the system closed it (the state the dashboard used to drop)
 */
export type CloseStatus = "pending" | "in_progress" | "closed" | "auto_finalized";

export interface CloseState {
  status: CloseStatus;
  /**
   * True when the day closed with required items still incomplete (raw
   * `incomplete_confirmed`). A flag rather than a fifth state so the operational
   * nuance survives without splitting the model.
   */
  incomplete: boolean;
}

/** Raw checklist_instances.status values that mean "manually finalized". */
const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  "confirmed",
  "incomplete_confirmed",
  "phase2_complete",
]);

/**
 * The single derivation of a day's close state from a raw
 * `checklist_instances.status`. Consumed by the dashboard tile and mid-shift;
 * the reports surface keeps its finer raw-status labels (they carry
 * phase1_complete/submitted, which this 4-state deliberately folds away).
 *
 * An UNKNOWN status degrades to `in_progress`, never to `closed` — claiming a
 * day is closed on a status we do not recognize is the dangerous direction.
 */
export function deriveCloseState(rawStatus: string | null | undefined): CloseState {
  if (rawStatus == null || rawStatus === "") return { status: "pending", incomplete: false };
  if (rawStatus === "auto_finalized") return { status: "auto_finalized", incomplete: false };
  if (CLOSED_STATUSES.has(rawStatus)) {
    return { status: "closed", incomplete: rawStatus === "incomplete_confirmed" };
  }
  return { status: "in_progress", incomplete: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fridge aggregate — SIM-25 (design §2, safety-adjacent, LOUD)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One fridge's facts. `hasReadingToday` is the SIM-25 term and MUST be derived
 * from the today-scoped FridgeStatus (`status !== "no_reading_today"`), never
 * from `latestF != null` — `latest` in lib/maintenance.ts is the latest reading
 * since `sinceDate`, so a fridge unread today can still carry yesterday's value.
 */
export interface FridgeFacts {
  equipId: string;
  name: string;
  latestF: number | null;
  outOfRange: boolean;
  hasReadingToday: boolean;
}

export type FridgeAggregateState = "ok" | "alert";

export interface FridgeAggregateVm {
  state: FridgeAggregateState;
  headline: StatusHeadline;
  pills: StatusPill[];
  outOfRangeCount: number;
  unreadCount: number;
  readCount: number;
}

/**
 * The fridge aggregate, per the three locked rules:
 *   (a) "in range" is a claim ONLY about fridges actually read;
 *   (b) ANY unread fridge renders the alert state until it is read — no clock
 *       gate, no threshold (the mid-shift ATTENTION BANNER keeps its separate
 *       F4 time gate; this is the strip);
 *   (c) zero readings = the "no readings yet" alert.
 *
 * An out-of-range excursion outranks unread for the HEADLINE (it is the worse
 * fact) but never suppresses the unread pill.
 */
export function composeFridgeAggregate(fridges: FridgeFacts[]): FridgeAggregateVm {
  const total = fridges.length;
  const readCount = fridges.filter((f) => f.hasReadingToday).length;
  const unreadCount = total - readCount;
  const outOfRangeCount = fridges.filter((f) => f.outOfRange).length;
  // "In range" counts only fridges READ today and not flagged (rule a).
  const inRangeCount = fridges.filter((f) => f.hasReadingToday && !f.outOfRange).length;

  if (total === 0) {
    return {
      state: "ok",
      headline: { key: "midshift.fridges.none_configured", form: "text", value: null, tone: "info" },
      pills: [],
      outOfRangeCount: 0,
      unreadCount: 0,
      readCount: 0,
    };
  }

  const pills: StatusPill[] = [];
  if (unreadCount > 0) {
    pills.push({
      id: "unread",
      key: "midshift.fridges.pill_unread",
      params: { count: unreadCount },
      tone: "danger",
    });
  }
  if (inRangeCount > 0) {
    pills.push({
      id: "in-range",
      key: "midshift.fridges.pill_in_range_of_read",
      params: { count: inRangeCount },
      tone: "ok",
    });
  }

  if (outOfRangeCount > 0) {
    return {
      state: "alert",
      headline: {
        key: "midshift.fridges.flagged",
        params: { count: outOfRangeCount },
        form: "text",
        value: null,
        tone: "danger",
      },
      pills,
      outOfRangeCount,
      unreadCount,
      readCount,
    };
  }

  if (readCount === 0) {
    // Rule (c) — nothing has been read; there is no "in range" claim to make.
    return {
      state: "alert",
      headline: {
        key: "midshift.fridges.none_read",
        params: { count: total },
        form: "text",
        value: null,
        tone: "danger",
      },
      pills,
      outOfRangeCount,
      unreadCount,
      readCount,
    };
  }

  if (unreadCount > 0) {
    // Rule (b) — partial coverage is still the alert state.
    return {
      state: "alert",
      headline: {
        key: "midshift.fridges.some_unread",
        params: { unread: unreadCount, total },
        form: "text",
        value: null,
        tone: "danger",
      },
      pills,
      outOfRangeCount,
      unreadCount,
      readCount,
    };
  }

  return {
    state: "ok",
    headline: {
      key: "midshift.fridges.all_read_in_range",
      params: { count: total },
      form: "text",
      value: null,
      tone: "ok",
    },
    pills: [],
    outOfRangeCount,
    unreadCount,
    readCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Day math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whole CALENDAR days between two YYYY-MM-DD strings in the operational TZ.
 * UTC-midnight arithmetic sidesteps DST entirely — we are walking calendar
 * days, not converting between zones (the same trick app/(authed)/dashboard's
 * todayAndYesterday uses). Clamped at 0: a future anchor is not negative time.
 */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const from = Date.parse(`${fromYmd}T00:00:00Z`);
  const to = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Receiving tile (design §1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The subset of lib/receiving.ts `DeliveryView` this tile composes, plus the
 * caller-derived `missingEmail` flag (deriving it reads a clock, which must not
 * happen inside a pure compose or a render tree).
 */
export interface ReceivingDeliveryFacts {
  id: string;
  vendorName: string;
  /** YYYY-MM-DD — loadRecentDeliveries is NOT today-filtered, so we filter here. */
  deliveryDate: string;
  matchState: "counted_only" | "matched" | "discrepant" | "override";
  deliveryStatus: "in_progress" | "complete";
  receiptUrl: string | null;
  /** Pre-formatted arrival time (house formatTime), or null. */
  arrivedAt: string | null;
  missingEmail: boolean;
}

export interface ReceivingTileInput {
  deliveries: ReceivingDeliveryFacts[];
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
  /** Rows rendered before the "and N more" line. */
  cap?: number;
}

/** Default row cap — Juan-ratified at 3 (design §1). */
export const RECEIVING_ROW_CAP = 3;

/** Grace window before an unclaimed, never-attested delivery flags "missing email". */
export const MISSING_EMAIL_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * Deliveries that should flag "missing email": completed, no vendor claim on
 * file, never attested (still counted_only), older than the 48h grace window.
 * `nowMs` is INJECTED so this stays pure — the clock is read once by the caller.
 *
 * Extracted from app/(authed)/operations/receiving/page.tsx so the dashboard
 * tile and the receiving list apply ONE rule (they showed the same badge from
 * two copies otherwise).
 */
export function deriveMissingEmailIds(
  deliveries: Array<{
    id: string;
    deliveryStatus: "in_progress" | "complete";
    matchState: "counted_only" | "matched" | "discrepant" | "override";
    emailReceiptId: string | null;
    createdAt: string | null;
  }>,
  nowMs: number,
): Set<string> {
  const out = new Set<string>();
  for (const d of deliveries) {
    if (
      d.deliveryStatus === "complete" &&
      d.matchState === "counted_only" &&
      !d.emailReceiptId &&
      d.createdAt != null &&
      nowMs - Date.parse(d.createdAt) > MISSING_EMAIL_GRACE_MS
    ) {
      out.add(d.id);
    }
  }
  return out;
}

/** Badge pills for one delivery, in the receiving list's own order/vocabulary. */
function receivingBadges(d: ReceivingDeliveryFacts): StatusPill[] {
  const pills: StatusPill[] = [];
  if (d.deliveryStatus === "in_progress") {
    pills.push({ id: `${d.id}-progress`, key: "receiving.badge.in_progress", tone: "info" });
  }
  if (d.matchState === "discrepant") {
    pills.push({ id: `${d.id}-discrepant`, key: "receiving.badge.discrepant", tone: "danger" });
  }
  if (d.matchState === "override") {
    pills.push({ id: `${d.id}-override`, key: "receiving.badge.override", tone: "info" });
  }
  if (d.matchState === "matched") {
    // Attested clean — a GOOD state, kept for vocabulary parity with the
    // receiving list. Never counts toward isReceivingProblem.
    pills.push({ id: `${d.id}-matched`, key: "receiving.badge.matched", tone: "ok" });
  }
  if (d.receiptUrl === null) {
    pills.push({ id: `${d.id}-photo`, key: "receiving.badge.photo_missing", tone: "warn" });
  }
  if (d.missingEmail) {
    pills.push({ id: `${d.id}-email`, key: "receiving.badge.email_missing", tone: "warn" });
  }
  if (pills.length === 0) {
    // Nothing wrong: say so rather than rendering a bare row.
    pills.push({ id: `${d.id}-complete`, key: "dashboard.receiving.badge_complete", tone: "ok" });
  }
  return pills;
}

/** A delivery is a PROBLEM when any badge is a real alert (not the clean marker). */
function isReceivingProblem(d: ReceivingDeliveryFacts): boolean {
  return (
    d.deliveryStatus === "in_progress" ||
    d.matchState === "discrepant" ||
    d.receiptUrl === null ||
    d.missingEmail
  );
}

/**
 * Receiving as a per-truck mini-list. Leads with per-truck PROBLEMS (the design
 * grammar: the most urgent operational fact is the headline; everything handled
 * shrinks). Problems sort first, then the list caps.
 *
 * `loadRecentDeliveries` is NOT today-filtered (it orders by delivery_date desc
 * with a row limit), so today's set is filtered HERE against the operational
 * date the caller resolved.
 */
export function composeReceivingTile(input: ReceivingTileInput): TileViewModel {
  const cap = input.cap ?? RECEIVING_ROW_CAP;
  // NAMED CAP (no silent caps — lead ruling, 2026-08-19): the caller's list comes
  // from `loadRecentDeliveries`, a RECENT-ROWS WINDOW — 20 rows by default
  // (lib/receiving.ts), ordered delivery_date desc — not a today-scoped query.
  // Today's set is therefore only as complete as that window: if more than the
  // loader's limit of deliveries sit at or after today's date, the oldest of
  // today's trucks fall outside it and this filter cannot see them. At CO's volume
  // (a handful of trucks a day) the window covers today many times over; if that
  // ever stops holding, the fix is raising the LOADER's limit — never widening
  // this filter, which can only see what it was handed.
  const todays = input.deliveries.filter((d) => d.deliveryDate === input.today);

  if (todays.length === 0) {
    return {
      headline: { key: "dashboard.receiving.headline_none", form: "text", value: null, tone: "info" },
      pills: [],
      rows: [],
      overflowCount: 0,
      empty: true,
    };
  }

  // Problems first, then original loader order (newest first) within each class.
  const sorted = [...todays].sort((a, b) => Number(isReceivingProblem(b)) - Number(isReceivingProblem(a)));
  const problemCount = todays.filter(isReceivingProblem).length;

  const rows: StatusRow[] = sorted.slice(0, cap).map((d) => ({
    id: d.id,
    title: d.vendorName,
    meta: d.arrivedAt,
    pills: receivingBadges(d),
    problem: isReceivingProblem(d),
  }));

  return {
    headline:
      problemCount > 0
        ? {
            key: "dashboard.receiving.headline_problems",
            params: { count: problemCount },
            form: "text",
            value: null,
            tone: "danger",
          }
        : {
            key: "dashboard.receiving.headline_clean",
            params: { count: todays.length },
            form: "text",
            value: null,
            tone: "ok",
          },
    pills: [],
    rows,
    overflowCount: Math.max(0, sorted.length - rows.length),
    empty: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Counts tile (design §1)
// ─────────────────────────────────────────────────────────────────────────────

export interface CountsTileInput {
  /** ET calendar date of the most recent count event; null = NEVER counted. */
  lastCountDate: string | null;
  /** Today in the operational TZ (YYYY-MM-DD). */
  today: string;
  /** Distinct SKUs carrying a census anchor at this location. */
  anchoredSkuCount: number;
  /**
   * Flagged variances, or NULL when the calling surface cannot supply the term.
   * Variance is not persisted (see the plan's deviation D2) — a caller that has
   * not paid for the full drift math passes null and the pill is honestly absent.
   */
  varianceCount: number | null;
}

/** Days-since thresholds for the gauge's tone. The pressure is deliberate. */
export const COUNT_STALE_WARN_DAYS = 7;
export const COUNT_STALE_DANGER_DAYS = 14;

/**
 * Counts as a days-since gauge. Staleness IS the lead (design grammar).
 *
 * NEVER-COUNTED is the launch-day rendering: an em-dash, a start-your-first-count
 * pill, and a sub-line that is honest that on-hand runs on estimates until then.
 * We never invent a number for a count that has not happened.
 */
export function composeCountsTile(input: CountsTileInput): TileViewModel {
  if (input.lastCountDate == null) {
    return {
      headline: {
        key: "dashboard.counts.never_caption",
        form: "gauge",
        value: "—",
        tone: "info",
      },
      pills: [{ id: "first-count", key: "dashboard.counts.never_pill", tone: "warn" }],
      rows: [],
      overflowCount: 0,
      empty: true,
    };
  }

  const days = daysBetweenYmd(input.lastCountDate, input.today);
  const tone: StatusPillTone =
    days >= COUNT_STALE_DANGER_DAYS ? "danger" : days >= COUNT_STALE_WARN_DAYS ? "warn" : "ok";

  const pills: StatusPill[] = [];
  // Variance: rendered ONLY when supplied AND non-zero (zero variances is not a
  // finding worth a red pill; null is "we cannot say").
  if (input.varianceCount != null && input.varianceCount > 0) {
    pills.push({
      id: "variances",
      key: "dashboard.counts.pill_variances",
      params: { count: input.varianceCount },
      tone: "danger",
    });
  }
  if (input.anchoredSkuCount > 0) {
    pills.push({
      id: "anchored",
      key: "dashboard.counts.pill_anchored",
      params: { count: input.anchoredSkuCount },
      tone: "warn",
    });
  }

  return {
    headline: {
      key: "dashboard.counts.days_caption",
      form: "gauge",
      value: String(days),
      tone,
    },
    pills,
    rows: [],
    overflowCount: 0,
    empty: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ordering tile (design §1)
// ─────────────────────────────────────────────────────────────────────────────

/** One open vendor cutoff — the shape lib/ordering.ts `OrderingCutoffAttention` returns. */
export interface OrderingCutoffFacts {
  vendorId: string;
  vendorName: string;
  /** Already formatted by the loader via the house formatTime. */
  cutoffTime: string;
  hasDraft: boolean;
}

/** One of today's POs — the shape lib/purchase-orders.ts `TodaysOrderVendor` returns. */
export interface OrderingOrderFacts {
  poId: string;
  vendorName: string;
  /** Raw purchase_orders.status. */
  status: string;
}

export interface OrderingTileInput {
  /** Open cutoffs, EARLIEST FIRST — loadOrderingAttention already sorts; we do not re-sort. */
  openCutoffs: OrderingCutoffFacts[];
  orders: OrderingOrderFacts[];
}

/** PO status → its pill key + tone. Unknown statuses fall back to a neutral pill. */
const ORDER_STATUS_PILL: Record<string, { key: TranslationKey; tone: StatusPillTone }> = {
  draft: { key: "dashboard.ordering.pill_draft", tone: "warn" },
  confirmed: { key: "dashboard.ordering.pill_confirmed", tone: "ok" },
  placed: { key: "dashboard.ordering.pill_placed", tone: "ok" },
  invoiced: { key: "dashboard.ordering.pill_invoiced", tone: "ok" },
  received: { key: "dashboard.ordering.pill_received", tone: "ok" },
  reconciled: { key: "dashboard.ordering.pill_reconciled", tone: "ok" },
};

/**
 * Ordering as a cutoff-led tile. When a vendor cutoff is open today with no
 * order started, THE CUTOFF TIME IS THE HEADLINE (28px, red) — it is the only
 * fact on this dashboard with a hard deadline. Multiple open cutoffs: the
 * nearest leads, the others become red pills beside the handled ones.
 */
export function composeOrderingTile(input: OrderingTileInput): TileViewModel {
  const pills: StatusPill[] = [];

  // Every open cutoff BEYOND the nearest becomes a red pill.
  for (const c of input.openCutoffs.slice(1)) {
    pills.push({
      id: `cutoff-${c.vendorId}`,
      key: "dashboard.ordering.pill_cutoff",
      params: { vendor: c.vendorName, time: c.cutoffTime },
      tone: "danger",
    });
  }

  // Handled state shrinks to pills.
  for (const o of input.orders) {
    const mapped = ORDER_STATUS_PILL[o.status] ?? {
      key: "dashboard.ordering.pill_open" as TranslationKey,
      tone: "info" as StatusPillTone,
    };
    pills.push({
      id: `order-${o.poId}`,
      key: mapped.key,
      params: { vendor: o.vendorName },
      tone: mapped.tone,
    });
  }

  const nearest = input.openCutoffs[0];
  if (nearest) {
    return {
      headline: {
        key: "dashboard.ordering.headline_cutoff",
        params: { vendor: nearest.vendorName },
        form: "gauge",
        value: nearest.cutoffTime,
        tone: "danger",
      },
      pills,
      rows: [],
      overflowCount: 0,
      empty: false,
    };
  }

  if (input.orders.length > 0) {
    return {
      headline: {
        key: "dashboard.ordering.headline_all_in",
        params: { count: input.orders.length },
        form: "text",
        value: null,
        tone: "ok",
      },
      pills,
      rows: [],
      overflowCount: 0,
      empty: false,
    };
  }

  return {
    headline: { key: "dashboard.ordering.headline_none", form: "text", value: null, tone: "info" },
    pills: [],
    rows: [],
    overflowCount: 0,
    empty: true,
  };
}
