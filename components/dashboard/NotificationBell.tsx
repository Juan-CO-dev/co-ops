"use client";

/**
 * NotificationBell — Build #3 PR 3 Step 7.
 *
 * Always-visible header affordance. Renders a bell icon with an unread
 * count badge when count > 0; bell icon alone when count = 0. Tap opens
 * NotificationList (full-screen sheet on mobile ≤640px, dropdown on
 * larger viewports).
 *
 * Architectural choices (locked Step 7 architecture surfacing):
 *   - Q1: Always-visible (phone-first muscle memory; bell stays present
 *     even when there's nothing to see, so operators learn the affordance
 *     before their first urgent alert).
 *   - Q2: Full-screen sheet on mobile / dropdown on desktop. Body scroll
 *     lock fires only on the mobile sheet variant.
 *   - Q3: Sheet stays open after per-item tap (mark-read is "I saw it,"
 *     not "navigate me elsewhere"); explicit close affordance preserved.
 *   - Q5: revalidatePath('/dashboard') from the Server Action (cacheComponents
 *     NOT enabled per next.config.ts pre-flight) — list shrinks naturally
 *     on next render after mark-read.
 *   - Option A' (locked): card IS the read surface; no drill-through
 *     navigation. Reports Hub (Wave 3) inherits archival drill-through.
 *
 * Body scroll lock pattern: only on mobile sheet (matchMedia query at
 * open time). Desktop dropdown leaves body scroll alone.
 *
 * Focus management: on open, focus the close button (matches
 * IdleTimeoutWarning + PinConfirmModal pattern). On close, return focus
 * to the bell trigger. Esc closes the sheet/dropdown (escape is fine
 * here — unlike IdleTimeoutWarning, this isn't an explicit-action-required
 * modal).
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";
import type { NotificationWithRecipient } from "@/lib/notifications";

import { NotificationList } from "./NotificationList";

interface NotificationBellProps {
  notifications: ReadonlyArray<NotificationWithRecipient>;
  /** Map<locationId, locationCode> for card location-code rendering. */
  locationCodes: Record<string, string>;
}

export function NotificationBell({
  notifications,
  locationCodes,
}: NotificationBellProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetId = useId();

  const unreadCount = notifications.length;

  // Body scroll lock — only on mobile sheet variant.
  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 639px)");
    if (!mql.matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  // Esc to close + return focus to trigger.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // Return focus to trigger after close.
  useEffect(() => {
    if (!isOpen) {
      // Defer to next tick so we don't fight the open-state transition.
      const id = window.setTimeout(() => triggerRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [isOpen]);

  const onToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const onClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const triggerAriaLabel =
    unreadCount > 0
      ? t("notifications.bell.aria_with_count", { count: unreadCount })
      : t("notifications.bell.aria_zero");

  const toggleAriaLabel = isOpen
    ? t("notifications.bell.toggle_close_aria")
    : t("notifications.bell.toggle_open_aria");

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        aria-label={`${triggerAriaLabel}. ${toggleAriaLabel}`}
        aria-expanded={isOpen}
        aria-controls={sheetId}
        aria-haspopup="dialog"
        className="
          relative inline-flex h-11 w-11 items-center justify-center rounded-full
          border-2 border-co-border-2 bg-co-surface text-co-text
          transition hover:border-co-text
          focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        "
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            aria-hidden
            className="
              absolute -top-1 -right-1 inline-flex min-w-[20px] items-center justify-center
              rounded-full border-2 border-co-surface bg-co-cta px-1
              text-[10px] font-extrabold leading-none text-co-bg
              h-5
            "
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <NotificationList
          id={sheetId}
          notifications={notifications}
          locationCodes={locationCodes}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 3.5a4.5 4.5 0 0 0-4.5 4.5v2.25c0 1-0.4 1.95-1.1 2.65L3.75 13.5h12.5l-0.65-0.6c-0.7-0.7-1.1-1.65-1.1-2.65V8a4.5 4.5 0 0 0-4.5-4.5Z" />
      <path d="M8.25 16.25a1.75 1.75 0 0 0 3.5 0" />
      <path d="M10 2.5v1" />
    </svg>
  );
}
