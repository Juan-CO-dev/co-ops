import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { PIN_LENGTH, createPinEntry, pinAppend, pinBackspace, pinFromInput } from "@/lib/pin-entry";

// Review P2: two digit events before a re-render must both land. The keypads
// advance a ref with these helpers inside the handler and mirror it to state.
// `tapper` reproduces exactly that handler shape, with NO render between taps.
function tapper() {
  const pinRef = { current: "" };
  const submits: string[] = [];
  return {
    pinRef,
    submits,
    tap(d: string) {
      if (pinRef.current.length >= PIN_LENGTH) return;
      const step = pinAppend(pinRef.current, d, PIN_LENGTH);
      pinRef.current = step.pin;
      if (step.completed) submits.push(step.pin);
    },
  };
}

describe("pin entry buffer (no render between events)", () => {
  it("two fast taps give '12', not '2'", () => {
    const t = tapper();
    t.tap("1");
    t.tap("2");
    expect(t.pinRef.current).toBe("12");
  });

  it("four fast taps submit once with the full PIN", () => {
    const t = tapper();
    for (const d of ["4", "8", "1", "5"]) t.tap(d);
    expect(t.pinRef.current).toBe("4815");
    expect(t.submits).toEqual(["4815"]);
  });

  it("taps past the 4th digit are noise and never re-submit", () => {
    const t = tapper();
    for (const d of ["1", "2", "3", "4", "5", "6"]) t.tap(d);
    expect(t.pinRef.current).toBe("1234");
    expect(t.submits).toEqual(["1234"]);
  });

  it("pinAppend completes only on the step that reaches the length", () => {
    expect(pinAppend("123", "4")).toEqual({ pin: "1234", completed: true });
    expect(pinAppend("12", "3")).toEqual({ pin: "123", completed: false });
    expect(pinAppend("1234", "5")).toEqual({ pin: "1234", completed: false });
  });

  it("ignores non-digits", () => {
    expect(pinAppend("12", "a")).toEqual({ pin: "12", completed: false });
    expect(pinAppend("12", "")).toEqual({ pin: "12", completed: false });
  });

  it("backspace chain then re-type reaches the full PIN once", () => {
    let pin = "123";
    pin = pinBackspace(pin).pin;
    pin = pinBackspace(pin).pin;
    expect(pin).toBe("1");
    const a = pinAppend(pin, "9");
    const b = pinAppend(a.pin, "8");
    const c = pinAppend(b.pin, "7");
    expect(c).toEqual({ pin: "1987", completed: true });
    expect(pinBackspace("").pin).toBe("");
  });

  it("system-keyboard input is digits only, capped, and completes once", () => {
    expect(pinFromInput("", "12a3")).toEqual({ pin: "123", completed: false });
    expect(pinFromInput("123", "1234")).toEqual({ pin: "1234", completed: true });
    expect(pinFromInput("1234", "12345")).toEqual({ pin: "1234", completed: false });
  });
});

describe("PinEntry controller: once the 4th digit lands, input is frozen (review 2)", () => {
  function fill(e = createPinEntry()) {
    const completed: string[] = [];
    for (const d of ["1", "2", "3", "4"]) {
      const step = e.append(d);
      if (step?.completed) completed.push(step.pin);
    }
    return { e, completed };
  }

  it("two events with no render between both land", () => {
    const e = createPinEntry();
    e.append("1");
    e.append("2");
    expect(e.value).toBe("12");
  });

  it("the 4th digit completes exactly once and freezes the entry", () => {
    const { e, completed } = fill();
    expect(completed).toEqual(["1234"]);
    expect(e.frozen).toBe(true);
  });

  it("Backspace right after the 4th digit (before any render) applies NO edit", () => {
    const { e } = fill();
    expect(e.backspace()).toBeNull();
    expect(e.value).toBe("1234"); // display and the scheduled submit can never diverge
  });

  it("Clear, system input and further digits are all rejected while frozen", () => {
    const { e } = fill();
    expect(e.clear()).toBeNull();
    expect(e.input("99")).toBeNull();
    expect(e.append("5")).toBeNull();
    expect(e.value).toBe("1234");
  });

  it("a failure path resets: buffer emptied and edits allowed again", () => {
    const { e } = fill();
    e.reset();
    expect(e.value).toBe("");
    expect(e.frozen).toBe(false);
    expect(e.append("7")?.pin).toBe("7");
  });

  it("unfreeze keeps the buffer; wipe empties it but stays frozen (success)", () => {
    const a = fill().e;
    a.unfreeze();
    expect(a.value).toBe("1234");
    expect(a.backspace()?.pin).toBe("123");
    const b = fill().e;
    b.wipe();
    expect(b.value).toBe("");
    expect(b.frozen).toBe(true);
    expect(b.append("1")).toBeNull();
  });

  it("edits before the 4th digit work: backspace, clear, system input", () => {
    const e = createPinEntry();
    e.append("1");
    e.append("2");
    expect(e.backspace()?.pin).toBe("1");
    expect(e.clear()?.pin).toBe("");
    expect(e.input("55a")?.pin).toBe("55");
    expect(e.frozen).toBe(false);
  });

  it("system input that completes the PIN freezes it too", () => {
    const e = createPinEntry();
    const step = e.input("4821");
    expect(step).toEqual({ pin: "4821", completed: true });
    expect(e.frozen).toBe(true);
    expect(e.backspace()).toBeNull();
  });

  it("rejects non-digits and a full buffer without changing anything", () => {
    const e = createPinEntry();
    expect(e.append("x")).toBeNull();
    expect(e.value).toBe("");
  });
});

describe("both keypads edit only through the synchronous entry, and guard keys with it", () => {
  for (const [name, path] of [
    ["PinKeypad", "components/auth/PinKeypad.tsx"],
    ["PinConfirmModal", "components/auth/PinConfirmModal.tsx"],
  ] as const) {
    const src = readFileSync(path, "utf8");
    it(`${name}: digits, backspace, clear and system input go through the entry`, () => {
      expect(src).toMatch(/const \[entry\] = useState\(createPinEntry\)/);
      expect(src).toMatch(/entry\.append\(d\)/);
      expect(src).toMatch(/entry\.backspace\(\)/);
      expect(src).toMatch(/entry\.clear\(\)/);
      expect(src).toMatch(/entry\.input\(value\)/);
      expect(src).not.toMatch(/\(pin \+ d\)/);
      expect(src).not.toMatch(/setPin\(\(prev\)/);
      expect(src).not.toMatch(/pinRef/);
    });
    it(`${name}: the physical-key handler checks the synchronous freeze, not just render state`, () => {
      const at = src.indexOf("function onKey(e: KeyboardEvent)");
      expect(at).toBeGreaterThan(-1);
      const head = src.slice(at, at + 700);
      expect(head).toMatch(/inFlight\.current \|\| (entry\.frozen|retryRemaining)/);
      expect(head).toContain("entry.frozen");
    });
    it(`${name}: every failure path resets the entry`, () => {
      expect(src).toMatch(/entry\.reset\(\);\s*setPin\(""\)/);
    });
  }
  it("PinConfirmModal resets the entry on open and unfreezes when a submit fails", () => {
    const src = readFileSync("components/auth/PinConfirmModal.tsx", "utf8");
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(open\) entry\.reset\(\);\s*\}, \[open, entry\]\)/);
    expect(src).toMatch(/if \(!confirmed\) \{\s*inFlight\.current = false;\s*entry\.unfreeze\(\);/);
  });
  it("PinKeypad release() unfreezes with the latch", () => {
    const src = readFileSync("components/auth/PinKeypad.tsx", "utf8");
    expect(src).toMatch(/inFlight\.current = false;\s*entry\.unfreeze\(\);/);
  });
});
