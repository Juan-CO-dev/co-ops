import { BrandMark } from "@/components/BrandMark";

/**
 * A large, very faint brand watermark anchored to the bottom-right of the
 * viewport on DESKTOP ONLY. Sits behind all content (-z-10, but above the body
 * gradient) so the empty canvas around centered/focused surfaces reads
 * intentional instead of empty. Decorative + non-interactive; hidden on phones
 * (where content fills the screen and there is no empty canvas).
 */
export function CanvasWatermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed -bottom-16 -right-16 -z-10 hidden opacity-[0.05] lg:block"
    >
      <BrandMark size={380} decorative />
    </div>
  );
}
