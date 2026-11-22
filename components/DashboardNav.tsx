"use client";

/**
 * DashboardNav — the Dashboard's "All pages" (nav PR 9, plan r2 3.4; spec 3.2 item 7; lead ruling r1 F1).
 *
 * Until nav PR 9 it was a collapsed chip list, the only route from the Dashboard to the rest of the app. Now it is ONE
 * button that opens the top bar's Go to sheet through `useGoTo().open()`: the bar's NavShell wraps the page, so this
 * button and the bar's Go to button open the SAME sheet, with the same list (the server-built `destinationsFor` of the
 * session's real role and level). For the social media manager that list is exactly its four entries, so "All pages"
 * now shows the Dashboard too (the old list dropped it): intended, the sheet is the same on every page.
 */
import { useRef } from "react";

import { useGoTo } from "@/components/nav/NavShell";

export function DashboardNav({ label }: { label: string }) {
  const { open, isOpen } = useGoTo();
  const ref = useRef<HTMLButtonElement | null>(null);
  return (
    <button
      ref={ref}
      type="button"
      data-dashboard-all-pages=""
      onClick={() => open(ref.current)}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      className="inline-flex min-h-[44px] items-center self-start text-sm font-bold text-co-text underline-offset-2 hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
    >
      {label}
    </button>
  );
}
