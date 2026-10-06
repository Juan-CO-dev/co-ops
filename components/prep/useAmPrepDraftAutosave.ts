"use client";

/**
 * useAmPrepDraftAutosave — mirrors the AM prep form's state to POST /api/prep/draft
 * (migration 0214) so a count survives leaving the page, the idle timeout, a closed tab or
 * a second phone. Pattern: the opening Phase 1 autosave (opening-client.tsx, LRA-121).
 *
 * When it saves:
 *   - about 1 s after the last edit (AM_PREP_DRAFT_DEBOUNCE_MS — a burst of keystrokes is
 *     one POST);
 *   - at once on blur (`flushNow`, wired to the form's focus-out);
 *   - on visibilitychange→hidden, pagehide and UNMOUNT via `navigator.sendBeacon`, which the
 *     browser delivers even as the page goes away. Unmount matters here: the idle timeout
 *     and the BackLink leave by a client-side navigation, which fires no pagehide.
 *
 * What it sends: a PATCH of the lines that changed since the last SUCCESSFUL save; the
 * server merges it line by line (see lib/am-prep-draft-shared.ts for why). The baseline
 * advances only on success, so whatever failed is simply in the next patch.
 *
 * NEVER BLOCKS TYPING. A failure sets a quiet status and schedules a retry with backoff
 * (2 s → 30 s) when the failure is a blip (network, 5xx, 401, 408, 429); a verdict (409
 * submitted, 403) stops the timer and the next edit tries again. No modal, no disabled
 * control.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AM_PREP_DRAFT_DEBOUNCE_MS,
  AM_PREP_DRAFT_VERSION,
  amPrepDraftRetryDelayMs,
  diffAmPrepDraftItems,
  isRetryableAmPrepDraftFailure,
  mergeAmPrepDraftItems,
  normalizeAmPrepDraftItems,
  type AmPrepDraftItem,
} from "@/lib/am-prep-draft-shared";

import type { RawPrepInputs } from "./types";

export type AmPrepDraftSaveStatus = "idle" | "saving" | "saved" | "retrying" | "failed";

const DRAFT_ENDPOINT = "/api/prep/draft";

export function useAmPrepDraftAutosave(args: {
  /** False outside a first submission of an open instance; also flips false after submit. */
  enabled: boolean;
  instanceId: string;
  rawValues: Record<string, RawPrepInputs>;
  /** The lines the server held when the page loaded (the restored draft), or {}. */
  serverItems: Record<string, AmPrepDraftItem>;
}): { status: AmPrepDraftSaveStatus; flushNow: () => void } {
  const { enabled, instanceId, rawValues, serverItems } = args;
  const [status, setStatus] = useState<AmPrepDraftSaveStatus>("idle");

  // Baseline: what the server is known to hold. Seeded once from the restored draft, so a
  // page load that hydrates FROM the draft posts nothing.
  const lastSavedRef = useRef<Record<string, AmPrepDraftItem> | null>(null);
  if (lastSavedRef.current === null) lastSavedRef.current = normalizeAmPrepDraftItems(serverItems);

  const current = useMemo(() => normalizeAmPrepDraftItems(rawValues), [rawValues]);
  const latestRef = useRef<Record<string, AmPrepDraftItem>>(current);
  const enabledRef = useRef(enabled);
  const instanceIdRef = useRef(instanceId);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const attemptRef = useRef(0);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const schedule = useCallback(
    (ms: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flushRef.current();
      }, ms);
    },
    [clearTimer],
  );

  const pendingPatch = useCallback(
    () => diffAmPrepDraftItems(lastSavedRef.current ?? {}, latestRef.current),
    [],
  );

  const flush = useCallback(async () => {
    clearTimer();
    if (!enabledRef.current || inFlightRef.current) return;
    const patch = pendingPatch();
    if (Object.keys(patch).length === 0) return;

    inFlightRef.current = true;
    setStatus("saving");
    let httpStatus: number | null = null;
    try {
      const res = await fetch(DRAFT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instanceIdRef.current,
          draft: { version: AM_PREP_DRAFT_VERSION, items: patch },
        }),
        redirect: "manual",
      });
      // An opaque redirect (status 0) is the proxy bouncing an expired session — treat it
      // as a network-class blip, like 401.
      httpStatus = res.status === 0 ? null : res.status;
      if (res.ok) {
        lastSavedRef.current = mergeAmPrepDraftItems(lastSavedRef.current ?? {}, patch);
        attemptRef.current = 0;
        inFlightRef.current = false;
        setStatus("saved");
        // Edits that landed while this save was in flight go out on the next tick.
        if (enabledRef.current && Object.keys(pendingPatch()).length > 0) {
          schedule(AM_PREP_DRAFT_DEBOUNCE_MS);
        }
        return;
      }
    } catch {
      httpStatus = null;
    }
    inFlightRef.current = false;
    if (!enabledRef.current) return;
    if (isRetryableAmPrepDraftFailure(httpStatus)) {
      attemptRef.current += 1;
      setStatus("retrying");
      schedule(amPrepDraftRetryDelayMs(attemptRef.current));
    } else {
      attemptRef.current = 0;
      setStatus("failed");
    }
  }, [clearTimer, pendingPatch, schedule]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    instanceIdRef.current = instanceId;
  }, [instanceId]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) clearTimer();
  }, [enabled, clearTimer]);

  // Every change to the form: remember it, and (re)start the debounce if it differs from
  // what the server holds. Cleanup is NOT the coalescing here (the timer lives in a ref so
  // a retry timer survives re-renders); `schedule` replaces any pending timer instead.
  useEffect(() => {
    latestRef.current = current;
    if (!enabled) return;
    if (Object.keys(pendingPatch()).length === 0) return;
    schedule(AM_PREP_DRAFT_DEBOUNCE_MS);
  }, [current, enabled, pendingPatch, schedule]);

  // The page is going away (tab hidden, phone locked, navigation, idle sign-out): hand the
  // unsaved lines to the browser with sendBeacon, which survives unload.
  useEffect(() => {
    const beacon = () => {
      if (!enabledRef.current) return;
      const patch = pendingPatch();
      if (Object.keys(patch).length === 0) return;
      if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
      const body = JSON.stringify({
        instanceId: instanceIdRef.current,
        draft: { version: AM_PREP_DRAFT_VERSION, items: patch },
      });
      const queued = navigator.sendBeacon(
        DRAFT_ENDPOINT,
        new Blob([body], { type: "text/plain;charset=UTF-8" }),
      );
      // Claim it only on a successful ENQUEUE; a refused beacon stays in the next patch.
      if (queued) {
        lastSavedRef.current = mergeAmPrepDraftItems(lastSavedRef.current ?? {}, patch);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") beacon();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", beacon);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", beacon);
      clearTimer();
      beacon();
    };
  }, [clearTimer, pendingPatch]);

  const flushNow = useCallback(() => {
    void flushRef.current();
  }, []);

  return { status, flushNow };
}
