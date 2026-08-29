/**
 * Door-ceremony math — PURE (client-safe, zero I/O, no server imports;
 * fully unit-testable). The `*-shared.ts` pattern (AGENTS.md): the receiving
 * server lib and its vitest suite both import from here.
 *
 * Credit derivation follows spec D1: the intake's recorded unit_price is the
 * price authority for vendor credit amounts — never a live catalogue lookup.
 * qty is in level units (cases, packs, each — whatever the delivery line
 * carries); null qty means the full line is in question and a human judgment
 * call is required before submitting the credit claim.
 *
 * Dedupe identity for a whole delivery = (vendor, location, date, lower(invoice)),
 * enforced by the partial unique index vendor_deliveries_dedupe_uq (migration 0169).
 * Null-invoice deliveries are INTENTIONALLY exempt (same-day COD / no-invoice drops
 * are legitimate). The old string-key helper (dedupeKey) was never called in
 * production — the real dedupe is the app-level select guard + that index — so it
 * was removed. isDuplicateAppend (below) is the separate line-append double-submit
 * guard for addDeliveryLines.
 *
 * Everything returns null rather than guessing when an input is missing:
 * a null amount is an advisory, never a fabricated number.
 */

export interface IntakeLineForCredits {
  deliveryItemId: string;
  skuId: string;
  qtyReceived: number;
  expectedQty: number | null;
  unitPrice: number | null;
  discrepancyType: "short" | "over" | "damaged" | "substitution" | null;
}

export interface CreditDraft {
  deliveryItemId: string;
  skuId: string;
  reason: "short" | "over" | "damaged" | "substitution";
  qty: number | null;          // level units; null = whole-line judgment call
  amountCents: number | null;  // qty * intake unit_price; intake price is price authority (spec D1)
}

export function deriveCreditDrafts(lines: IntakeLineForCredits[]): CreditDraft[] {
  const out: CreditDraft[] = [];
  for (const l of lines) {
    if (!l.discrepancyType) continue;
    let qty: number | null = null;
    if (l.expectedQty != null) {
      const delta =
        l.discrepancyType === "over"
          ? l.qtyReceived - l.expectedQty
          : l.expectedQty - l.qtyReceived;
      qty = delta > 0 ? delta : null;
    }
    const amountCents =
      qty != null && l.unitPrice != null
        ? Math.round(qty * l.unitPrice * 100)
        : null;
    out.push({
      deliveryItemId: l.deliveryItemId,
      skuId: l.skuId,
      reason: l.discrepancyType,
      qty,
      amountCents,
    });
  }
  return out;
}

/**
 * An EXPECTED item that never arrived — the door's missing-item honesty gate.
 *
 * WHY THIS EXISTS AS A SEPARATE SHAPE (constraint, verified 2026-08-10): a fully
 * missing item CANNOT be represented as a delivery line. `vendor_delivery_items`
 * carries `check (qty_received > 0)` (migration 0100) and
 * validateAndResolveDeliveryLines rejects `qtyReceived <= 0` (400 invalid_qty), so
 * there is no way to persist "expected 4, received 0". The credit is therefore filed
 * LINE-LESS: `vendor_credits.delivery_item_id` is nullable (0168) and `delivery_id`
 * points at the delivery that DID arrive — which is precisely the evidence that the
 * truck came and this item was not on it.
 *
 * `unitPrice` is the operator-entered intake price when one was typed, else null —
 * same price authority as the lined path (spec D1), never a catalogue lookup.
 */
export interface MissingExpectedLine {
  skuId: string;
  /** Level-unit qty the PO ordered. Always > 0 (a 0-qty PO line is a removed line). */
  expectedQty: number;
  unitPrice: number | null;
}

/**
 * Credit drafts for expected-but-never-delivered items. Delegates ALL money/qty math
 * to deriveCreditDrafts with qtyReceived 0 — so the line-less path and the lined path
 * can never drift: qty = expectedQty − 0 = expectedQty, amountCents = qty × unitPrice
 * (null when no price was entered; a null amount is an advisory, never a fabricated
 * number). `deliveryItemId` is "" here and is IGNORED by the caller, which writes NULL
 * into the nullable column — these drafts have no line to point at, by construction.
 */
export function deriveMissingCreditDrafts(lines: MissingExpectedLine[]): CreditDraft[] {
  return deriveCreditDrafts(
    lines.map((l) => ({
      deliveryItemId: "",
      skuId: l.skuId,
      qtyReceived: 0,
      expectedQty: l.expectedQty,
      unitPrice: l.unitPrice,
      discrepancyType: "short" as const,
    })),
  );
}

// ── Vendor binding: a receipt line belongs to the truck that delivered it ──────
//
// MULTI-VENDOR AUDIT P3 (docs/audits/2026-08-20-multivendor-semantics-audit.md).
// Under Juan's ratified doctrine the same product carries a SEPARATE SKU per vendor
// ("Ham" at Baldor and "Ham" at PFG are two independent rows). The receiving UI scopes
// its picker to the delivering vendor, but that is BROWSER-side only — the server
// accepted any skuId. A cross-vendor line therefore wrote unit_price into
// vendor_price_history and folded avg_oz_per_each onto the WRONG twin: the vendor whose
// truck never came gets a price history it never quoted, and costing reads it as real.
//
// NULL-TOLERANT BY DESIGN (verified live 2026-08-20): vendor_items.vendor_id is nullable
// and 11 ACTIVE SKUs carry NULL (Sub Roll, Mortadella, Utz Ripples, Pepperoncini, …).
// Those are unassigned, not "owned by someone else" — they are receivable against any
// vendor today, and rejecting them would make real ingredients un-receivable at the door.
// So the rule is: reject only when the SKU NAMES a vendor and it is a DIFFERENT one.
// The DB floor (migration 0178) mirrors this exact tolerance via MATCH SIMPLE composite
// FKs, so the two layers agree instead of one silently being stricter than the other.

/** The minimal SKU shape the vendor-binding check reads. */
export interface SkuVendorBinding {
  id: string;
  vendorId: string | null;
}

/**
 * First SKU in `skus` that belongs to a vendor OTHER than `deliveryVendorId`, or null
 * when every line is bindable. Pure. A SKU with a null vendorId is UNASSIGNED and always
 * passes (see the null-tolerance note above); a null/empty `deliveryVendorId` disables
 * the check entirely (nothing to bind to — never invent a mismatch).
 */
export function findVendorMismatch(
  deliveryVendorId: string | null | undefined,
  skus: readonly SkuVendorBinding[],
): SkuVendorBinding | null {
  if (!deliveryVendorId) return null;
  for (const s of skus) {
    if (s.vendorId != null && s.vendorId !== deliveryVendorId) return s;
  }
  return null;
}

/** A single line as it lands in a delivery-append batch (identity tuple only). */
export interface AppendLine {
  skuId: string;
  level: string | null;
  qty: number;
}

/**
 * Double-submit guard for addDeliveryLines: is `incoming` an EXACT multiset match of
 * some `recent` batch already appended in the last window? Compares on the identity
 * tuple (skuId, level ?? null, qty) as a MULTISET — same tuples AND same per-tuple
 * counts. Returns true only on an exact match (a network retry / double-tap re-sends
 * the identical batch); a differing qty, a subset, a superset, or an empty recent
 * window → false (a legitimately different append proceeds).
 *
 * NOTE: this is a pragmatic 60s window guard for P1 (no UI drives the append route
 * yet — continue-mode is deferred). A proper client-supplied idempotency token ships
 * with the continue-mode UI; this guard retires when that lands.
 */
export function isDuplicateAppend(incoming: AppendLine[], recent: AppendLine[]): boolean {
  if (incoming.length === 0 || recent.length === 0) return false;
  if (incoming.length !== recent.length) return false;
  const key = (l: AppendLine) => `${l.skuId}|${l.level ?? ""}|${l.qty}`;
  const counts = new Map<string, number>();
  for (const l of recent) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);
  for (const l of incoming) {
    const k = key(l);
    const c = counts.get(k);
    if (!c) return false; // a tuple in incoming not present (or over-consumed) in recent
    counts.set(k, c - 1);
  }
  return true; // exact multiset match (equal lengths + every incoming tuple consumed)
}

// ── Offline intake drafts: the per-location draft SHELF ────────────────────────
//
// One localStorage key per location holds a LIST of drafts, not a single slot. The
// single slot was a data-loss bug at the door: two trucks in the same hour (the produce
// drop while the paper-goods drop is half-counted) wrote the same key, and the second
// intake silently overwrote the first.
//
// Identity is (vendorId, startedAt) — the same vendor can legitimately be re-counted on
// a later day, and startedAt is what distinguishes those. But a LIVE intake must not
// spawn a new entry on every debounce tick, so the write rule is replace-by-VENDOR:
// one shelf slot per vendor, holding that vendor's most recent draft.
//
// Newest-first, capped — the shelf is a short-term convenience, not an archive, and an
// unbounded list on a shared door tablet is just a slow leak.

/** The identity every stored draft carries. The component's draft shape extends it. */
export interface IntakeDraftIdentity {
  vendorId: string;
  /** ISO timestamp of when THIS intake session began (stable across saves). */
  startedAt: string;
}

/** Max drafts kept per location. Three = two trucks plus one straggler. */
export const INTAKE_DRAFT_CAP = 3;

/**
 * Put `draft` at the head of the shelf, replacing any entry for the SAME vendor, and
 * trim to `cap`. Pure: returns a new array, never mutates the input.
 */
export function upsertIntakeDraft<T extends IntakeDraftIdentity>(
  shelf: readonly T[],
  draft: T,
  cap: number = INTAKE_DRAFT_CAP,
): T[] {
  const rest = shelf.filter((d) => d.vendorId !== draft.vendorId);
  return [draft, ...rest].slice(0, Math.max(0, cap));
}

/** Drop one entry by its full identity. Pure; a non-match returns an equal shelf. */
export function removeIntakeDraft<T extends IntakeDraftIdentity>(
  shelf: readonly T[],
  vendorId: string,
  startedAt: string,
): T[] {
  return shelf.filter((d) => !(d.vendorId === vendorId && d.startedAt === startedAt));
}

// ── THE avg_oz_per_each FOLD POLICY: what a delivery observation may overwrite ─
//
// Receiving folds a line's observed oz/each into `vendor_items.avg_oz_per_each`
// (the A2 refinement, council L8). TWO genuinely different questions gate that
// write, which is why they resolve in ONE ordered decision here instead of two
// scattered checks at the call site:
//
//   1. WHICH CONTAINER does the number denominate? A chained SKU's observation is
//      level-scoped and belongs on the line — folding it would corrupt the
//      count/volume leaf the chain resolves through. That gate shipped with 0160.
//   2. WHOSE NUMBER IS ALREADY THERE? Migration 0179 added the provenance quartet
//      (weight_class / weight_source_note / weight_established_at / _by) and the
//      weigh session (`lib/weights.ts`, floor WEIGHT_WRITE_MIN = 7) writes all
//      four together when a GM puts a case on a scale. Receiving's floor is
//      RECEIVE_MIN = 4, and the fold used to write `avg_oz_per_each` while
//      touching NONE of the quartet — so a key-holder's rolling delivery average
//      silently replaced a GM's scale reading while the weight board went on
//      rendering the GM's name, the GM's date and "scale reading" over it. Worse,
//      the one advisory built to show that disagreement (`InvoiceDrift` =
//      observed − believed) collapsed to exactly 0, because the believed number
//      had just been overwritten WITH the observed mean.
//
// THE RULE IS THE ONE `disposeTub` ALREADY STATES for scale readings
// (`lib/tub-weights.ts` → CONFLICT_PRESENT_ONLY): a reading that contradicts a
// weight OUR OWN scale produced is PRESENTED, never written. Skipping the fold
// loses no information — it is precisely what lets the drift advisory speak.
//
// WRITABLE IS AN ALLOW-LIST, NOT `!isMeasuredWeightClass(...)`, and the asymmetry
// is deliberate. That predicate answers "has a scale produced this?", and it gives
// an unrecognised term `false` because an unknown term has not EARNED the measured
// claim. Here the question is the opposite one — may we OVERWRITE it — so an
// unrecognised term is PROTECTED rather than folded: a class this build has never
// heard of is not a class it may overrule. `INVOICE_DERIVED` is on the list
// because this fold is what MAINTAINS it ("refreshed as new invoices land" —
// WEIGHT_CLASS_MEANING / HERB_WEIGHT_POLICY, `lib/angel-wave4.ts`); `SPEC` and
// `ESTIMATE` are on it because an invoice average outranks a label and a guess
// (WEIGHT_CLASS_RANK); `null` is on it because an unexplained number gains a story.

/** What receiving is allowed to do with one observed oz/each, and why. */
export type AvgFoldDisposition =
  /** Write the mean AND stamp the provenance quartet that explains it. */
  | "FOLD"
  /** The SKU has an active pack chain — the observation stays level-scoped. */
  | "SKIP_CHAINED"
  /** A class receiving may not overrule stands on the row. Present, never write. */
  | "SKIP_PROTECTED_CLASS";

/**
 * The `weight_class` values a delivery fold may overwrite. A NULL class is writable
 * too and is handled separately below (a set cannot hold "the absence of a value"
 * without a sentinel, and a sentinel is the silent-wrong-number trap 0161 named).
 * Everything absent from this list — `OPERATIONAL` today, plus any term a later
 * wave mints — is PROTECTED.
 */
export const AVG_FOLD_WRITABLE_CLASSES: readonly string[] = ["SPEC", "ESTIMATE", "INVOICE_DERIVED"];

/**
 * The class a fold WRITES. An average of what the vendor actually delivered is the
 * textbook definition of `INVOICE_DERIVED` (`lib/angel-wave4.ts`), so the fold
 * claims that and nothing stronger — never `OPERATIONAL`, which means a scale here.
 */
export const AVG_FOLD_WEIGHT_CLASS = "INVOICE_DERIVED";

/**
 * Which of the three outcomes one observed SKU gets. PURE, and THE ORDER OF THE
 * CHECKS IS THE POLICY — chain first, because "this number denominates a different
 * container" is a stronger objection than "this number came from somebody else":
 * a chained SKU is skipped no matter what class it carries, and no class ever
 * unlocks a chained fold.
 */
export function disposeAvgFold(input: {
  chained: boolean;
  liveWeightClass: string | null;
}): AvgFoldDisposition {
  if (input.chained) return "SKIP_CHAINED";
  if (input.liveWeightClass == null) return "FOLD";
  return AVG_FOLD_WRITABLE_CLASSES.includes(input.liveWeightClass) ? "FOLD" : "SKIP_PROTECTED_CLASS";
}

/**
 * The `weight_source_note` a fold leaves behind. It names the mechanism and the
 * sample size, because the board renders this string as the answer to "where did
 * this number come from" and "a delivery average" without an N is not an answer.
 */
export function avgFoldSourceNote(sampleCount: number): string {
  return (
    `Delivery-observation fold: mean of ${sampleCount} observed oz/each recorded on ` +
    `intake lines (lib/receiving.ts A2). Refreshed as new invoices land; a scale ` +
    `reading (weigh session) supersedes it and is never overwritten by this fold.`
  );
}
