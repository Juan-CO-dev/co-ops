"use client";

/**
 * MenuLegend — two sentences that explain the two sources. Open by default; dismissal is a
 * per-browser convenience remembered in localStorage (wrapped in try/catch — storage may be
 * unavailable, in which case the card simply renders open).
 */

import { useState, useSyncExternalStore } from "react";

import type { Translate } from "@/lib/admin/catering/menu-view-shared";

const KEY = "co.admin.menu.legend.v1";

// react-hooks/set-state-in-effect forbids reading storage + setState in a useEffect body (that
// pattern cascades a render); useSyncExternalStore's getSnapshot is the sanctioned read path for
// an external store that never notifies (subscribe is a no-op — this value only changes via our
// own dismiss() below, which forces a re-render locally instead of round-tripping storage events).
function subscribe(): () => void {
  return () => {};
}
function getSnapshot(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "dismissed";
  } catch {
    return false; // storage unavailable → stay open
  }
}
function getServerSnapshot(): boolean {
  return false;
}

export function MenuLegend({ t }: { t: Translate }) {
  const storedDismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [forceDismissed, setForceDismissed] = useState(false);
  const dismissed = storedDismissed || forceDismissed;
  if (dismissed) return null;
  const dismiss = () => {
    setForceDismissed(true);
    try { window.localStorage.setItem(KEY, "dismissed"); } catch { /* ignore */ }
  };
  return (
    <div className="co-card flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
      <span className="min-w-0">
        <span className="block text-xs font-bold uppercase tracking-wide text-co-text-muted">{t("admin.catering.menu.legend_title")}</span>
        <span className="mt-1 block text-sm text-co-text">{t("admin.catering.menu.legend_body")}</span>
      </span>
      <button type="button" onClick={dismiss} className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold text-co-text-dim transition hover:text-co-text">
        {t("admin.catering.menu.legend_dismiss")}
      </button>
    </div>
  );
}
