/**
 * Storefront sub-image map — extracted from the /order mockup's hardcoded T(id) URLs.
 * Authored with the human-readable sub names; MATCHED case- and whitespace-
 * insensitively (see normalizeName below). Used by StorefrontOrderTray to show
 * per-sub photos from CO's Toast S3 bucket.
 *
 * Lookup was exact-string keyed, so "the teamster" or a name carrying a stray
 * trailing space from the DB silently fell through to the generic spread photo —
 * a wrong-but-plausible image nobody notices. Normalizing both sides removes the
 * whole class. A genuine miss still degrades to the generic photo ON PURPOSE:
 * this is the public marketing page and a missing photo must never take it down.
 * To find real misses, run `scripts/check-storefront-images.ts` (manual).
 */

const T = (id: string) =>
  `https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/images/item-${id}.jpg`;

const SUB_IMAGE_MAP: Record<string, string> = {
  "The Teamster":            T("abd7ad07-cc58-4349-8c2f-1f88a43caa38"),
  "Crunchy Boi":             T("3846fa6d-2632-4fe4-8fab-a25c2f9b0b0a"),
  "Hot Pants":               T("dbf2cd1a-9b17-491c-853a-907a960bc311"),
  "Marisa Tomei Eats Free":  T("c780adb3-69c8-4b01-b640-7f3c269df298"),
  "The Frex":                T("af933f0c-c537-46fa-a2ae-dd8b0fda3cca"),
  "Vesuvio II":              "https://static.spotapps.co/spots/d3/a96ed4e6d84d189e5f239fa7fc42e4/full",
  "Sicky Wicky Club":        T("a1d9a1d8-54e5-437c-9fc1-38999bd02dc7"),
  "Never Been Cheddar":      T("ce210b97-390b-44f0-89c5-0a59ae667db5"),
  "Farmers Market After Dark": T("e75b63c1-de98-40bd-855b-9bce1b2abe4c"),
};

/**
 * The ONE normalization applied to both map keys and lookups: trim + lowercase.
 * Deliberately conservative — it does NOT strip punctuation or collapse inner
 * whitespace, so "Vesuvio II" and "Vesuvio ll" stay distinct names.
 */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Normalized map, built ONCE at module load rather than per lookup. */
const NORMALIZED_SUB_IMAGE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(SUB_IMAGE_MAP).map(([name, url]) => [normalizeName(name), url]),
);

/** Fallback image when a sub name doesn't match the map. */
export const GENERIC_SUB_IMG =
  "https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/items/9/item-100000052580370539_1744237345.jpg";

/** Return the Toast S3 photo for a named sub, or the generic spread photo. */
export function subImage(name: string): string {
  return NORMALIZED_SUB_IMAGE_MAP[normalizeName(name)] ?? GENERIC_SUB_IMG;
}

/**
 * True when the name resolves to a real, authored photo (not the generic
 * fallback). Exists for scripts/check-storefront-images.ts, which reports the
 * live subs missing a photo — the runtime path must stay silent, but an operator
 * running the script should get a straight answer.
 */
export function hasSubImage(name: string): boolean {
  return normalizeName(name) in NORMALIZED_SUB_IMAGE_MAP;
}
