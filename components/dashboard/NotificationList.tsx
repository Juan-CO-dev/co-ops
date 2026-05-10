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

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import {
  formatNotification,
  type NotificationWithRecipient,
} from "@/lib/notifications";

import { markNotificationReadAction } from "@/app/(authed)/dashboard/actions";

const OPERATIONAL_TZ = "America/New_York";

interface NotificationListProps {
  id: string;
  notifications: ReadonlyArray<NotificationWithRecipient>;
  /** Map<locationId, locationCode> for card location-code rendering. */
  locationCodes: Record<string, string>;
  onClose: () => void;
}

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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
        // On success, revalidatePath('/dashboard') from the Server Action
        // re-renders the dashboard with fresh loadUnreadForUser results;
        // the now-read item is gone from the props naturally. We leave
        // the recipientId in pendingIds harmlessly — it filters against
        // a list that no longer contains it.
      });
    },
    [],
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
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("notifications.sheet.close_aria")}
            className="
              inline-flex h-9 w-9 items-center justify-center rounded-full
              border-2 border-co-border-2 text-co-text-muted
              transition hover:border-co-text hover:text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            <CloseIcon />
          </button>
        </header>

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
// Card
// ─────────────────────────────────────────────────────────────────────────────

interface NotificationCardProps {
  item: NotificationWithRecipient;
  locationCodes: Record<string, string>;
  todayDate: string;
  isPending: boolean;
  onTap: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  language: ReturnType<typeof useTranslation>["language"];
}

function NotificationCard({
  item,
  locationCodes,
  todayDate,
  isPending,
  onTap,
  t,
  language,
}: NotificationCardProps) {
  const { notification } = item;
  const { title } = formatNotification(notification, t);

  // Resolve location code from notification.location_id (multi-location MoO/
  // Owner case). Falls back to a body-param locationCode if location_id is
  // null (defensive — currently every emission carries a location_id).
  const locationCode =
    (notification.locationId && locationCodes[notification.locationId]) ||
    String(
      (notification.data as { titleParams?: { locationCode?: string } })
        .titleParams?.locationCode ?? "",
    );

  // Resolve the createdAt's operational-TZ date for cross-day comparison.
  const createdAtDate = nyDateString(new Date(notification.createdAt));
  const isCrossDay = createdAtDate !== todayDate;
  const time = formatTime(notification.createdAt, language);
  const locationTimeLine = isCrossDay
    ? t("notifications.card.location_date_time", {
        locationCode,
        dateLabel: formatDateLabel(createdAtDate, language),
        time,
      })
    : t("notifications.card.location_time", {
        locationCode,
        time,
      });

  // Type-specific detail rendering. Currently only under_par_alert ships;
  // future notification types add branches here.
  const detail = renderUnderParDetail({ notification, t });

  const isUrgent = notification.priority === "urgent";
  const accentClass = isUrgent ? "bg-co-cta" : "bg-co-gold-deep";

  return (
    <button
      type="button"
      onClick={onTap}
      disabled={isPending}
      aria-label={t("notifications.card.tap_aria")}
      className={[
        "relative w-full overflow-hidden rounded-xl border-2 border-co-border bg-co-surface",
        "p-4 text-left shadow-sm transition",
        "hover:border-co-text",
        "focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        "disabled:cursor-not-allowed disabled:opacity-50",
      ].join(" ")}
    >
      {/* Accent stripe (left edge) */}
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${accentClass}`} />

      <div className="pl-2">
        {/* Title (bold; unread) */}
        <p className="text-sm font-bold leading-snug text-co-text">{title}</p>

        {/* Detail block */}
        {detail ? (
          <div className="mt-2 flex flex-col gap-1 text-xs text-co-text-muted">
            {detail.detailLine ? <p>{detail.detailLine}</p> : null}
            {detail.reasonLine ? <p>{detail.reasonLine}</p> : null}
            {detail.freeText ? (
              <p className="italic text-co-text-dim">&ldquo;{detail.freeText}&rdquo;</p>
            ) : null}
          </div>
        ) : null}

        {/* Location · time */}
        <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-co-text-dim">
          {locationTimeLine}
        </p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-specific detail rendering
// ─────────────────────────────────────────────────────────────────────────────

interface DetailLines {
  detailLine: string | null;
  reasonLine: string | null;
  freeText: string | null;
}

/**
 * Renders the per-notification-type detail block. For under_par_alert,
 * pulls openerName/prepped/par/closer/reasonCategory/freeText out of
 * notification.data (written by the RPC at submission time per the
 * 0050 migration's jsonb_build_object) and composes the multi-line card
 * detail.
 *
 * `closer` may be null when no AM Prep existed yesterday — we render
 * the no-estimate variant of the detail line.
 *
 * `reasonCategory` is pre-translated via the canonical
 * notifications.under_par_alert.reason.<category> key namespace.
 */
function renderUnderParDetail({
  notification,
  t,
}: {
  notification: NotificationWithRecipient["notification"];
  t: ReturnType<typeof useTranslation>["t"];
}): DetailLines | null {
  if (notification.type !== "under_par_alert") return null;

  const data = notification.data as {
    bodyParams?: {
      openerName?: string;
      prepped?: string | number;
      par?: string | number;
      closer?: string | number | null;
      reasonCategory?: string;
      freeText?: string | null;
    };
  };
  const params = data.bodyParams ?? {};

  const openerName = String(params.openerName ?? "");
  const prepped = params.prepped ?? "";
  const par = params.par ?? "";
  const closer = params.closer ?? null;
  const reasonCategory = params.reasonCategory ?? "";
  const freeText = params.freeText ?? null;

  const detailLine =
    closer !== null && closer !== ""
      ? t("notifications.card.under_par.detail", {
          openerName,
          prepped: String(prepped),
          par: String(par),
          closer: String(closer),
        })
      : t("notifications.card.under_par.detail_no_estimate", {
          openerName,
          prepped: String(prepped),
          par: String(par),
        });

  const reasonLine = reasonCategory
    ? t("notifications.card.under_par.reason_prefix", {
        reasonCategory: t(
          `notifications.under_par_alert.reason.${reasonCategory}` as
            | "notifications.under_par_alert.reason.ingredient_unavailable"
            | "notifications.under_par_alert.reason.equipment_issue"
            | "notifications.under_par_alert.reason.time_constraint"
            | "notifications.under_par_alert.reason.staff_shortage"
            | "notifications.under_par_alert.reason.other",
        ),
      })
    : null;

  const trimmedFreeText =
    typeof freeText === "string" && freeText.trim().length > 0
      ? freeText.trim()
      : null;

  return {
    detailLine,
    reasonLine,
    freeText: trimmedFreeText,
  };
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
