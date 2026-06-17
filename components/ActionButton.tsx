import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * ActionButton / ActionLink — the canonical CO-OPS action control.
 *
 * One look across every primary action surface (dashboard tiles, report
 * submits, finalize CTAs, navigation): a rounded-xl, uppercase, gold-fill
 * primary with a surface-outline secondary and a red-accent danger. Replaces
 * the drifted per-surface copies (rounded-md vs rounded-xl, min-h 48 vs 52,
 * ad-hoc disabled treatments) that accumulated across Build #1–C.43.
 *
 * Style lives in `actionButtonClass`; the two wrappers below keep `<button>`
 * and `<Link>` correctly typed for their element. The component owns the LOOK;
 * callers own PLACEMENT (pass `className` for `w-full`, margins, etc.).
 *
 * Brand: red ("co-cta") is used sparingly per the brand book — the `danger`
 * variant is a red OUTLINE/TEXT accent, not a red fill.
 */

export type ActionVariant = "primary" | "secondary" | "danger";
/** `default` for tiles/nav CTAs; `lg` for the prominent primary submit on a form. */
export type ActionSize = "default" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl border-2 " +
  "font-bold uppercase tracking-[0.1em] " +
  "transition-[opacity,background-color,border-color,color] duration-150 active:opacity-80 " +
  "focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const SIZE: Record<ActionSize, string> = {
  default: "min-h-[48px] px-5 text-sm",
  lg: "min-h-[56px] px-6 text-base",
};

const VARIANT: Record<ActionVariant, string> = {
  primary: "border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep",
  secondary: "border-co-border-2 bg-co-surface text-co-text hover:border-co-text",
  danger: "border-co-cta bg-co-surface text-co-cta hover:bg-co-danger-surface",
};

export function actionButtonClass(
  variant: ActionVariant = "primary",
  size: ActionSize = "default",
  className = "",
): string {
  return [BASE, SIZE[size], VARIANT[variant], className].filter(Boolean).join(" ");
}

type ButtonProps = Omit<ComponentProps<"button">, "className"> & {
  variant?: ActionVariant;
  size?: ActionSize;
  /** Layout-only extra classes (e.g. "w-full"). Visual style is owned here. */
  className?: string;
  children: ReactNode;
};

export function ActionButton({
  variant = "primary",
  size = "default",
  className = "",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={actionButtonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

type LinkProps = Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: ActionVariant;
  size?: ActionSize;
  className?: string;
  children: ReactNode;
};

export function ActionLink({
  variant = "primary",
  size = "default",
  className = "",
  children,
  ...rest
}: LinkProps) {
  return (
    <Link className={actionButtonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
