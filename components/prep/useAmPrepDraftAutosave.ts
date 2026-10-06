"use client";

/**
 * useAmPrepDraftAutosave — mirrors the AM prep form's state to POST /api/prep/draft
 * (migration 0214) so a count survives leaving the page, the idle timeout, a closed tab or
 * a second phone. Pattern: the opening Phase 1 autosave (opening-client.tsx, LRA-121).
 *
 * The logic lives in `AmPrepDraftAutosaver` (lib/am-prep-draft-autosave.ts, framework-free
 * and unit-tested); this hook only wires the browser to it:
 *   - every form change → `update` (about 1 s debounce);
 *   - blur → `flushNow`;
 *   - visibilitychange→hidden, pagehide, unmount → a best-effort `sendBeacon` that NEVER
 *     counts as saved (unmount matters: the idle timeout and the BackLink leave by a
 *     client-side navigation, which fires no pagehide);
 *   - visibilitychange→visible → re-send everything the server has not acknowledged.
 * A fetch that stalls is aborted after 15 s so it cannot block the single-flight queue.
 *
 * NEVER BLOCKS TYPING. Failures only change the quiet status line.
 */

import { useCallback, useEffect, useState } from "react";

import {
  AmPrepDraftAutosaver,
  type AmPrepDraftSaveStatus,
} from "@/lib/am-prep-draft-autosave";
import type { AmPrepDraftItem } from "@/lib/am-prep-draft-shared";

import type { RawPrepInputs } from "./types";

export type { AmPrepDraftSaveStatus };

const DRAFT_ENDPOINT = "/api/prep/draft";
const FETCH_TIMEOUT_MS = 15_000;

function createSaver(
  instanceId: string,
  serverItems: Record<string, AmPrepDraftItem>,
  onStatus: (s: AmPrepDraftSaveStatus) => void,
): AmPrepDraftAutosaver {
  return new AmPrepDraftAutosaver(
    {
      post: async (body) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(DRAFT_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            redirect: "manual",
            signal: controller.signal,
          });
          return { ok: res.ok, status: res.status };
        } finally {
          clearTimeout(timer);
        }
      },
      beacon: (body) => {
        if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
          return false;
        }
        return navigator.sendBeacon(
          DRAFT_ENDPOINT,
          new Blob([body], { type: "text/plain;charset=UTF-8" }),
        );
      },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onStatus,
    },
    instanceId,
    serverItems,
  );
}

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
  // One saver per mounted form, created on first use (state initializer runs once).
  const [saver] = useState(() => createSaver(instanceId, serverItems, setStatus));

  useEffect(() => {
    saver.setEnabled(enabled);
  }, [saver, enabled]);

  useEffect(() => {
    saver.update(rawValues);
  }, [saver, rawValues]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saver.onHidden();
      else if (document.visibilityState === "visible") saver.onVisible();
    };
    const onPageHide = () => saver.onHidden();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      saver.dispose();
    };
  }, [saver]);

  const flushNow = useCallback(() => {
    void saver.flush();
  }, [saver]);

  return { status, flushNow };
}
