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

import { buildPackChain, chainRootLabel, type PackChainLevel } from "@/lib/pack-chain-shared";

/** Price entered at the received level -> price of one root pack. Structural
 * conversion does not need a guessed weight for a volume/count leaf. */
export function storeRootPackPrice(price: number, receivedLevel: string | null,
  levels: PackChainLevel[] | null, rootLabel: string | null): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const label = receivedLevel?.trim() || null;
  if (!levels?.length) return label == null || label === rootLabel ? price : null;
  const chain = buildPackChain(levels);
  const root = chainRootLabel(chain);
  if (root == null) return null;
  let current = chain.byLabel.get(root);
  let multiplier = 1;
  const seen = new Set<string>();
  let converted: number | null = null;
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    if (current.label === (label ?? root)) {
      const result = price * multiplier;
      converted = Number.isFinite(result) ? result : null;
    }
    if (!Number.isFinite(current.containsQty) || current.containsQty <= 0) return null;
    if (!current.containsLevelId) return current.containsMeasureUnit && seen.size === levels.length ? converted : null;
    multiplier *= current.containsQty;
    current = chain.byId.get(current.containsLevelId);
  }
  return null;
}

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
 * passes for ordinary vendors (see the null-tolerance note above). Store runs
 * require their own materialized SKU, even for vendorless references, so their
 * prices cannot leak onto a shared singleton. A null/empty `deliveryVendorId` disables
 * the check entirely (nothing to bind to — never invent a mismatch).
 */
export function findVendorMismatch(
  deliveryVendorId: string | null | undefined,
  skus: readonly SkuVendorBinding[],
  sourceKind: "vendor" | "store" = "vendor",
): SkuVendorBinding | null {
  if (!deliveryVendorId) return null;
  for (const s of skus) {
    if ((sourceKind === "store" || s.vendorId != null) && s.vendorId !== deliveryVendorId) return s;
  }
  return null;
}

/** Preserve the ordinary receipt row exactly; store prices belong only to the
 * already validated store SKU, never to the reference selected in the picker. */
export function receivingPriceRows(
  lines: readonly { skuId: string; unitPrice?: number | null }[],
  effectiveDate: string,
  recordedBy: string,
  sourceKind: "vendor" | "store",
) {
  return lines.filter((line) => line.unitPrice != null).map((line) => ({
    vendor_item_id: line.skuId,
    unit_price: line.unitPrice,
    effective_date: effectiveDate,
    recorded_by: recordedBy,
    ...(sourceKind === "store" ? { source: "store_run" } : {}),
  }));
}

/**
 * Are two invoice numbers the same delivery identity (W20/B198)? Exact apart from case and
 * outer spaces: the key of the 0169 unique index, lower(invoice_number). Never a pattern, so
 * "INV_1001" is not "INV-1001". An empty or missing number is never a duplicate (no-invoice
 * drops are exempt from the index too).
 */
export function sameInvoiceNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a?.trim().toLowerCase() ?? "";
  const y = b?.trim().toLowerCase() ?? "";
  return x !== "" && x === y;
}

// ── W20/B197: one shape check for both intake routes, and one credit rule for both write paths ──

/**
 * The database function this call names is not installed yet: PostgREST's schema-cache miss
 * (PGRST202) or Postgres's undefined function (42883). That, and only that, is what "migration
 * 0327 is not applied yet" looks like; every 0327 caller falls back to its previous path on it.
 */
export function rpcNotInstalled(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

/** The table this read names is not installed yet (PostgREST PGRST205, Postgres 42P01): what
 *  "0327 is not applied" looks like for delivery_receipt_unlinks. Nothing can have been unlinked. */
export function tableNotInstalled(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table/i.test(error.message ?? "");
}

export type DeliveryDiscrepancy = "short" | "over" | "damaged" | "substitution";
const DELIVERY_DISCREPANCIES: ReadonlySet<string> = new Set(["short", "over", "damaged", "substitution"]);
const LINE_SKU_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One delivery line as the intake routes accept it: every optional field present, null when absent. */
export interface ParsedDeliveryLine {
  skuId: string;
  qtyReceived: number;
  unitPrice: number | null;
  observedOzPerEach: number | null;
  notes: string | null;
  receivedLevelLabel: string | null;
  photoUrl: string | null;
  expectedQty: number | null;
  discrepancyType: DeliveryDiscrepancy | null;
}

/**
 * Shape-check the `lines` array of an intake request (the client is untrusted). Used by BOTH
 * routes, so a malformed line is a 400 naming the field BEFORE any write. The create route used
 * to skip this: `discrepancyType: "bogus"` or `notes: 123` got past it, the delivery header was
 * inserted, the line insert then failed, and the lineless header blocked the retry (B197).
 * Value rules (qty > 0, price > 0, the SKU is active, the photo is this shop's) stay in the lib.
 */
export function parseDeliveryLineInputs(raw: unknown): { ok: true; lines: ParsedDeliveryLine[] } | { ok: false; field: string } {
  if (!Array.isArray(raw)) return { ok: false, field: "lines" };
  const optional = <T>(value: unknown, type: "number" | "string"): T | null | undefined =>
    value === null || value === undefined ? null : typeof value === type ? (value as T) : undefined;
  const lines: ParsedDeliveryLine[] = [];
  for (const item of raw as unknown[]) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return { ok: false, field: "lines" };
    const r = item as Record<string, unknown>;
    if (typeof r.skuId !== "string" || !LINE_SKU_UUID.test(r.skuId)) return { ok: false, field: "lines[].skuId" };
    if (typeof r.qtyReceived !== "number") return { ok: false, field: "lines[].qtyReceived" };
    const unitPrice = optional<number>(r.unitPrice, "number");
    if (unitPrice === undefined) return { ok: false, field: "lines[].unitPrice" };
    const observedOzPerEach = optional<number>(r.observedOzPerEach, "number");
    if (observedOzPerEach === undefined) return { ok: false, field: "lines[].observedOzPerEach" };
    const notes = optional<string>(r.notes, "string");
    if (notes === undefined) return { ok: false, field: "lines[].notes" };
    const receivedLevelLabel = optional<string>(r.receivedLevelLabel, "string");
    if (receivedLevelLabel === undefined) return { ok: false, field: "lines[].receivedLevelLabel" };
    const photoUrl = optional<string>(r.photoUrl, "string");
    if (photoUrl === undefined) return { ok: false, field: "lines[].photoUrl" };
    const expectedQty = optional<number>(r.expectedQty, "number");
    if (expectedQty === undefined) return { ok: false, field: "lines[].expectedQty" };
    const flag = optional<string>(r.discrepancyType, "string");
    if (flag === undefined || (flag !== null && !DELIVERY_DISCREPANCIES.has(flag))) return { ok: false, field: "lines[].discrepancyType" };
    lines.push({ skuId: r.skuId, qtyReceived: r.qtyReceived, unitPrice, observedOzPerEach, notes, receivedLevelLabel, photoUrl,
      expectedQty, discrepancyType: flag as DeliveryDiscrepancy | null });
  }
  return { ok: true, lines };
}

/** What a flagged line contributes to credit derivation, whichever side it is read from. */
export interface LineCreditSource {
  /** The line's id once it exists; before the write, its 1-based position in the batch. */
  deliveryItemId: string;
  skuId: string;
  /** Level-unit qty: received_qty_at_level when a level was named, else qty_received. */
  qtyReceived: number;
  expectedQty: number | null;
  /** The intake line's own unit_price (per ROOT pack for a vendor line, per level for a store run). */
  unitPrice: number | null;
  discrepancyType: DeliveryDiscrepancy | null;
  receivedLevelLabel: string | null;
}

/**
 * THE credit rule for delivery lines (W04/B046 pricing included): only flagged lines, each priced
 * per the level it was received at (creditUnitPrice), then deriveCreditDrafts. ONE function for
 * the two places a delivery's lined credits are derived: from the lines read back after an append
 * (deriveAndUpsertCredits) and from the request's own lines when a NEW delivery is written in one
 * transaction (recordDelivery, W20/B197). They cannot drift, because there is nothing to copy.
 */
export function deriveLineCreditDrafts(
  lines: readonly LineCreditSource[],
  ctx: { chains: ReadonlyMap<string, PackChainLevel[]>; packFormat: ReadonlyMap<string, string | null>; store: boolean },
): CreditDraft[] {
  return deriveCreditDrafts(lines.filter((l) => l.discrepancyType != null).map((l) => ({
    deliveryItemId: l.deliveryItemId,
    skuId: l.skuId,
    qtyReceived: l.qtyReceived,
    expectedQty: l.expectedQty,
    unitPrice: creditUnitPrice(l.unitPrice, l.receivedLevelLabel, ctx.chains.get(l.skuId) ?? null, ctx.packFormat.get(l.skuId) ?? null, ctx.store),
    discrepancyType: l.discrepancyType,
  })));
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
 *
 * It compares with ONE batch. addDeliveryLines calls it per earlier append through
 * isDuplicateOfAnyBatch (W20/B199), never with the union of every line in the window.
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

/** A recently written line with the instant its insert stamped on it. */
export interface DatedAppendLine extends AppendLine {
  createdAt: string;
}

/** How long after the delivery header its CREATION lines can land (the two-step write that
 *  predates migration 0327 inserts them a moment later; one transaction stamps the same instant). */
export const CREATION_BATCH_SLACK_MS = 5_000;

/**
 * Split recently written lines into the APPENDS that wrote them, leaving out the lines the
 * delivery was created with (W20/B199). `vendor_delivery_items.created_at` defaults to now(), the
 * statement's transaction time, so every line of one insert carries one instant: equal
 * `createdAt` = one batch. The creation batch is the delivery's FIRST line instant, when it sits
 * at (or just after) the header's own instant. A delivery whose first lines came later (an
 * in-progress delivery saved empty) has no creation batch among its lines: they were an append.
 * Batches come back oldest first; timestamps are compared as the API returned them.
 */
export function priorAppendBatches(
  recent: readonly DatedAppendLine[],
  creation: { headerCreatedAt: string | null; firstLineCreatedAt: string | null },
): AppendLine[][] {
  const header = creation.headerCreatedAt == null ? Number.NaN : Date.parse(creation.headerCreatedAt);
  const first = creation.firstLineCreatedAt == null ? Number.NaN : Date.parse(creation.firstLineCreatedAt);
  const creationInstant = Number.isFinite(header) && Number.isFinite(first) && first - header >= 0 && first - header <= CREATION_BATCH_SLACK_MS
    ? creation.firstLineCreatedAt : null;
  const batches = new Map<string, AppendLine[]>();
  for (const line of [...recent].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
    if (line.createdAt === creationInstant) continue;
    const batch = batches.get(line.createdAt) ?? [];
    batch.push({ skuId: line.skuId, level: line.level, qty: line.qty });
    batches.set(line.createdAt, batch);
  }
  return [...batches.values()];
}

/**
 * Is `incoming` an exact repeat of ONE earlier append (W20/B199)? The guard used to compare with
 * the union of everything written in the window, which was wrong both ways: it refused a real
 * second pallet identical to the creation lines, and it missed a repeat of append A once a
 * different append B had followed it.
 */
export function isDuplicateOfAnyBatch(incoming: AppendLine[], batches: readonly AppendLine[][]): boolean {
  return batches.some((batch) => isDuplicateAppend(incoming, batch));
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

// ── The door's price entry (the price feed) ────────────────────────────────────────
//
// A non-null `unitPrice` on a delivery line is the ONE trigger that writes
// `vendor_price_history` (lib/receiving.ts:522 recordDelivery, :1150 addDeliveryLines).
// Everything below is the CLIENT-side reading of the raw string an operator typed into
// the door form, kept pure here so both the collapsed price strip and its tests read the
// same rule the server enforces.
//
// THE SERVER'S RULE IS THE ONE THIS MIRRORS, and it is not `>= 0`:
// validateAndResolveDeliveryLines (lib/receiving.ts:712) throws 400 `invalid_price` for
// any price that is not finite AND > 0. So "0" is a REFUSAL, not a free item — a $0 line
// would land in the price ledger as a real observation and then flow out through
// lib/purchase-orders.ts's `price_cents_at_order` as the vendor's price. The door says so
// inline rather than letting the whole delivery bounce on a round trip.

/** How the door reads one raw price string. `empty` is the ordinary state — a blank
 *  price is never an error, because pricing a line is optional at the door. */
export type PriceEntryState = "empty" | "ok" | "invalid";

/** Pure read of the operator's raw price text. Whitespace-only is `empty` (the field was
 *  touched and left blank, which is the same as never touched). */
export function priceEntryState(raw: string): PriceEntryState {
  const v = raw.trim();
  if (v === "") return "empty";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "invalid";
  return "ok";
}

/**
 * What (if anything) the collapsed price strip must SAY about this line. Two honest
 * failures, and neither may be silent:
 *
 *  • `invalid` — a value the server will refuse (0, negative, non-numeric). Named here so
 *    the operator fixes it at the row instead of discovering it as a 400 on the whole
 *    delivery.
 *  • `not_counted` — a price typed on a line carrying NO quantity. `readyLines` drops such
 *    a line from the submit payload entirely (ReceivingForm: skuId set + qty > 0), so the
 *    price goes with it. That is correct — a price with no receipt is not an observation —
 *    but it must be STATED, because the operator typed a number and watched it vanish.
 *    This is the same posture as the missing-item honesty gate: not a block, a sentence.
 *
 * `invalid` outranks `not_counted`: a malformed value is wrong whatever the qty is, and
 * fixing it is the errand the operator can act on immediately.
 */
export type CollapsedPriceNotice = null | "invalid" | "not_counted";

export function collapsedPriceNotice(rawPrice: string, hasQty: boolean): CollapsedPriceNotice {
  const state = priceEntryState(rawPrice);
  if (state === "invalid") return "invalid";
  if (state === "ok" && !hasQty) return "not_counted";
  return null;
}

/** How many of these lines carry a price the server will accept. Drives the door's
 *  AGGREGATE "N priced" readout — the one signal that survives the price strip being
 *  hidden, so a priced line is never invisible. */
export function pricedLineCount(lines: ReadonlyArray<{ unitPrice: string }>): number {
  return lines.filter((l) => priceEntryState(l.unitPrice) === "ok").length;
}

// ── W08/B162: delivery photo references ────────────────────────────────────────

const PHOTO_REF_RE = /^\/api\/photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * A receipt / line photo reference as the intake routes receive it. The column contract (0164) is
 * the canonical `/api/photos/<photo id>` the shipped form writes; anything else (an external URL, a
 * protocol-relative `//host`, a query string, a non-UUID id, a non-string) is refused rather than
 * stored as a link other staff would click. null / undefined / "" (after trim) mean "no photo".
 */
export function photoIdFromRef(ref: unknown): { ok: true; photoId: string | null } | { ok: false } {
  if (ref === null || ref === undefined) return { ok: true, photoId: null };
  if (typeof ref !== "string") return { ok: false };
  const trimmed = ref.trim();
  if (trimmed === "") return { ok: true, photoId: null };
  const m = PHOTO_REF_RE.exec(trimmed);
  return m ? { ok: true, photoId: m[1]!.toLowerCase() } : { ok: false };
}

/**
 * Units of `to` inside ONE `from`, through a chain given in walk order (root → leaf):
 * `labels[i]` holds `counts[i]` of `labels[i + 1]` (W04/B046). An empty label means the root
 * pack (the legacy no-level rule). Null when either label is not on the chain or the counts
 * do not describe it — never a guess.
 */
export function levelMultiplier(labels: readonly string[], counts: readonly number[], from: string, to: string): number | null {
  if (labels.length === 0 || counts.length !== labels.length - 1) return null;
  if (counts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  const at = (label: string) => (label.trim() === "" ? 0 : labels.indexOf(label.trim()));
  const i = at(from), j = at(to);
  if (i < 0 || j < 0) return null;
  let m = 1;
  for (let k = Math.min(i, j); k < Math.max(i, j); k++) m *= counts[k]!;
  return i <= j ? m : 1 / m;
}

/**
 * The patch for a level change on a door row (W04/B046). A PO/template row's `expectedQty` is in
 * the level it was seeded at, so switching cases → each must rescale it (2 cases → 24 each), or
 * the short/over suggestion and the credit compare a case count to an each count. When the two
 * levels cannot be converted, the expectation and any flag are cleared rather than left in the
 * wrong unit.
 */
export function levelChangePatch(
  line: { level: string; expectedQty: number | null; discrepancy: "short" | "over" | "damaged" | "substitution" | null },
  nextLevel: string,
  labels: readonly string[],
  counts: readonly number[],
): { level: string; expectedQty?: number | null; discrepancy?: null } {
  if (line.expectedQty == null || nextLevel === line.level) return { level: nextLevel };
  const m = levelMultiplier(labels, counts, line.level, nextLevel);
  if (m == null) return { level: nextLevel, expectedQty: null, discrepancy: null };
  return { level: nextLevel, expectedQty: Math.round(line.expectedQty * m * 1e6) / 1e6 };
}

/**
 * A vendor line's price is per ROOT pack ("Price/pack"); a discrepancy on a line received at an
 * inner level counts inner units, so its credit price is the root price over the units per root
 * (W04/B046). A store line is already priced per level. Null when the level cannot be placed on
 * the chain: the credit amount is then a judgment call, never a wrong number.
 */
export function creditUnitPrice(unitPrice: number | null, receivedLevel: string | null,
  levels: PackChainLevel[] | null, rootLabel: string | null, store: boolean): number | null {
  if (unitPrice == null || store) return unitPrice;
  const label = receivedLevel?.trim() || null;
  if (label == null) return unitPrice;
  const perRoot = storeRootPackPrice(1, label, levels, rootLabel);
  return perRoot == null || perRoot <= 0 ? null : unitPrice / perRoot;
}
