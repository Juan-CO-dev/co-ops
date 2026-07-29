import type { ReactNode } from "react";

/**
 * PageHeader — the canonical page-title tuple, extracted.
 *
 * Every admin/operator page hand-rolled the identical
 *   <h1 className="text-xl font-extrabold leading-tight text-co-text">…</h1>
 *   <p  className="mt-1 text-sm text-co-text-muted">…</p>
 * pair, with drift (a stray `mt-2`, a missing `leading-tight`). This locks the
 * house header rhythm in one file so a future brand-book font swap changes one
 * place, and no page can silently drift.
 *
 * DISPLAY-STRING contract: callers pass ALREADY-TRANSLATED strings (serverT /
 * t()); this primitive never touches the i18n resolver, so it is server-safe
 * (no "use client", no hooks) and drops straight into Server Components.
 *
 * Slots:
 *   - subtitle — the muted secondary line (mt-1 text-sm text-co-text-muted)
 *   - children — trailing actions/badges rendered on the title row (right-aligned)
 */
export function PageHeader({
  title,
  subtitle,
  children,
  className,
}: {
  /** Already-translated page title (caller runs t()). */
  title: ReactNode;
  /** Already-translated subtitle; omit to render no secondary line. */
  subtitle?: ReactNode;
  /** Optional trailing slot (actions/badges) on the title row. */
  children?: ReactNode;
  /** Extra classes merged onto the wrapper (rarely needed). */
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-extrabold leading-tight text-co-text">{title}</h1>
        {children}
      </div>
      {subtitle != null && (
        <p className="mt-1 text-sm text-co-text-muted">{subtitle}</p>
      )}
    </div>
  );
}
