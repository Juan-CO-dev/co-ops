/**
 * V3-B §4 — the pure barcode laws at the receiving door.
 *
 * ZERO IMPORTS, BY DESIGN. Task 5 mounts this inside a client island (`ScanField`) and the
 * three scan routes use it on the server, so nothing here may reach for Node, the DOM, or
 * the database — it is arithmetic and in-memory state only. `lib/barcodes.ts` re-exports
 * this surface so server consumers keep one import path (the house `*-shared.ts` pattern).
 *
 * Four laws live here:
 *   `gtinCheckOk`         the GS1 mod-10 check digit
 *   `gs1Gtin`/`normalizeCode`  a scanned label → the manufacturer's GTIN, lot/weight/dates discarded
 *   `resolveScan`         line > sku > twin > unknown, disambiguated by the delivery's vendor
 *   `ScanBurst` / `dedupeCameraDecode`  one scan event = one unit, from a wedge or a camera
 */

export type Level = "case" | "inner";
export type Symbology = "ean_13" | "upc_a" | "code_128" | "gs1_128" | "itf_14" | "qr" | "unknown";
export interface NormalizedCode {
  code: string;
  symbology: Symbology;
  checkDigitOk: boolean | null;
}

/**
 * GTIN mod-10 check digit over the full string (the last digit IS the check digit).
 *
 * Weights run 3,1,3,1… from the RIGHTMOST body digit — anchored to the right-hand end, not
 * to the left. That anchoring is what makes the leading-zero fold in `normalizeCode` safe:
 * dropping a leading 0 from a GTIN-14 shifts no other digit's weight and removes a term
 * worth 0, so the 13-digit form carries the very same check digit.
 */
export function gtinCheckOk(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** FNC1 as a keyboard-wedge scanner actually delivers it: ASCII GS, 0x1D. */
const GS = "\u001d";

/**
 * Fixed-length two-digit AIs the walk steps over. 01/02 carry the GTIN and END the walk.
 * Anything absent from this table and from the measurement family below is variable-length
 * (10 lot, 21 serial, 37 count, 240 additional id …) and runs to the next FNC1.
 */
const FIXED_AI: Record<string, number> = {
  "00": 18, // SSCC
  "01": 14, // GTIN
  "02": 14, // GTIN of contained trade items
  "11": 6, // production date
  "12": 6, // due date
  "13": 6, // packaging date
  "15": 6, // best before
  "16": 6, // sell by
  "17": 6, // expiry
  "20": 2, // variant
};

/**
 * The measurement family. AIs 31nn–36nn are a FOUR-digit AI — the 4th digit is the implied
 * decimal place — followed by exactly 6 digits: net weight 310n, lengths 311n–316n,
 * imperial 320n–329n, logistic weights 330n–337n, logistic measures 340n–369n. Matching the
 * family beats hand-listing the half-dozen this door has happened to see, because a weighed
 * Boar's Head case prints 3102 today and 3103 the moment the packer changes precision.
 */
const MEASUREMENT_AI = /^3[1-6]\d\d$/;

/** Parse a GS1 element string (bracketed "(01)…" or FNC1/GS-separated) → the GTIN, or null. */
export function gs1Gtin(raw: string): string | null {
  const bracket = raw.match(/\((01|02)\)(\d{14})/);
  if (bracket) return bracket[2] ?? null;
  let s = raw.replace(/^\]C1/, ""); // the symbology identifier some readers prefix
  while (s.length) {
    const ai2 = s.slice(0, 2);
    if (ai2 === "01" || ai2 === "02") {
      const gtin = s.slice(2, 16);
      return /^\d{14}$/.test(gtin) ? gtin : null;
    }
    if (MEASUREMENT_AI.test(s.slice(0, 4))) {
      s = s.slice(4 + 6);
      continue;
    }
    const fixed = FIXED_AI[ai2];
    if (fixed != null) {
      s = s.slice(2 + fixed);
      continue;
    }
    const gs = s.indexOf(GS); // a variable-length AI runs to the next FNC1
    if (gs < 0) return null; // …and an unterminated one is a guess we decline to make
    s = s.slice(gs + 1);
  }
  return null;
}

/** Does this smell like a GS1 element string rather than a bare code? */
function looksGs1(s: string): boolean {
  return /[()]/.test(s) || s.startsWith("]C1") || s.includes(GS) || /^(01|02)\d{14}/.test(s);
}

export function normalizeCode(raw: string): NormalizedCode | null {
  const trimmed = raw.trim();
  if (trimmed.length < 6) return null;

  const gtin = looksGs1(trimmed) ? gs1Gtin(trimmed) : null;
  if (gtin) {
    const code = gtin.startsWith("0") && gtinCheckOk(gtin.slice(1)) ? gtin.slice(1) : gtin;
    return { code, symbology: "gs1_128", checkDigitOk: gtinCheckOk(gtin) };
  }

  // Strip the separators a human or a reader may inject, and never let a stray FNC1 reach
  // the stored code — `code` is a database key, not a transcript of the label.
  const compact = trimmed.replace(/[\s-]/g, "").split(GS).join("");
  if (/^\d+$/.test(compact)) {
    let code = compact;
    if (code.length === 14 && code.startsWith("0") && gtinCheckOk(code.slice(1))) code = code.slice(1);
    const ok = gtinCheckOk(code);
    const symbology: Symbology = !ok
      ? "unknown" // a reprinted label is a real object on the floor: keep it, flag it (§3)
      : code.length === 13
        ? "ean_13"
        : code.length === 12
          ? "upc_a"
          : code.length === 14
            ? "itf_14"
            : "unknown";
    return code.length < 6 ? null : { code, symbology, checkDigitOk: ok };
  }

  const upper = compact.toUpperCase();
  return upper.length < 6 ? null : { code: upper, symbology: "code_128", checkDigitOk: null };
}

export interface TaughtCode {
  code: string;
  skuId: string;
  vendorId: string;
  level: Level;
  productId: string | null;
}
export interface ScanContext {
  vendorId: string;
  lineSkuIds: readonly string[];
  taught: readonly TaughtCode[];
  vendorSkus: readonly { skuId: string; productId: string | null }[];
}
export type ScanMatch =
  | { kind: "line"; skuId: string; level: Level; levels: Level[]; ambiguous: boolean }
  | { kind: "sku"; skuId: string; level: Level; levels: Level[]; ambiguous: boolean }
  | { kind: "twin"; skuId: string; viaSkuId: string; level: Level; levels: Level[]; ambiguous: boolean }
  | { kind: "unknown" };

/** The levels a code was taught at, case first — case is the default a scan assumes. */
function levelsOf(rows: readonly TaughtCode[]): Level[] {
  return [...new Set(rows.map((r) => r.level))].sort((a, b) => (a === b ? 0 : a === "case" ? -1 : 1));
}

export function resolveScan(code: string, ctx: ScanContext): ScanMatch {
  const rows = ctx.taught.filter((t) => t.code === code);
  if (rows.length === 0) return { kind: "unknown" };

  const mine = rows.filter((t) => t.vendorId === ctx.vendorId);
  const skuIds = [...new Set(mine.map((t) => t.skuId))];
  // Two of THIS vendor's SKUs sharing a code is a data error, not a twin. Resolve it, and
  // say so — the UI shows the picker instead of auto-opening a line.
  const ambiguous = skuIds.length > 1;

  // (1) a SKU already on this delivery wins.
  const onLine = skuIds.find((id) => ctx.lineSkuIds.includes(id));
  if (onLine !== undefined) {
    const levels = levelsOf(mine.filter((t) => t.skuId === onLine));
    return { kind: "line", skuId: onLine, level: levels[0] ?? "case", levels, ambiguous };
  }

  // (2) any other SKU of this vendor; first by id, which is a stable pick, not an arbitrary one.
  const [ownSku] = [...skuIds].sort();
  if (ownSku !== undefined) {
    const levels = levelsOf(mine.filter((t) => t.skuId === ownSku));
    return { kind: "sku", skuId: ownSku, level: levels[0] ?? "case", levels, ambiguous };
  }

  // (3) taught only on another vendor's SKU whose product THIS vendor also carries.
  for (const row of rows) {
    if (!row.productId) continue;
    const twin = ctx.vendorSkus.find((s) => s.productId === row.productId);
    if (!twin) continue;
    const levels = levelsOf(rows.filter((r) => r.skuId === row.skuId));
    return { kind: "twin", skuId: twin.skuId, viaSkuId: row.skuId, level: levels[0] ?? "case", levels, ambiguous: false };
  }

  return { kind: "unknown" };
}

/**
 * Keyboard-wedge burst detector. Feed every keydown with a timestamp; call `tick(now)` from
 * a timer so a burst that ends in silence rather than Enter still lands.
 *
 * The swallow is PROVISIONAL. The first key of a scanner burst and the first key of a person
 * typing are indistinguishable — both arrive after an unbounded gap — so the machine buffers
 * and swallows, then hands the characters back through `tick` as `{ release }` when the burst
 * hypothesis dies. ScanField re-dispatches a release into the focused element, so nothing a
 * person typed is lost.
 */
export class ScanBurst {
  private buf = "";
  private last = -Infinity;

  constructor(private readonly o: { maxGapMs: number; minLength: number; silenceMs: number }) {}

  key(key: string, now: number): "swallow" | "pass" | { scan: string } {
    const gap = now - this.last;
    if (key === "Enter") {
      if (this.buf.length >= this.o.minLength && gap <= this.o.maxGapMs * 3) {
        const scan = this.buf;
        this.reset();
        return { scan };
      }
      this.reset();
      return "pass"; // a short or stale buffer was typing, and Enter belongs to the form
    }
    if (key.length !== 1) return "pass"; // Shift, Tab, arrows … never part of a code
    // THE ORDER MATTERS: judge the gap BEFORE deciding to swallow. A key slower than
    // maxGapMs proves the buffer was a person typing, so that hypothesis dies here and this
    // key starts a fresh, provisional one.
    if (this.buf && gap > this.o.maxGapMs) this.reset();
    this.buf += key;
    this.last = now;
    return "swallow";
  }

  /** Releases a stalled short buffer as typing, or emits a silence-terminated scan. */
  tick(now: number): { scan: string } | { release: string } | null {
    if (!this.buf || now - this.last < this.o.silenceMs) return null;
    const buf = this.buf;
    this.reset();
    return buf.length >= this.o.minLength ? { scan: buf } : { release: buf };
  }

  private reset() {
    this.buf = "";
    this.last = -Infinity;
  }
}

/**
 * Camera keep-scanning mode: the same code held in frame is ONE event until it leaves the
 * frame or `holdMs` passes — so a label resting on the counter does not rack up phantom units.
 */
export function dedupeCameraDecode(holdMs: number) {
  const seenAt = new Map<string, number>();
  return {
    decode(code: string, now: number): boolean {
      const at = seenAt.get(code);
      if (at != null && now - at < holdMs) return false;
      seenAt.set(code, now);
      return true;
    },
    frameWithout(code: string, now: number) {
      seenAt.delete(code);
      // A long keep-scanning session should not grow this map without bound.
      for (const [seen, at] of seenAt) if (now - at > holdMs) seenAt.delete(seen);
    },
  };
}
