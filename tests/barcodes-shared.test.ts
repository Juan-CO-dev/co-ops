/**
 * V3-B §4 — the pure barcode laws at the receiving door.
 *
 * Node environment, zero DB: `lib/barcodes-shared.ts` has NO imports at all (it is
 * shared with a client island in Task 5), so everything here is arithmetic and state.
 *
 * Two of the plan's draft tests are corrected here (each marked PLAN CORRECTION, with
 * the reason inline); the `gtinCheckOk` and `gs1Gtin` blocks are new, because the AI
 * table and the check-digit weighting are the two places a wrong law would be invisible.
 * The GS1 check digits below were all verified by hand first:
 *   012345678905   sum 85 → check 5 ✓    4006381333931  sum 89 → check 1 ✓
 *   10614141000415 sum 55 → check 5 ✓    012345678906   sum 85 → check 5 ≠ 6 ✗
 *
 * FNC1 is written as the escape "\u001d" — never as a literal 0x1D byte in the source.
 */
import { describe, expect, it } from "vitest";
import {
  dedupeCameraDecode,
  gs1Gtin,
  gtinCheckOk,
  normalizeCode,
  resolveScan,
  ScanBurst,
  type TaughtCode,
} from "@/lib/barcodes-shared";

describe("gtinCheckOk", () => {
  it("mod-10 with weights 3,1,3,1… from the rightmost body digit", () => {
    expect(gtinCheckOk("012345678905")).toBe(true); // UPC-A
    expect(gtinCheckOk("4006381333931")).toBe(true); // EAN-13
    expect(gtinCheckOk("10614141000415")).toBe(true); // GTIN-14
    expect(gtinCheckOk("012345678906")).toBe(false); // last digit off by one
  });
  it("rejects lengths that are not a GTIN", () => {
    expect(gtinCheckOk("12345")).toBe(false);
    expect(gtinCheckOk("012345678905X")).toBe(false);
  });
});

describe("normalizeCode", () => {
  it("strips spaces and dashes, keeps digits", () => {
    expect(normalizeCode(" 0 12345 67890 5 ")).toEqual({ code: "012345678905", symbology: "upc_a", checkDigitOk: true });
  });
  it("folds a GTIN-14 with a leading zero to its 13-digit form when the check digit holds", () => {
    expect(normalizeCode("04006381333931")?.code).toBe("4006381333931");
  });
  it("parses GS1-128: AI 01 → GTIN, lot/weight/date AIs discarded (FNC1 as GS or as '(01)' brackets)", () => {
    expect(normalizeCode("(01)10614141000415(10)LOT77(3102)001250")).toEqual({ code: "10614141000415", symbology: "gs1_128", checkDigitOk: true });
    expect(normalizeCode("011061414100041510LOT773102001250")?.code).toBe("10614141000415");
  });
  it("a bare FNC1-as-GS label (no brackets, GTIN not first) still routes to the GS1 parser", () => {
    expect(normalizeCode("10LOT77\u001d0110614141000415")).toEqual({ code: "10614141000415", symbology: "gs1_128", checkDigitOk: true });
  });
  it("AI 02 (contained GTIN) is accepted when 01 is absent", () => {
    expect(normalizeCode("(02)10614141000415(37)6")?.code).toBe("10614141000415");
  });
  it("a bad check digit is kept as scanned but flagged unknown", () => {
    expect(normalizeCode("012345678906")).toEqual({ code: "012345678906", symbology: "unknown", checkDigitOk: false });
  });
  it("rejects fewer than 6 characters", () => {
    expect(normalizeCode("12345")).toBeNull();
  });
  it("alphanumeric Code 128 passes through uppercased", () => {
    expect(normalizeCode("abc-12345")).toEqual({ code: "ABC12345", symbology: "code_128", checkDigitOk: null });
  });
});

describe("gs1Gtin (the AI walk)", () => {
  it("walks past fixed-length AIs — (11) production date then (3102) net weight — to reach AI 01", () => {
    expect(gs1Gtin("1126091631020012500110614141000415")).toBe("10614141000415");
  });
  it("covers the whole 31nn–36nn measurement family, not a hand-listed six", () => {
    for (const ai of ["3100", "3103", "3109", "3202", "3299", "3300", "3600"]) {
      expect(gs1Gtin(`${ai}0012500110614141000415`)).toBe("10614141000415");
    }
  });
  it("walks past a variable-length AI terminated by FNC1/GS", () => {
    expect(gs1Gtin("10LOT77\u001d0110614141000415")).toBe("10614141000415");
  });
  it("strips the ']C1' symbology identifier some readers prefix", () => {
    expect(gs1Gtin("]C1011061414100041510LOT77")).toBe("10614141000415");
  });
  it("gives up rather than guessing when a variable-length AI is never terminated", () => {
    expect(gs1Gtin("10LOT77")).toBeNull();
  });
});

const taught = (code: string, skuId: string, vendorId: string, level: "case" | "inner" = "case", productId: string | null = null): TaughtCode => ({ code, skuId, vendorId, level, productId });

describe("resolveScan", () => {
  const ctx = {
    vendorId: "v-pfg",
    lineSkuIds: ["sku-turkey-pfg", "sku-ham-pfg"],
    taught: [taught("111", "sku-turkey-pfg", "v-pfg"), taught("222", "sku-swiss-pfg", "v-pfg"), taught("333", "sku-turkey-leo", "v-leo", "case", "prod-turkey"), taught("444", "sku-turkey-pfg", "v-pfg", "inner")],
    vendorSkus: [{ skuId: "sku-turkey-pfg", productId: "prod-turkey" }, { skuId: "sku-ham-pfg", productId: null }, { skuId: "sku-swiss-pfg", productId: null }],
  };
  it("line > sku > twin > unknown", () => {
    expect(resolveScan("111", ctx)).toEqual({ kind: "line", skuId: "sku-turkey-pfg", level: "case", levels: ["case"], ambiguous: false });
    expect(resolveScan("222", ctx)).toEqual({ kind: "sku", skuId: "sku-swiss-pfg", level: "case", levels: ["case"], ambiguous: false });
    expect(resolveScan("333", ctx)).toEqual({ kind: "twin", skuId: "sku-turkey-pfg", viaSkuId: "sku-turkey-leo", level: "case", levels: ["case"], ambiguous: false });
    expect(resolveScan("999", ctx)).toEqual({ kind: "unknown" });
  });
  it("a code taught at both levels returns both, defaulting to case", () => {
    const both = { ...ctx, taught: [...ctx.taught, taught("111", "sku-turkey-pfg", "v-pfg", "inner")] };
    expect(resolveScan("111", both)).toMatchObject({ kind: "line", level: "case", levels: ["case", "inner"] });
  });
  it("two of this vendor's SKUs sharing a code is ambiguous: the one on the delivery wins, flagged", () => {
    const dup = { ...ctx, taught: [...ctx.taught, taught("111", "sku-ham-pfg", "v-pfg")] };
    expect(resolveScan("111", dup)).toMatchObject({ kind: "line", skuId: "sku-turkey-pfg", ambiguous: true });
  });
  it("a twin is offered only when this vendor has a SKU of the same product", () => {
    const noTwin = { ...ctx, vendorSkus: ctx.vendorSkus.filter((s) => s.skuId !== "sku-turkey-pfg"), lineSkuIds: ["sku-ham-pfg"], taught: ctx.taught.filter((t) => t.skuId !== "sku-turkey-pfg") };
    expect(resolveScan("333", noTwin)).toEqual({ kind: "unknown" });
  });
});

describe("ScanBurst (keyboard-wedge state machine)", () => {
  it("keys ≤35 ms apart, ≥6 chars, Enter-terminated → one scan; keystrokes reported as swallowed", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 1000;
    for (const ch of "012345678905") { expect(b.key(ch, t)).toBe("swallow"); t += 20; }
    expect(b.key("Enter", t)).toEqual({ scan: "012345678905" });
  });

  // PLAN CORRECTION. The plan asserted `"pass"` for EVERY keystroke of human typing.
  // That is unsatisfiable alongside the test above: the first key of a scanner burst and
  // the first key of typing are indistinguishable (both arrive with an infinite gap), so
  // `key()` must return the same verdict for both — and the test above requires "swallow".
  // The guarantee the plan's own implementer note actually describes is that the swallow is
  // PROVISIONAL: typing never produces a scan, and `tick` hands the stalled characters back
  // as `{ release }` for ScanField to re-dispatch into the focused element.
  it("human typing (>35 ms between keys) never produces a scan; the provisional swallow is handed back by tick", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 1000;
    for (const ch of "turkey") { expect(b.key(ch, t)).toBe("swallow"); t += 120; }
    expect(b.key("Enter", t)).toBe("pass"); // a sub-minLength buffer is typing, not a scan
    const b2 = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    expect(b2.key("t", 0)).toBe("swallow");
    expect(b2.tick(300)).toEqual({ release: "t" }); // nothing the person typed is lost
  });

  // PLAN CORRECTION (arithmetic). The plan wrote `b.tick(t + 299)` after a loop that
  // advances `t` one more step PAST the final keystroke, so `t + 299` is really
  // last + 309 — already over the 300 ms threshold, and the "still silent" assertion
  // would have failed. The boundary is measured from the last key, so track it.
  it("a 300 ms silence terminates a burst without Enter", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 1000;
    let last = t;
    for (const ch of "4006381333931") { last = t; b.key(ch, t); t += 10; }
    expect(b.tick(last + 299)).toBeNull();
    expect(b.tick(last + 300)).toEqual({ scan: "4006381333931" });
  });

  it("a burst shorter than 6 chars is released as typing", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 0;
    for (const ch of "1234") { b.key(ch, t); t += 10; }
    expect(b.tick(t + 300)).toEqual({ release: "1234" });
  });
});

describe("dedupeCameraDecode", () => {
  it("the same code held in frame is one event until it leaves or 1500 ms pass", () => {
    const d = dedupeCameraDecode(1500);
    expect(d.decode("111", 0)).toBe(true);
    expect(d.decode("111", 400)).toBe(false);
    expect(d.decode("111", 1600)).toBe(true);
    d.frameWithout("111", 1700);
    expect(d.decode("111", 1750)).toBe(true);
  });
});
