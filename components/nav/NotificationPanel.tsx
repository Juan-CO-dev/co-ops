"use client";

/**
 * The bell's panel (nav PR 9, plan r2 3.1; Build #3 PR 3 Step 7's list, moved into the bar). It renders inside the shared
 * `Sheet`, so the bell and Go to share one focus trap, Escape, scroll lock, z-index and modal arbitration. Focus goes to
 * the close button on open (today's behaviour) and back to the bell on close.
 *
 * - The card IS the read surface: a tap marks it read through the moved Server Action (components/nav/
 *   notification-actions.ts); "Mark all read" posts as before. After either, the island REFETCHES (forced); there is
 *   no `router.refresh()` of the page. A refusal from either (`bell_refused`, a 401 / 403) is the island's refusal.
 * - `stale`: the last good list under "Couldn't refresh notifications. Showing what loaded before." `unavailable`:
 *   "Couldn't load notifications right now." (never "No new notifications").
 * - Codes come from the island's `codes` (the shops of exactly these notices, read with them).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { withDeadline } from "@/lib/bounded-fetch";
import { useTranslation } from "@/lib/i18n/provider";
import type { NotificationWithRecipient } from "@/lib/notifications";

import { markNotificationReadAction } from "./notification-actions";
import { NotificationCard, nyDateString } from "./NotificationCard";
import { Sheet } from "./Sheet";

/** "Mark all read" request deadline (bounded-fetch house rule). */
const MARK_ALL_TIMEOUT_MS = 10_000;

export type BellView =
  | { kind: "ok" | "stale"; notices: NotificationWithRecipient[]; codes: Record<string, string> }
  | { kind: "unavailable" }
  | { kind: "refused" };

export interface NotificationPanelProps {
  id: string;
  open: boolean;
  onClose: () => void;
  returnFocus: HTMLElement | null;
  view: BellView;
  /** A mark landed: the island refetches (forced). */
  onMarked: () => void;
  /** A mark was refused for this person: the island clears and removes the bell. */
  onRefused: () => void;
}

export function NotificationPanel({ id, open, onClose, returnFocus, view, onMarked, onRefused }: NotificationPanelProps) {
  const { t, language } = useTranslation();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [markAll, setMarkAll] = useState<"idle" | "pending" | "error">("idle");
  const [todayDate, setTodayDate] = useState(() => nyDateString(new Date()));
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setTodayDate(nyDateString(new Date())), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const list = useMemo(
    () => (view.kind === "ok" || view.kind === "stale" ? view.notices.filter((n) => !pendingIds.has(n.recipient.id)) : []),
    [view, pendingIds],
  );
  const codes = view.kind === "ok" || view.kind === "stale" ? view.codes : {};

  const onMarkAll = useCallback(async () => {
    setMarkAll("pending");
    let outcome: "ok" | "refused" | "error" = "error";
    try {
      outcome = await withDeadline(MARK_ALL_TIMEOUT_MS, async (signal) => {
        const res = await fetch("/api/notifications/mark-all-read", { method: "POST", redirect: "manual", signal });
        if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return "refused" as const;
        return res.ok ? ("ok" as const) : ("error" as const);
      });
    } catch {
      outcome = "error";
    }
    if (outcome === "refused") { onRefused(); return; }
    if (outcome === "error") { setMarkAll("error"); return; }
    setMarkAll("idle");
    onMarked();
  }, [onMarked, onRefused]);

  const onTapCard = useCallback((recipientId: string) => {
    setPendingIds((prev) => new Set(prev).add(recipientId));
    const restore = () => setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(recipientId);
      return next;
    });
    startTransition(async () => {
      try {
        const result = await markNotificationReadAction({ recipientId });
        if (result.ok) onMarked();
        else if (result.errorCode === "bell_refused") onRefused();
        else restore();
      } catch {
        restore();
      }
    });
  }, [onMarked, onRefused]);

  const headingId = `${id}-heading`;
  return (
    <Sheet id={id} open={open} onClose={onClose} labelledBy={headingId} initialFocus={closeRef} returnFocus={returnFocus}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-co-border px-4 py-3">
        <h2 id={headingId} className="text-base font-extrabold uppercase tracking-[0.14em] text-co-text">
          {t("notifications.sheet.heading")}
        </h2>
        <div className="flex items-center gap-2">
          {list.length > 0 ? (
            <button
              type="button"
              onClick={() => void onMarkAll()}
              disabled={markAll === "pending"}
              aria-label={t("notifications.sheet.mark_all_read_aria")}
              className="
                inline-flex min-h-[44px] items-center justify-center rounded-xl border-2 border-co-border-2 px-3
                text-xs font-bold uppercase tracking-[0.1em] text-co-text transition hover:border-co-text
                focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
                disabled:cursor-not-allowed disabled:opacity-50
              "
            >
              {markAll === "pending" ? t("notifications.sheet.mark_all_read_pending") : t("notifications.sheet.mark_all_read")}
            </button>
          ) : null}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t("notifications.sheet.close_aria")}
            className="
              inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-co-border-2 text-co-text-muted
              transition hover:border-co-text hover:text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>
      </header>
      {markAll === "error" ? (
        <p role="alert" className="shrink-0 px-4 pt-3 text-sm font-bold text-co-cta-text">{t("notifications.sheet.mark_all_read_error")}</p>
      ) : null}
      {view.kind === "stale" ? (
        <p role="status" data-co-bell-stale="" className="shrink-0 px-4 pt-3 text-sm text-co-warning-text">{t("notifications.sheet.stale")}</p>
      ) : null}
      <div className="flex-1 p-3 sm:p-4">
        {view.kind === "unavailable" ? (
          <p role="status" data-co-bell-unavailable="" className="py-6 text-center text-sm text-co-text-muted">{t("notifications.sheet.unavailable")}</p>
        ) : list.length === 0 ? (
          <p className="py-6 text-center text-sm text-co-text-muted">{t("notifications.empty_state")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((item) => (
              <li key={item.recipient.id}>
                <NotificationCard
                  item={item}
                  locationCodes={codes}
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
    </Sheet>
  );
}
