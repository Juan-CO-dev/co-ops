import { subImage, hasSubImage, GENERIC_SUB_IMG } from "@/components/portal/storefront-images";
/** Public metadata only. Source paths and provenance stay in assets/ manifests. */
export const heroMedia = {
  poster: "/media/crunchy-boi-014.webp", width: 750, height: 1125,
  spin: "/media/crunchy-boi-spin.mp4", background: "#FFE560",
} as const;
/** Existing Toast identity lookup is evidence only, never an export approval or fallback. */
export function existingIdentityReference(name: string): string | null {
  if (!hasSubImage(name)) return null;
  const source = subImage(name);
  return source === GENERIC_SUB_IMG ? null : source;
}
