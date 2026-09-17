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

  // Astra finding 6. `code` is a DATABASE KEY, not a transcript of the label: three ways a
  // damaged read used to become a teachable key, all three refused at the door.
  it("a control byte other than FNC1/GS is a damaged read, never a key", () => {
    expect(normalizeCode("ABC\u001eDEF")).toBeNull();
    expect(normalizeCode("ABC\u0000DEF")).toBeNull();
    expect(normalizeCode("ABC\u007fDEF")).toBeNull();
    // GS itself is legitimate — it is how a wedge delivers FNC1.
    expect(normalizeCode("10LOT77\u001d0110614141000415")?.code).toBe("10614141000415");
  });

  it("a GS1 label whose element string does not parse is refused, never folded into Code 128", () => {
    // Truncated: AI 01 promises 14 digits and the label carries five before the next FNC1.
    expect(normalizeCode("]C10112345\u001d10LOT")).toBeNull();
    expect(normalizeCode("(01)123")).toBeNull();
  });

  it("a GS1 GTIN whose check digit fails is KEPT but flagged unknown (spec section 3)", () => {
    expect(normalizeCode("(01)10614141000416")).toEqual({
      code: "10614141000416",
      symbology: "unknown",
      checkDigitOk: false,
    });
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
  //
  // The plan's machine was also LOSSY: when a slow key disproved the burst it called
  // reset(), which DISCARDED the buffer. At a realistic ~120 ms cadence the 300 ms tick
  // never fires in between, so "turkey" lost "turke" and only the last character ever came
  // back. `key()` therefore also returns `{ release }` now — the same vocabulary `tick`
  // uses — and ScanField re-dispatches it into the focused element.
  it("human typing (>35 ms between keys) never produces a scan, and every character comes back", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 1000;
    let handedBack = "";
    for (const ch of "turkey") {
      const v = b.key(ch, t);
      expect(v).not.toBe("pass");
      if (typeof v === "object") {
        expect("release" in v).toBe(true); // never a scan mid-typing
        if ("release" in v) handedBack += v.release;
      }
      t += 120;
    }
    // the trailing character is handed back by the terminating Enter, not swallowed for good
    expect(b.key("Enter", t)).toEqual({ release: "y" });
    handedBack += "y";
    expect(handedBack).toBe("turkey"); // nothing the person typed is lost
  });

  it("a release carries only the swallowed characters — never the Enter key itself", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    let t = 0;
    for (const ch of "1234") { expect(b.key(ch, t)).toBe("swallow"); t += 10; }
    const v = b.key("Enter", t); // fast enough for a burst, too short to be a scan
    expect(v).toEqual({ release: "1234" });
    expect(JSON.stringify(v)).not.toContain("Enter");
  });

  it("Enter on an empty buffer is plain typing and belongs to the form", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    expect(b.key("Enter", 1000)).toBe("pass");
  });

  it("a stalled provisional swallow is still handed back by tick", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    expect(b.key("t", 0)).toBe("swallow");
    expect(b.tick(300)).toEqual({ release: "t" });
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

  // Astra finding 1. `confirmed` is what the door reads to decide whether to SWALLOW a
  // keystroke: one character is never proof of a gun, two characters 35 ms apart are.
  it("confirmed is false on the first character and true from the second fast one", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    expect(b.confirmed).toBe(false);
    b.key("0", 0);
    expect(b.confirmed).toBe(false);
    b.key("1", 20);
    expect(b.confirmed).toBe(true);
    b.key("2", 40);
    expect(b.confirmed).toBe(true);
  });

  it("a slow keystroke un-confirms the burst — the fresh hypothesis is one character long", () => {
    const b = new ScanBurst({ maxGapMs: 35, minLength: 6, silenceMs: 300 });
    b.key("0", 0);
    b.key("1", 20);
    expect(b.confirmed).toBe(true);
    b.key("2", 500); // a person's cadence: the buffer restarts at length 1
    expect(b.confirmed).toBe(false);
  });
});

describe("dedupeCameraDecode", () => {
  // Astra follow-up 8: TIME ALONE NEVER RE-ARMS A CODE. A label resting on the counter used
  // to rack up one phantom unit every holdMs; only leaving the frame counts as a new case.
  it("a code held in frame is ONE event however long it is held", () => {
    const d = dedupeCameraDecode(1500);
    expect(d.decode("111", 0)).toBe(true);
    expect(d.decode("111", 400)).toBe(false);
    expect(d.decode("111", 1600)).toBe(false);
    expect(d.decode("111", 60_000)).toBe(false);
  });

  it("re-accepts only after the label has left the frame", () => {
    const d = dedupeCameraDecode(1500);
    expect(d.decode("111", 0)).toBe(true);
    d.frameWithout("111", 100);
    expect(d.decode("111", 150)).toBe(true);
    expect(d.decode("111", 200)).toBe(false);
  });

  it("evicts codes nobody has sighted for holdMs so a long session cannot grow unbounded", () => {
    const d = dedupeCameraDecode(1500);
    expect(d.decode("111", 0)).toBe(true);
    expect(d.decode("222", 0)).toBe(true);
    // 222 keeps being sighted; 111 has not been seen since t=0 and ages out of the map.
    expect(d.decode("222", 2_000)).toBe(false);
    d.frameWithout("333", 2_000);
    expect(d.decode("111", 2_001)).toBe(true);
    expect(d.decode("222", 2_001)).toBe(false);
  });
});
