/**
 * PIN entry buffer maths (pure, client-safe, zero I/O).
 *
 * WHY THIS EXISTS. The keypads computed the next PIN from the render's `pin`
 * state: `(pin + d).slice(0, 4)`. Two digit events delivered before React
 * re-renders (a fast tap, a key-repeat, a keyboard burst) both read the SAME old
 * `pin`, so "1" then "2" produced "2" and a real 4-digit entry could finish
 * short and never submit. The components now keep a `pinRef` as the synchronous
 * source of truth, advance it with these helpers inside the handler, and mirror
 * it to state for rendering only. Submit is scheduled from the helper's result,
 * never from inside a state updater.
 */

export const PIN_LENGTH = 4;

export interface PinStep {
  /** The buffer after the step. */
  pin: string;
  /** True only when THIS step took the buffer from short of full to full. */
  completed: boolean;
}

/** Append one digit. A full buffer (or a non-digit) is left untouched. */
export function pinAppend(current: string, digit: string, length: number = PIN_LENGTH): PinStep {
  if (current.length >= length || !/^\d$/.test(digit)) return { pin: current, completed: false };
  const pin = current + digit;
  return { pin, completed: pin.length === length };
}

/** Drop the last digit (Backspace). */
export function pinBackspace(current: string): PinStep {
  return { pin: current.slice(0, -1), completed: false };
}

/** Replace the buffer from a free-text field (system keyboard): digits only, capped. */
export function pinFromInput(current: string, raw: string, length: number = PIN_LENGTH): PinStep {
  const pin = raw.replace(/\D/g, "").slice(0, length);
  return { pin, completed: pin.length === length && current.length < length };
}

/**
 * The synchronous PIN entry controller the keypads hold in a stable ref-like slot.
 *
 * RULE: once the 4th digit lands, the entry is FROZEN until a failure path calls
 * `reset()` / `unfreeze()`. The submit is scheduled synchronously at that moment, so any
 * later edit (physical Backspace/Escape/digit, on-screen Clear, system-keyboard input)
 * would change what the display shows without changing what the timer submits. Every edit
 * method therefore returns `null` (no edit applied) while frozen, and the freeze lives HERE
 * (a plain object mutated in the handler), never in render state, so it holds even when two
 * events arrive before React re-renders.
 */
export interface PinEntry {
  readonly value: string;
  readonly frozen: boolean;
  /** Add a digit. `null` = rejected (frozen, full or non-digit); nothing changed. */
  append(digit: string): PinStep | null;
  /** Drop the last digit. `null` = rejected (frozen). */
  backspace(): PinStep | null;
  /** Empty the buffer. `null` = rejected (frozen). */
  clear(): PinStep | null;
  /** Replace from free text (system keyboard). `null` = rejected (frozen). */
  input(raw: string): PinStep | null;
  /** Failure/close path: empty the buffer AND allow edits again. */
  reset(): void;
  /** Allow edits again, keeping the buffer. */
  unfreeze(): void;
  /** Scrub the buffer but stay frozen (success: the dialog is finishing). */
  wipe(): void;
}

export function createPinEntry(length: number = PIN_LENGTH): PinEntry {
  let value = "";
  let frozen = false;
  const apply = (step: PinStep): PinStep => {
    value = step.pin;
    if (step.completed) frozen = true;
    return step;
  };
  return {
    get value() {
      return value;
    },
    get frozen() {
      return frozen;
    },
    append(digit) {
      if (frozen) return null;
      const step = pinAppend(value, digit, length);
      if (step.pin === value) return null;
      return apply(step);
    },
    backspace() {
      if (frozen) return null;
      return apply(pinBackspace(value));
    },
    clear() {
      if (frozen) return null;
      return apply({ pin: "", completed: false });
    },
    input(raw) {
      if (frozen) return null;
      return apply(pinFromInput(value, raw, length));
    },
    reset() {
      value = "";
      frozen = false;
    },
    unfreeze() {
      frozen = false;
    },
    wipe() {
      value = "";
    },
  };
}
