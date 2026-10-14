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
