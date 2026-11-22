"use client";

/**
 * NotificationList — Build #3 PR 3 Step 7.
 *
 * Renders the bell's content surface — full-screen sheet on mobile
 * (≤640px), dropdown on tablet/desktop. Per-item rich cards: tap = mark
 * as read; sheet stays open until explicit close (per Q3 + sheet-stays-
 * open lock).
 *
 * Per Option A' (locked): the card IS the read surface. No drill-through
 * navigation — all 12 fields the manager needs are in notification.data
 * JSONB at write time. Reports Hub (Wave 3) inherits archival drill-
 * through.
 *
 * Card layout (per locked design):
 *   [accent stripe] Under-par: Basil at MEP                ← title
 *   ────────────────────────────────────────────────────
 *   Juan prepped 1 (par 3, estimated 3)                    ← detail line
 *   Reason: Ingredient unavailable                         ← reason line
 *   "Got delivery short on basil today"                    ← freeText (italic)
 *   MEP · 9:42 AM                                          ← location · time
 *
 * Cross-day createdAt → "MEP · Tue, May 7 9:42 AM" (date label inserted).
 * Same-day → just time. Both via formatTime + formatDateLabel canonical
 * helpers; locale follows app language preference per AGENTS.md.
 *
 * Read items disappear from the list (bell renders only unread per
 * loadUnreadForUser's read_at IS NULL filter). Empty state shows
 * "No new notifications" via the existing notifications.empty_state key.
 *
 * Optimistic remove on tap: useTransition keeps the per-card pending
 * state. The Server Action calls revalidatePath('/dashboard'); the
 * dashboard re-renders and reloads via loadUnreadForUser, so the just-
 * acked card naturally drops out of the props on next paint. During the
 * pending window, the card shows a faded state so the user sees their
 * tap was registered.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { withDeadline } from "@/lib/bounded-fetch";

import { useTranslation } from "@/lib/i18n/provider";
import type { NotificationWithRecipient } from "@/lib/notifications";
import { NotificationCard, nyDateString } from "@/components/nav/NotificationCard";

// Nav PR 9 (step 5): the action moved out of the Dashboard tree; this component is replaced by the top bar's bell
// (components/nav/NotificationPanel.tsx) and deleted with the Dashboard's bell (step 11).
import { markNotificationReadAction } from "@/components/nav/notification-actions";

/** "Mark all read" request deadline (bounded-fetch house rule). */
const MARK_ALL_TIMEOUT_MS = 10_000;

interface NotificationListProps {
  id: string;
  notifications: ReadonlyArray<NotificationWithRecipient>;
  /** Map<locationId, locationCode> for card location-code rendering. */
  locationCodes: Record<string, string>;
  onClose: () => void;
}

export function NotificationList({
  id,
  notifications,
  locationCodes,
  onClose,
}: NotificationListProps) {
  const { t, language } = useTranslation();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus the close button on mount (matches IdleTimeoutWarning pattern).
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Filter out items that are pending mark-read (optimistic UX during
  // the Server Action round-trip; revalidatePath will drop them naturally
  // on the next render).
  const visibleNotifications = useMemo(
    () =>
      notifications.filter((item) => !pendingIds.has(item.recipient.id)),
    [notifications, pendingIds],
  );

  const todayDate = useMemo(() => nyDateString(new Date()), []);

  // "Mark all read" (owner decision W26-5 b). The server marks exactly what
  // this widget can show (session user + the widget's location context);
  // router.refresh() re-runs the dashboard's loadUnreadForUser so the list
  // and the bell count empty from server truth, not from client state.
  const router = useRouter();
  const [markAll, setMarkAll] = useState<"idle" | "pending" | "error">("idle");
  const onMarkAll = useCallback(async () => {
    setMarkAll("pending");
    let ok = false;
    try {
      ok = await withDeadline(MARK_ALL_TIMEOUT_MS, async (signal) => {
        const res = await fetch("/api/notifications/mark-all-read", {
          method: "POST",
          signal,
        });
        return res.ok;
      });
    } catch {
      ok = false;
    }
    if (!ok) {
      setMarkAll("error");
      return;
    }
    setMarkAll("idle");
    router.refresh();
  }, [router]);

  const onTapCard = useCallback(
    (recipientId: string) => {
      // Optimistic add to pending set; remove on action result.
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(recipientId);
        return next;
      });
      startTransition(async () => {
        const result = await markNotificationReadAction({ recipientId });
        if (!result.ok) {
          // Action failed — restore the card to the visible list.
          setPendingIds((prev) => {
            const next = new Set(prev);
            next.delete(recipientId);
            return next;
          });
        }
        // The moved action no longer revalidates /dashboard (nav PR 9): re-run the page's read here instead.
        else router.refresh();
        // On success, revalidatePath('/dashboard') from the Server Action
        // re-renders the dashboard with fresh loadUnreadForUser results;
        // the now-read item is gone from the props naturally. We leave
        // the recipientId in pendingIds harmlessly — it filters against
        // a list that no longer contains it.
      });
    },
    [router],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-heading`}
      id={id}
      className="
        fixed inset-0 z-50 sm:absolute sm:inset-auto sm:top-12 sm:right-0
        sm:z-40 sm:w-96
      "
    >
      {/* Backdrop — mobile only; dropdown variant has no backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className="
          absolute inset-0 bg-co-text/60 backdrop-blur-sm
          sm:hidden
        "
      />

      <div
        className="
          relative flex h-full w-full flex-col bg-co-surface
          sm:h-auto sm:max-h-[70vh] sm:rounded-2xl sm:border-2 sm:border-co-border
          sm:shadow-2xl
        "
      >
        {/* Header */}
        <header
          className="
            flex shrink-0 items-center justify-between border-b-2 border-co-border
            bg-co-surface px-4 py-3 sm:rounded-t-2xl sm:px-5 sm:py-3
          "
        >
          <h2
            id={`${id}-heading`}
            className="text-base font-extrabold uppercase tracking-[0.14em] text-co-text"
          >
            {t("notifications.sheet.heading")}
          </h2>
          <div className="flex items-center gap-2">
          {visibleNotifications.length > 0 ? (
            <button
              type="button"
              onClick={onMarkAll}
              disabled={markAll === "pending"}
              aria-label={t("notifications.sheet.mark_all_read_aria")}
              className="
                inline-flex min-h-[44px] items-center justify-center rounded-xl
                border-2 border-co-border-2 px-3 text-xs font-bold uppercase
                tracking-[0.1em] text-co-text transition hover:border-co-text
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-50
              "
            >
              {markAll === "pending"
                ? t("notifications.sheet.mark_all_read_pending")
                : t("notifications.sheet.mark_all_read")}
            </button>
          ) : null}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("notifications.sheet.close_aria")}
            className="
              inline-flex h-11 w-11 items-center justify-center rounded-full
              border-2 border-co-border-2 text-co-text-muted
              transition hover:border-co-text hover:text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            <CloseIcon />
          </button>
          </div>
        </header>
        {markAll === "error" ? (
          <p role="alert" className="shrink-0 px-4 pt-3 text-sm font-bold text-co-cta-text sm:px-5">
            {t("notifications.sheet.mark_all_read_error")}
          </p>
        ) : null}

        {/* List or empty state */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {visibleNotifications.length === 0 ? (
            <p className="py-6 text-center text-sm text-co-text-muted">
              {t("notifications.empty_state")}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {visibleNotifications.map((item) => (
                <li key={item.recipient.id}>
                  <NotificationCard
                    item={item}
                    locationCodes={locationCodes}
                    todayDate={todayDate}
                    isPending={isPending && pendingIds.has(item.recipient.id)}
                    onTap={() => onTapCard(item.recipient.id)}
                    t={t}
                    language={language}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  );
}
