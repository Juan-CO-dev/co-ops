/** Parse decimal dollars without binary floating-point multiplication; half-up to cents. */
export function dollarsToCents(input: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(input)) return null;
  const [whole = "", fraction = ""] = input.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2)) + (Number(fraction[2] ?? "0") >= 5 ? 1 : 0);
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100000000 ? cents : null;
}
