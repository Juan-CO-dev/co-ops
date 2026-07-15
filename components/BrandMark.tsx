/**
 * BrandMark — the CO brand icon (public/brand/co-icon.png, the dagger-through-a-
 * sub mark) as a reusable element. ONE source of truth for the asset path, sizing,
 * and accessibility semantics so every placement stays consistent.
 *
 *  - `variant="solid"` (default): full-opacity mark.
 *  - `variant="watermark"`: faded (~0.11), for empty-state backgrounds.
 *  - `decorative`: force aria-hidden + empty alt — for contexts where a wordmark
 *    or nearby text already carries the name (loader, headers). watermark implies
 *    decorative. When neither, the mark announces as "Compliments Only".
 *
 * Plain <img> (not next/image) — a ~100KB static asset needs no optimization and
 * this keeps client/server usage identical, matching the wordmark treatment.
 */
interface BrandMarkProps {
  /** Rendered box size in px (square; the icon is object-contain'd inside). */
  size: number;
  variant?: "solid" | "watermark";
  decorative?: boolean;
  className?: string;
  /** Accessible name override when not decorative. */
  title?: string;
}

export function BrandMark({
  size,
  variant = "solid",
  decorative = false,
  className = "",
  title,
}: BrandMarkProps) {
  const hidden = decorative || variant === "watermark";
  const faded = variant === "watermark";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/co-icon.png"
      alt={hidden ? "" : (title ?? "Compliments Only")}
      aria-hidden={hidden || undefined}
      width={size}
      height={size}
      className={`object-contain ${faded ? "opacity-[0.11]" : ""} ${className}`.trim()}
      style={{ width: size, height: size }}
    />
  );
}
