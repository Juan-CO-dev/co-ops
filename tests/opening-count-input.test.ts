// @vitest-environment jsdom
/**
 * Audit W14 / B021 — the opening count / temperature box kept no draft: it re-rendered
 * String(value), so typing "38." committed 38, re-rendered "38", and the next "5" made 385.
 * The box now keeps what was TYPED (the OpeningPrepEntry NumericInput rule, B1 #5) and commits
 * a number only when the draft means one.
 */
import { createElement, useState } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpeningCountInput } from "@/components/opening/OpeningCountInput";
import { draftOf } from "@/lib/prep-display-shared";

afterEach(() => cleanup());

function mount(initial: number | null = null) {
  const onChange = vi.fn<(next: number | null) => void>();
  let setFromOutside!: (next: number | null) => void;
  function Wrapper() {
    const [value, setValue] = useState<number | null>(initial);
    setFromOutside = setValue;
    return createElement(OpeningCountInput, {
      value,
      onChange: (next: number | null) => {
        onChange(next);
        setValue(next);
      },
      ariaLabel: "Fridge temp",
    });
  }
  const view = render(createElement(Wrapper));
  const input = view.getByLabelText("Fridge temp") as HTMLInputElement;
  const type = (...steps: string[]) => {
    for (const step of steps) fireEvent.change(input, { target: { value: step } });
  };
  return { input, onChange, type, setFromOutside: (next: number | null) => act(() => setFromOutside(next)) };
}

describe("OpeningCountInput — decimals type one key at a time (B021)", () => {
  it("types 38.5 one key at a time", () => {
    const { input, onChange, type } = mount();
    type("3", "38", "38.");
    expect(input.value).toBe("38.");
    type("38.5");
    expect(input.value).toBe("38.5");
    expect(onChange).toHaveBeenLastCalledWith(38.5);
    expect(onChange.mock.calls.map((c) => c[0])).not.toContain(385);
  });

  it("a decimal comma (Spanish keypad) commits the same number and stays as typed", () => {
    const { input, onChange, type } = mount();
    type("38", "38,");
    expect(input.value).toBe("38,");
    expect(onChange).toHaveBeenLastCalledWith(38);
    type("38,5");
    expect(input.value).toBe("38,5");
    expect(onChange).toHaveBeenLastCalledWith(38.5);
  });

  it("blur tidies a half-typed number to the committed value", () => {
    const { input, type } = mount();
    type("38.");
    fireEvent.blur(input);
    expect(input.value).toBe("38");
  });

  it("a minus can never be typed and a negative is never committed", () => {
    const { input, onChange, type } = mount();
    type("-5");
    expect(input.value).toBe("5");
    expect(onChange).toHaveBeenLastCalledWith(5);
    for (const call of onChange.mock.calls) expect(call[0] === null || call[0] >= 0).toBe(true);
  });

  it("text that is not a number commits nothing, marks the box, and blur restores the last number", () => {
    const { input, onChange, type } = mount(40);
    type("4o");
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.blur(input);
    expect(input.value).toBe("40");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("emptying the box commits null", () => {
    const { input, onChange, type } = mount(40);
    type("");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input.value).toBe("");
  });

  it("a value changed from outside (draft hydration) replaces the draft; an equal one does not", () => {
    const { input, type, setFromOutside } = mount();
    type("38.");
    setFromOutside(38); // same meaning: keep what was typed
    expect(input.value).toBe("38.");
    setFromOutside(41);
    expect(input.value).toBe("41");
  });

  it("draftOf is the one formatter", () => {
    expect(draftOf(null)).toBe("");
    expect(draftOf(38.5)).toBe("38.5");
  });
});
