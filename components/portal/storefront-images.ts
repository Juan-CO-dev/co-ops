/**
 * Storefront sub-image map — extracted from the /order mockup's hardcoded T(id) URLs.
 * Keyed by EXACT sub name from both the SUBS mockup array and the seed names.
 * Used by StorefrontOrderTray to show per-sub photos from CO's Toast S3 bucket.
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

/** Fallback image when a sub name doesn't match the map. */
export const GENERIC_SUB_IMG =
  "https://s3.amazonaws.com/toasttab/restaurants/restaurant-221473000000000000/menu/items/9/item-100000052580370539_1744237345.jpg";

/** Return the Toast S3 photo for a named sub, or the generic spread photo. */
export function subImage(name: string): string {
  return SUB_IMAGE_MAP[name] ?? GENERIC_SUB_IMG;
}
