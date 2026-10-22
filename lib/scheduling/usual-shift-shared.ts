/** Shape only: resolving a saved type against the shop belongs to the input layer. */
export type UsualShift =
  | { typeId: string; fromQ?: never; toQ?: never }
  | { typeId: string; fromQ: number; toQ: number };

/** Null means no manager override. SQL rejects JSON null but accepts SQL NULL. */
export function validUsualShift(value: unknown): value is UsualShift | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const shift = value as Record<string, unknown>;
  if (!Object.hasOwn(shift, "typeId") || typeof shift.typeId !== "string"
    || Object.keys(shift).some((key) => !["typeId", "fromQ", "toQ"].includes(key))) return false;
  const from = Object.hasOwn(shift, "fromQ"), to = Object.hasOwn(shift, "toQ");
  if (from !== to) return false;
  return !from || (typeof shift.fromQ === "number" && typeof shift.toQ === "number"
    && Number.isInteger(shift.fromQ) && Number.isInteger(shift.toQ)
    && shift.fromQ >= 0 && shift.toQ <= 96 && shift.fromQ < shift.toQ);
}
