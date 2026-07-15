import type { ReactNode } from "react";

import { BrandMark } from "@/components/BrandMark";

/**
 * EmptyState — a faded brand-icon watermark above a message, for "nothing here
 * yet" surfaces. Server-component-friendly (no client hooks). The reusable
 * pattern for empty lists/reports; the watermark is decorative (aria-hidden).
 */
interface EmptyStateProps {
  message: string;
  children?: ReactNode;
  markSize?: number;
  className?: string;
}

export function EmptyState({ message, children, markSize = 64, className = "" }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className}`.trim()}>
      <BrandMark size={markSize} variant="watermark" />
      <p className="text-sm font-medium text-co-text-muted">{message}</p>
      {children}
    </div>
  );
}
