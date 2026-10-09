"use client";

/**
 * One section, its own clock. Every card polls /api/pulse/section on a 60 s timer (paused while the
 * tab is hidden, resumed on focus), so one slow or failing section only ever touches its own card.
 * The server-rendered first paint is the initial state; `delayMs` staggers the first refresh so the
 * attention list goes first. The last good payload is kept beside a transient error so the card can
 * show the error AND the last numbers it had.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PulseSection } from "@/lib/pulse/scope-shared";
import type { SectionState } from "@/lib/pulse/types";

export const PULSE_REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 9_000;

export type PollState<T> = SectionState<T> | { state: "loading"; asOf: null };

export function useSectionPoll<T>(args: {
  section: PulseSection;
  locationId: string;
  initial: SectionState<T> | undefined;
  delayMs?: number;
  intervalMs?: number;
}) {
  const { section, locationId, initial, delayMs = 0, intervalMs = PULSE_REFRESH_MS } = args;
  const [current, setCurrent] = useState<PollState<T>>(initial ?? { state: "loading", asOf: null });
  const [lastData, setLastData] = useState<T | null>(initial?.state === "ok" ? initial.data : null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/pulse/section?section=${section}&location=${encodeURIComponent(locationId)}`, {
        cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 401) { window.location.assign("/"); return; }
      const json = (await res.json()) as (SectionState<T> & { section?: string }) | { code?: string };
      if (!res.ok) {
        setCurrent({ state: "error", asOf: new Date().toISOString(), code: ("code" in json && json.code) || "failed" });
        return;
      }
      const next = json as SectionState<T>;
      setCurrent(next);
      if (next.state === "ok") setLastData(next.data);
    } catch {
      setCurrent({ state: "error", asOf: new Date().toISOString(), code: "network" });
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [section, locationId]);

  useEffect(() => {
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      if (!initial) void refresh();
      interval = window.setInterval(() => void refresh(), intervalMs);
    }, delayMs);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearTimeout(start);
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // `initial` only seeds state; re-subscribing on its identity would restart the clock on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, delayMs, intervalMs]);

  return { current, lastData, refresh, refreshing };
}
