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
