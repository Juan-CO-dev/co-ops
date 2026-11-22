"use client";

/**
 * One notification card (Build #3 PR 3 Step 7; moved here from components/dashboard/NotificationList.tsx by nav PR 9 so
 * the top bar's bell panel and, until step 11, the Dashboard's old list render the same card). The card IS the read
 * surface (Option A'): a tap marks it read; no drill-through. Cross-day createdAt adds the date label; times and dates
 * go through the language-aware helpers (lib/i18n/format.ts).
 */
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import { useTranslation } from "@/lib/i18n/provider";
import { formatNotification, underParDetailKey, type NotificationWithRecipient } from "@/lib/notifications";

const OPERATIONAL_TZ = "America/New_York";

/** YYYY-MM-DD in the operational time zone. */
export function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export interface NotificationCardProps {
  item: NotificationWithRecipient;
  locationCodes: Record<string, string>;
  todayDate: string;
  isPending: boolean;
  onTap: () => void;
  t: ReturnType<typeof useTranslation>["t"];
  language: ReturnType<typeof useTranslation>["language"];
}

export function NotificationCard({
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

  // B11a: rows written before 0255 carry no `par` — pick the no-par variant rather than
  // rendering "par ,". The variant omits only the slots it has no value for.
  const detailLine = t(underParDetailKey({ par, closer }), {
    openerName,
    prepped: String(prepped),
    par: String(par),
    closer: String(closer ?? ""),
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

