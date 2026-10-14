import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { PIN_LENGTH, pinAppend, pinBackspace, pinFromInput } from "@/lib/pin-entry";

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

describe("both keypads use the synchronous ref, cleared wherever the PIN is cleared", () => {
  for (const [name, path] of [
    ["PinKeypad", "components/auth/PinKeypad.tsx"],
    ["PinConfirmModal", "components/auth/PinConfirmModal.tsx"],
  ] as const) {
    const src = readFileSync(path, "utf8");
    it(`${name}: digits, backspace and system input advance pinRef, not render state`, () => {
      expect(src).toMatch(/const pinRef = useRef\(""\)/);
      expect(src).toMatch(/pinAppend\(pinRef\.current, d, PIN_LENGTH\)/);
      expect(src).toMatch(/pinBackspace\(pinRef\.current\)/);
      expect(src).toMatch(/pinFromInput\(pinRef\.current, value, PIN_LENGTH\)/);
      expect(src).not.toMatch(/\(pin \+ d\)/);
      expect(src).not.toMatch(/setPin\(\(prev\)/);
    });
    it(`${name}: every state clear also clears the ref`, () => {
      // each `setPin("")` is immediately preceded by a pinRef reset (modal open-reset is
      // render-phase and is covered by the [open] effect asserted below)
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (line.trim() === 'setPin("");' && !/prev|render-phase/.test(lines[i - 1] ?? "")) {
          const before = lines.slice(Math.max(0, i - 2), i).join("\n");
          const inOpenReset = lines.slice(Math.max(0, i - 3), i).join("\n").includes("if (open) {");
          if (!inOpenReset) expect(before, `${name} line ${i + 1}`).toContain('pinRef.current = "";');
        }
      });
    });
  }
  it("PinConfirmModal resets the ref on open", () => {
    const src = readFileSync("components/auth/PinConfirmModal.tsx", "utf8");
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(open\) pinRef\.current = "";\s*\}, \[open\]\)/);
  });
});
