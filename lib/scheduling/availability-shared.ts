/** Manager-set weekly availability. Null keeps the Toast punch estimate. */
export type AvailabilityDay = { mode: "works" | "if_needed" | "off"; fromQ?: number; toQ?: number };
export type PersonAvailability = Record<1 | 2 | 3 | 4 | 5 | 6 | 7, AvailabilityDay>;

/** The SQL writer enforces the same exact keys and quarter-hour bounds. */
export function isPersonAvailability(value: unknown): value is PersonAvailability | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const days = value as Record<string, unknown>;
  if (Object.keys(days).length !== 7) return false;
  for (let dow = 1; dow <= 7; dow++) {
    if (!Object.hasOwn(days, String(dow))) return false;
    const raw = days[String(dow)];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const day = raw as Record<string, unknown>;
    if (!Object.hasOwn(day, "mode") || !["works", "if_needed", "off"].includes(day.mode as string)
      || Object.keys(day).some((key) => !["mode", "fromQ", "toQ"].includes(key))) return false;
    const from = Object.hasOwn(day, "fromQ"), to = Object.hasOwn(day, "toQ");
    if (from !== to) return false;
    if (from && (typeof day.fromQ !== "number" || typeof day.toQ !== "number"
      || !Number.isInteger(day.fromQ) || !Number.isInteger(day.toQ)
      || day.fromQ < 0 || day.toQ > 96 || day.fromQ >= day.toQ)) return false;
  }
  return true;
}
