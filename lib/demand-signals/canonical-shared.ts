/**
 * Demand signals (item 4 PR 1): ONE canonical text for a value, so a stored input can be named by the
 * hash of its content. Pure. Keys are sorted; `undefined` members are dropped (absent stays absent, null
 * stays null: the par overlay's "absent, not null" machine lane depends on it); a number that is not
 * finite refuses, because JSON would silently write it as null and the replay would read another input.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function walk(value: unknown, path: string): Json {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`canonical_not_finite:${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((v, i) => walk(v === undefined ? null : v, `${path}[${i}]`));
  if (typeof value === "object") {
    if (value instanceof Map || value instanceof Set || value instanceof Date) throw new Error(`canonical_not_plain:${path}`);
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = walk(v, `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`canonical_not_plain:${path}`);
}

/** The canonical JSON text of a plain value (sorted keys, no whitespace). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(walk(value, "$"));
}

/** A Map as a plain object with sorted keys (the canonical form of every map in a snapshot). */
export function mapToObject<V, W>(map: ReadonlyMap<string, V>, each: (v: V) => W): Record<string, W> {
  const out: Record<string, W> = {};
  for (const key of [...map.keys()].sort()) out[key] = each(map.get(key) as V);
  return out;
}

export function objectToMap<V, W>(obj: Record<string, V>, each: (v: V) => W): Map<string, W> {
  const out = new Map<string, W>();
  for (const key of Object.keys(obj)) out.set(key, each(obj[key] as V));
  return out;
}
