/** The new-sandwich job's normalized request. Pure and client-safe. */
import { normLineText, parseRecipeLinePatch, type RecipeLineFields } from "@/lib/recipe-line-shared";

export interface NewSandwichRequest {
  /** correlation only, never replay */
  attemptKey?: string;
  locationId?: string | null;
  name: string;
  nameEs: string | null;
  menuPrice: number;
  section: string | null;
  directions: string | null;
  directionsEs: string | null;
  inputs: RecipeLineFields[];
}
export type NewSandwichParse = { ok: true; request: NewSandwichRequest } | { ok: false; code: string; position?: number };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function parseNewSandwichRequest(raw: unknown): NewSandwichParse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, code: "invalid_payload" };
  const b = raw as Record<string, unknown>;
  if (b.attemptKey !== undefined && !uuid(b.attemptKey)) return { ok: false, code: "invalid_payload" };
  if (b.locationId != null && !uuid(b.locationId)) return { ok: false, code: "invalid_payload" };
  if (typeof b.name !== "string" || !b.name.trim() || b.name.trim().length > 120) return { ok: false, code: "invalid_name" };
  for (const key of ["nameEs", "section", "directions", "directionsEs"] as const) {
    if (b[key] != null && typeof b[key] !== "string") return { ok: false, code: "invalid_payload" };
  }
  if (typeof b.menuPrice !== "number" || !Number.isFinite(b.menuPrice) || b.menuPrice <= 0 || b.menuPrice > 1000) return { ok: false, code: "invalid_price" };
  if (!Array.isArray(b.inputs)) return { ok: false, code: "invalid_payload" };
  if (!b.inputs.length) return { ok: false, code: "incomplete_recipe" };
  const inputs: RecipeLineFields[] = [];
  for (const [index, rawLine] of b.inputs.entries()) {
    const parsed = parseRecipeLinePatch(rawLine);
    if (!parsed.ok) return { ...parsed, position: index + 1 };
    if ([parsed.line.componentSkuId, parsed.line.componentItemId, parsed.line.componentProductId].some(id => id !== null && !uuid(id))) return { ok: false, code: "invalid_payload", position: index + 1 };
    inputs.push(parsed.line);
  }
  return { ok: true, request: {
    ...(b.attemptKey === undefined ? {} : { attemptKey: b.attemptKey as string }),
    locationId: b.locationId as string | null | undefined, name: b.name.trim(), nameEs: normLineText(b.nameEs as string | null),
    menuPrice: b.menuPrice, section: normLineText(b.section as string | null), directions: normLineText(b.directions as string | null),
    directionsEs: normLineText(b.directionsEs as string | null), inputs,
  } };
}
