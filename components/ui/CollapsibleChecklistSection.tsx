"use client";

/**
 * CollapsibleChecklistSection - the ONE shared collapsible header + panel for every
 * sectioned checklist (AM prep, opening, mid-day, closing). Wave 1 branch B.
 *
 * Differs from components/ui/CollapsibleSection (admin disclosure primitive) on
 * purpose: floor forms hold live input state, so the panel stays MOUNTED and is
 * hidden with the `hidden` attribute (no unmount = no lost typing, and an
 * invalid field inside a collapsed section can still be revealed and focused).
 *
 * The header is a full-row <button> (min 44px, aria-expanded + aria-controls)
 * showing the title and "3 of 8 done". `headerExtras` render BESIDE the toggle,
 * never inside it (a button cannot contain buttons) - used by opening for the
 * per-station tick / verify controls.
 *
 * Open/closed state is owned by the caller (useCollapsibleSections), so a form
 * can reveal a section when submit validation finds a problem inside it.
 * Strings arrive already translated except the progress line, which this
 * component renders from the shared `checklist.section.progress` key.
 */

import { useId, type ReactNode } from "react";

import { sectionDomKey } from "@/lib/collapsible-sections";
import { useTranslation } from "@/lib/i18n/provider";

export interface CollapsibleChecklistSectionProps {
  /** Form identity for the DOM marker (e.g. "am-prep"). */
  formKey: string;
  /** Stable system key of the section. */
  sectionId: string;
  /** Already-translated title (caller owns display resolution). */
  title: ReactNode;
  /** Items done under the host form's own rule. */
  done: number;
  /** Items in the section under the same rule. */
  total: number;
  open: boolean;
  onToggle: () => void;
  /** Extra text appended to the progress line (already translated). */
  progressSuffix?: string;
  /** Controls rendered beside the toggle (never inside it). */
  headerExtras?: ReactNode;
  /** Optional aria-label for the whole <section>. */
  ariaLabel?: string;
  /** Classes for the outer <section> (each form keeps its own card chrome). */
  className?: string;
  /** Classes for the title text. */
  titleClassName?: string;
  /** Classes for the header row wrapper. */
  headerClassName?: string;
  /** Classes for the panel that holds the children. */
  panelClassName?: string;
  children: ReactNode;
}

export function CollapsibleChecklistSection({
  formKey,
  sectionId,
  title,
  done,
  total,
  open,
  onToggle,
  progressSuffix,
  headerExtras,
  ariaLabel,
  className,
  titleClassName,
  headerClassName,
  panelClassName,
  children,
}: CollapsibleChecklistSectionProps) {
  const { t } = useTranslation();
  const uid = useId();
  const buttonId = `${uid}-toggle`;
  const panelId = `${uid}-panel`;
  const finished = total > 0 && done >= total;

  return (
    <section
      data-collapsible-section={sectionDomKey(formKey, sectionId)}
      aria-label={ariaLabel}
      className={className}
    >
      <div className={["flex items-center gap-2", headerClassName ?? ""].join(" ").trim()}>
        <button
          type="button"
          id={buttonId}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="
            flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-3
            text-left
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              {finished ? (
                <span aria-hidden className="text-co-success">
                  ✓
                </span>
              ) : null}
              <span
                className={
                  titleClassName ??
                  "text-base font-extrabold uppercase tracking-[0.14em] text-co-text"
                }
              >
                {title}
              </span>
            </span>
            {total > 0 ? (
              <span data-section-progress className="text-[11px] text-co-text-muted">
                {t("checklist.section.progress", { done, total })}
                {progressSuffix ?? ""}
              </span>
            ) : null}
          </span>
          <span aria-hidden className="shrink-0 text-co-text-muted">
            {open ? "▾" : "▸"}
          </span>
        </button>
        {headerExtras}
      </div>

      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} className={panelClassName}>
        {children}
      </div>
    </section>
  );
}
