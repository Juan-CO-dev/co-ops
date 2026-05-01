"use client";

/**
 * ClosingClient — Module #1 Build #1 step 9.
 *
 * Interactive client surface for the Closing Checklist. Receives hydrated
 * initial state from the page Server Component (template items, current
 * completions, authors, instance, actor, readOnly flag, status banner).
 * Owns: top-level completions Map, station expand/collapse derived state,
 * reason-draft Map, review-section open/closed, PinConfirmModal mount.
 *
 * Architectural seams (per Module #1 Build #1 design):
 *   - onComplete callback per ChecklistItem fires POST /api/checklist/completions
 *     and updates the parent's completion Map. Optimistic flip is owned
 *     locally inside ChecklistItem (per step 6); parent just records the
 *     committed result.
 *   - Review section's "Continue" button uses the function-prop seam
 *     (`onContinue: () => setPinOpen(true)`). Build #2 Phase 2 (AM Prep
 *     List generation per SPEC_AMENDMENTS.md C.19) swaps this to a
 *     navigate-to-Phase-2 callback; the review section itself doesn't
 *     change.
 *   - PinConfirmModal is mounted at the page level (not inside the review
 *     section) so its lifecycle is independent of the review collapse.
 *
 * Read-only mode behavior (per step 9 Dim 8 pushback):
 *   - Strict for yesterday-unconfirmed: no Review section, no PinConfirmModal,
 *     ChecklistItem rows show as non-interactive. Banner text instructs
 *     contact-a-manager. Forensic: opener wasn't there; can't honestly
 *     attest. Management override path lands in Phase 5+ admin tools.
 *   - Same code path for older historical (status='confirmed' / etc.) and
 *     today-already-confirmed. Banner copy distinguishes per status.
 *
 * Auto-collapse-on-scroll-past (per step 9 Dim 12 pushback):
 *   - Stations don't collapse mid-tap. They collapse only when the closer
 *     scrolls past a fully-complete station (its bottom edge above viewport
 *     top, observed via IntersectionObserver). Manual taps to expand/collapse
 *     work normally and override the auto-derive once until the next
 *     scroll-past observation.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  ChecklistItem,
  type ChecklistApiError,
  type ChecklistCompletePayload,
  type ChecklistCompleteResult,
} from "@/components/ChecklistItem";
import { PinConfirmModal } from "@/components/auth/PinConfirmModal";
import type {
  ChecklistCompletion,
  ChecklistInstance,
  ChecklistStatus,
  ChecklistTemplateItem,
} from "@/lib/types";
import type { RoleCode } from "@/lib/roles";

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirrors what page.tsx hydrates
// ─────────────────────────────────────────────────────────────────────────────

export type StatusBannerTone =
  | "confirmed"
  | "incomplete_confirmed"
  | "yesterday_unconfirmed"
  | "historical";

export interface StatusBanner {
  tone: StatusBannerTone;
  message: string;
}

export interface ClosingInitialState {
  location: { id: string; name: string; code: string };
  instance: ChecklistInstance;
  templateItems: ChecklistTemplateItem[];
  initialCompletions: Record<string, ChecklistCompletion>;
  authors: Record<string, string>;
  actor: { userId: string; role: RoleCode; level: number };
  readOnly: boolean;
  banner: StatusBanner | null;
  todayDate: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATION_FALLBACK = "General";

function groupByStation(items: ChecklistTemplateItem[]): Map<string, ChecklistTemplateItem[]> {
  const out = new Map<string, ChecklistTemplateItem[]>();
  for (const it of items) {
    const key = it.station ?? STATION_FALLBACK;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(it);
  }
  // Items already in display_order from the DB; preserve.
  return out;
}

function countRequiredComplete(
  items: ChecklistTemplateItem[],
  completions: Map<string, ChecklistCompletion>,
): { completed: number; required: number } {
  let required = 0;
  let completed = 0;
  for (const it of items) {
    if (!it.required) continue;
    required += 1;
    if (completions.has(it.id)) completed += 1;
  }
  return { completed, required };
}

function isStationFullyComplete(
  items: ChecklistTemplateItem[],
  completions: Map<string, ChecklistCompletion>,
): boolean {
  // "Fully complete" for collapse purposes = every required item completed.
  // Below-role items aren't gated here; they collapse with the station
  // because the closer can't act on them anyway. The station header will
  // surface "1 awaiting AGM" so the closer knows.
  for (const it of items) {
    if (!it.required) continue;
    if (!completions.has(it.id)) return false;
  }
  return true;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export function ClosingClient({ initialState }: { initialState: ClosingInitialState }) {
  const {
    location,
    instance: initialInstance,
    templateItems,
    initialCompletions,
    authors,
    actor,
    readOnly: initialReadOnly,
    banner: initialBanner,
  } = initialState;

  // Live state.
  const [instance, setInstance] = useState<ChecklistInstance>(initialInstance);
  const [completions, setCompletions] = useState<Map<string, ChecklistCompletion>>(() => {
    const m = new Map<string, ChecklistCompletion>();
    for (const [k, v] of Object.entries(initialCompletions)) m.set(k, v);
    return m;
  });
  const [authorMap, setAuthorMap] = useState<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(authors)) m.set(k, v);
    return m;
  });
  const [banner, setBanner] = useState<StatusBanner | null>(initialBanner);
  const [readOnly, setReadOnly] = useState<boolean>(initialReadOnly);

  // Reasons (template_item_id → reason text). Drafts only; not committed
  // until confirm.
  const [reasonDrafts, setReasonDrafts] = useState<Map<string, string>>(new Map());

  // Review section + PIN modal flags.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

  // Per-station collapse state. Initial: all expanded.
  const stationGroups = useMemo(() => groupByStation(templateItems), [templateItems]);
  const stationKeys = useMemo(() => Array.from(stationGroups.keys()), [stationGroups]);
  const [stationExpanded, setStationExpanded] = useState<Map<string, boolean>>(() => {
    const m = new Map<string, boolean>();
    for (const k of stationKeys) m.set(k, true);
    return m;
  });

  // Progress.
  const totalCount = useMemo(
    () => countRequiredComplete(templateItems, completions),
    [templateItems, completions],
  );

  const allRequiredDone = totalCount.completed === totalCount.required;

  // Incomplete-required IDs — for the review section's reason inputs.
  const incompleteRequiredIds = useMemo(() => {
    const ids: string[] = [];
    for (const it of templateItems) {
      if (it.required && !completions.has(it.id)) ids.push(it.id);
    }
    return ids;
  }, [templateItems, completions]);

  // ─── onComplete callback (passed to each ChecklistItem) ─────────────────

  const handleItemComplete = useCallback(
    async (payload: ChecklistCompletePayload): Promise<ChecklistCompleteResult> => {
      try {
        const res = await fetch("/api/checklist/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instanceId: instance.id,
            templateItemId: payload.templateItemId,
            countValue: payload.countValue ?? null,
            photoId: payload.photoId ?? null,
            notes: payload.notes ?? null,
          }),
          redirect: "manual",
        });
        if (res.ok) {
          const data = (await res.json()) as { completion: ChecklistCompletion };
          // Commit to parent state — replaces any prior live completion for
          // this template_item_id (the lib already superseded the prior on
          // the server side; the parent map only tracks the live row).
          setCompletions((prev) => {
            const next = new Map(prev);
            next.set(payload.templateItemId, data.completion);
            return next;
          });
          // Author name for the new completion is the actor — we already
          // know this user (no fetch needed).
          setAuthorMap((prev) => {
            if (prev.has(actor.userId)) return prev;
            // We don't have the actor's display name here; the page hydrated
            // authors only for users already present in completions. Use a
            // stable fallback that ChecklistItem's completionAuthor.isSelf
            // path renders as "you" anyway.
            const next = new Map(prev);
            next.set(actor.userId, "you");
            return next;
          });
          return { completion: data.completion };
        }
        let body: ChecklistApiError;
        try {
          body = (await res.json()) as ChecklistApiError;
        } catch {
          body = { code: "unknown", message: "Save failed." };
        }
        return { error: body };
      } catch (err) {
        return {
          error: {
            code: "network",
            message: err instanceof Error ? err.message : "Network error.",
          },
        };
      }
    },
    [instance.id, actor.userId],
  );

  // ─── PinConfirmModal callbacks ──────────────────────────────────────────

  const handlePinConfirmed = useCallback(
    (confirmedInstance: ChecklistInstance) => {
      setInstance(confirmedInstance);
      setPinOpen(false);
      setReviewOpen(false);
      setReadOnly(true);
      // Banner reflects new status.
      const time = confirmedInstance.confirmedAt
        ? formatTime(confirmedInstance.confirmedAt)
        : "";
      const who = "you";
      if (confirmedInstance.status === "confirmed") {
        setBanner({
          tone: "confirmed",
          message: `Closing confirmed${time ? ` · ${time}` : ""} by ${who}`,
        });
      } else {
        setBanner({
          tone: "incomplete_confirmed",
          message: `Closing submitted with incomplete items${time ? ` · ${time}` : ""} by ${who}`,
        });
      }
    },
    [],
  );

  const handlePinError = useCallback((err: ChecklistApiError) => {
    // Non-recoverable errors (instance_closed, role_level_insufficient,
    // missing/extra reasons, supersede_failed, missing_count/photo) bubble
    // up here. Modal already surfaced an inline message; we close it and
    // let the page reflect updated state (e.g., instance_closed → re-fetch
    // would show the page in read-only mode if the user reloads).
    setPinOpen(false);
    if (err.code === "instance_closed") {
      // Best signal we can give without a re-fetch: show the historical-style
      // banner so the closer knows their attempt landed on an already-closed
      // instance.
      setReadOnly(true);
      setBanner({
        tone: "historical",
        message: "This closing was already submitted by another user. Reload to view.",
      });
    }
  }, []);

  // ─── Auto-collapse on scroll-past via IntersectionObserver ──────────────

  // We track each station's wrapper element by ref. When the wrapper's
  // bottom edge scrolls above the viewport top (intersectionRatio === 0
  // AND boundingClientRect.bottom < 0), we treat the station as
  // "scrolled past." If it's also fully complete, collapse it.
  const stationRefs = useRef<Map<string, HTMLElement>>(new Map());
  // Snapshot of completion fullness per station, read inside the IO callback
  // to avoid stale closures.
  const stationFullnessRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    const m = new Map<string, boolean>();
    for (const [station, items] of stationGroups) {
      m.set(station, isStationFullyComplete(items, completions));
    }
    stationFullnessRef.current = m;
  }, [stationGroups, completions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;
    if (readOnly) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const station = e.target.getAttribute("data-station");
          if (!station) continue;
          const isFull = stationFullnessRef.current.get(station) ?? false;
          if (!isFull) continue;
          // Scrolled past = bottom of element is above viewport top.
          const rect = e.boundingClientRect;
          if (rect.bottom < 0) {
            setStationExpanded((prev) => {
              if (prev.get(station) === false) return prev;
              const next = new Map(prev);
              next.set(station, false);
              return next;
            });
          }
        }
      },
      // Threshold 0 fires when crossing into / out of the viewport.
      { threshold: 0, rootMargin: "0px 0px 0px 0px" },
    );

    for (const [, el] of stationRefs.current) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [stationGroups, readOnly]);

  const setStationRef = useCallback((station: string) => {
    return (el: HTMLElement | null) => {
      if (el) stationRefs.current.set(station, el);
      else stationRefs.current.delete(station);
    };
  }, []);

  const toggleStation = useCallback((station: string) => {
    setStationExpanded((prev) => {
      const next = new Map(prev);
      next.set(station, !(prev.get(station) ?? true));
      return next;
    });
  }, []);

  // ─── Review section gate ────────────────────────────────────────────────

  const handleReviewToggle = useCallback(() => {
    setReviewOpen((prev) => !prev);
  }, []);

  // Compute incomplete-required reasons completeness — every incomplete
  // required item must have a non-empty reason draft before Continue can fire.
  const reasonsReady = useMemo(() => {
    if (incompleteRequiredIds.length === 0) return true;
    for (const id of incompleteRequiredIds) {
      const r = reasonDrafts.get(id);
      if (!r || r.trim().length === 0) return false;
    }
    return true;
  }, [incompleteRequiredIds, reasonDrafts]);

  const handleContinue = useCallback(() => {
    // Function-prop seam (per SPEC_AMENDMENTS.md C.19): Build #1 opens the
    // PIN modal; Build #2 swaps to navigate-to-Phase-2.
    setPinOpen(true);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────

  const headerLabel = `${location.code} · ${location.name}`;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      {/* Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          Closing checklist
        </p>
        <h1 className="mt-1 text-2xl font-extrabold leading-tight text-co-text">
          {headerLabel}
        </h1>
      </div>

      {/* Status banner */}
      {banner ? <BannerView banner={banner} /> : null}

      {/* Sticky top progress bar */}
      <div className="sticky top-0 z-20 -mx-4 mt-4 border-b border-co-border bg-co-bg/90 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
            Progress
          </span>
          <span className="text-xs font-semibold tabular-nums text-co-text">
            {totalCount.completed} of {totalCount.required} required
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-co-border">
          <div
            className="h-full rounded-full bg-co-gold transition-[width] duration-300"
            style={{
              width: totalCount.required === 0 ? "0%" : `${Math.round((totalCount.completed / totalCount.required) * 100)}%`,
            }}
            aria-hidden
          />
        </div>
      </div>

      {/* Stations */}
      <div className="mt-4 flex flex-col gap-4">
        {stationKeys.map((station) => {
          const items = stationGroups.get(station) ?? [];
          return (
            <StationGroup
              key={station}
              station={station}
              items={items}
              completions={completions}
              authorMap={authorMap}
              actor={actor}
              instanceStatus={instance.status}
              readOnly={readOnly}
              expanded={stationExpanded.get(station) ?? true}
              onToggle={() => toggleStation(station)}
              onComplete={handleItemComplete}
              setRef={setStationRef(station)}
            />
          );
        })}
      </div>

      {/*
       * Finalization UI is role-gated. Per CO's Model A (SPEC_AMENDMENTS.md
       * C.26): closing is multi-author over hours; employees + KH+ all tick
       * items throughout the shift via the optimistic UI. ONE person
       * finalizes — typically the "last out" KH or AGM who completed
       * Walk-Out Verification — and that person attests with PIN.
       *
       * Item completion: open to anyone whose level >= each item's
       * min_role_level (gated inside ChecklistItem + RLS in
       * lib/checklists.ts).
       * Finalization (review screen + sticky footer + PIN modal): gated to
       * actorLevel >= 4 (KH+) here. Below KH, no submit path renders;
       * employees contribute work and walk away. Their items are already
       * saved individually.
       *
       * The PinConfirmModal mount below is also gated — no path leads to it
       * for level 3 actors, so omitting the mount keeps the React tree
       * minimal AND defends against any future code path that tries to
       * setPinOpen(true) directly.
       */}
      {!readOnly && actor.level >= 4 ? (
        <>
          {/* Inline submit at end of list */}
          <div className="mt-8 flex flex-col gap-2">
            <button
              type="button"
              onClick={handleReviewToggle}
              className={[
                "inline-flex min-h-[64px] w-full items-center justify-center rounded-xl",
                "px-5 text-base font-bold uppercase tracking-[0.12em]",
                "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
                allRequiredDone
                  ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
                  : "border-2 border-co-border-2 bg-co-surface text-co-text hover:border-co-text",
              ].join(" ")}
            >
              {reviewOpen ? "Hide review" : allRequiredDone ? "Review & submit" : "Review & submit (incomplete)"}
            </button>
            <p className="text-center text-[11px] text-co-text-muted">
              {totalCount.completed} of {totalCount.required} required complete
            </p>
          </div>

          {/* Review section — inline scroll-down */}
          {reviewOpen ? (
            <ReviewSection
              templateItems={templateItems}
              completions={completions}
              incompleteRequiredIds={incompleteRequiredIds}
              reasonDrafts={reasonDrafts}
              setReasonDrafts={setReasonDrafts}
              reasonsReady={reasonsReady}
              onContinue={handleContinue}
            />
          ) : null}

          {/* Sticky footer — always-reachable shortcut, less prominent */}
          <StickyFooter
            completed={totalCount.completed}
            required={totalCount.required}
            allRequiredDone={allRequiredDone}
            onTap={() => {
              setReviewOpen(true);
              // Best-effort scroll the review section into view.
              if (typeof window !== "undefined") {
                window.requestAnimationFrame(() => {
                  const el = document.getElementById("closing-review");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }
            }}
          />
        </>
      ) : null}

      {/* Read-only — quick "back to dashboard" affordance */}
      {readOnly ? (
        <div className="mt-8 flex justify-center">
          <a
            href="/dashboard"
            className="
              inline-flex min-h-[48px] items-center justify-center rounded-md
              border-2 border-co-text bg-co-surface px-4 text-sm font-bold uppercase tracking-[0.12em] text-co-text
              transition hover:bg-co-surface-2
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            "
          >
            Back to dashboard
          </a>
        </div>
      ) : null}

      {/* PinConfirmModal — mounted only when finalization is gate-allowed
       * (matches the actorLevel >= 4 gate above per SPEC_AMENDMENTS.md C.26).
       * Defense-in-depth: even if a future code path tries to setPinOpen(true)
       * for a level-3 actor, the mount is absent and the modal can't render. */}
      {!readOnly && actor.level >= 4 ? (
        <PinConfirmModal
          open={pinOpen}
          instanceId={instance.id}
          incompleteReasons={incompleteRequiredIds.map((id) => ({
            templateItemId: id,
            reason: (reasonDrafts.get(id) ?? "").trim(),
          }))}
          onConfirmed={handlePinConfirmed}
          onError={handlePinError}
          onCancel={() => setPinOpen(false)}
        />
      ) : null}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Banner
// ─────────────────────────────────────────────────────────────────────────────

function BannerView({ banner }: { banner: StatusBanner }) {
  const tone = banner.tone;
  const baseClasses =
    "mt-4 flex items-start gap-3 rounded-2xl border-2 p-4 sm:p-5";
  const styles: Record<StatusBannerTone, { container: string; iconBg: string; icon: ReactNode }> = {
    confirmed: {
      container: "border-co-success/60 bg-[#E8F7EE]",
      iconBg: "bg-co-success text-white",
      icon: <CheckMarkIcon />,
    },
    incomplete_confirmed: {
      container: "border-co-warning/60 bg-[#FFF4D0]",
      iconBg: "bg-co-warning text-co-text",
      icon: <WarningIcon />,
    },
    yesterday_unconfirmed: {
      container: "border-co-gold-deep bg-[#FFF4D0]",
      iconBg: "bg-co-gold-deep text-co-text",
      icon: <WarningIcon />,
    },
    historical: {
      container: "border-co-border-2 bg-co-surface-2",
      iconBg: "bg-co-text-faint text-white",
      icon: <InfoIcon />,
    },
  };
  const s = styles[tone];
  return (
    <section role="status" aria-live="polite" className={`${baseClasses} ${s.container}`}>
      <span
        aria-hidden
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${s.iconBg}`}
      >
        {s.icon}
      </span>
      <p className="text-sm font-semibold text-co-text">{banner.message}</p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StationGroup
// ─────────────────────────────────────────────────────────────────────────────

function StationGroup({
  station,
  items,
  completions,
  authorMap,
  actor,
  instanceStatus,
  readOnly,
  expanded,
  onToggle,
  onComplete,
  setRef,
}: {
  station: string;
  items: ChecklistTemplateItem[];
  completions: Map<string, ChecklistCompletion>;
  authorMap: Map<string, string>;
  actor: { userId: string; role: RoleCode; level: number };
  instanceStatus: ChecklistStatus;
  readOnly: boolean;
  expanded: boolean;
  onToggle: () => void;
  onComplete: (payload: ChecklistCompletePayload) => Promise<ChecklistCompleteResult>;
  setRef: (el: HTMLElement | null) => void;
}) {
  const requiredItems = items.filter((it) => it.required);
  const completedRequired = requiredItems.filter((it) => completions.has(it.id)).length;
  const totalRequired = requiredItems.length;
  const fullyComplete = totalRequired > 0 && completedRequired === totalRequired;

  // Items above the actor's level — surface count so closer knows what's
  // still pending from a higher role even when the station "looks done."
  const aboveRoleCount = items.filter(
    (it) => it.minRoleLevel > actor.level && !completions.has(it.id),
  ).length;

  return (
    <section
      data-station={station}
      ref={setRef}
      aria-label={`${station} station`}
      className="rounded-2xl border-2 border-co-border bg-co-surface"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="
          flex w-full items-center justify-between gap-3 px-4 py-3
          text-left
          focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
        "
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2">
            {fullyComplete ? (
              <span aria-hidden className="text-co-success">
                <SmallCheckIcon />
              </span>
            ) : null}
            <span className="text-sm font-bold uppercase tracking-[0.14em] text-co-text">
              {station}
            </span>
          </span>
          <span className="text-[11px] text-co-text-muted">
            {completedRequired} of {totalRequired} required done
            {aboveRoleCount > 0 ? ` · ${aboveRoleCount} awaiting higher role` : ""}
          </span>
        </div>
        <span aria-hidden className="text-co-text-muted">
          {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </span>
      </button>

      {expanded ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {items.map((it) => {
            const c = completions.get(it.id) ?? null;
            const author = c
              ? {
                  name: authorMap.get(c.completedBy) ?? "—",
                  isSelf: c.completedBy === actor.userId,
                }
              : null;
            return (
              <ChecklistItem
                key={it.id}
                templateItem={it}
                completion={c}
                completionAuthor={author}
                actorLevel={actor.level}
                instanceStatus={instanceStatus}
                readOnly={readOnly}
                onComplete={onComplete}
              />
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReviewSection
// ─────────────────────────────────────────────────────────────────────────────

function ReviewSection({
  templateItems,
  completions,
  incompleteRequiredIds,
  reasonDrafts,
  setReasonDrafts,
  reasonsReady,
  onContinue,
}: {
  templateItems: ChecklistTemplateItem[];
  completions: Map<string, ChecklistCompletion>;
  incompleteRequiredIds: string[];
  reasonDrafts: Map<string, string>;
  setReasonDrafts: (updater: (prev: Map<string, string>) => Map<string, string>) => void;
  reasonsReady: boolean;
  onContinue: () => void;
}) {
  const itemsById = useMemo(() => {
    const m = new Map<string, ChecklistTemplateItem>();
    for (const it of templateItems) m.set(it.id, it);
    return m;
  }, [templateItems]);

  const completedCount = templateItems.filter((it) => it.required && completions.has(it.id)).length;
  const requiredTotal = templateItems.filter((it) => it.required).length;
  const incompleteTotal = incompleteRequiredIds.length;
  const allDone = incompleteTotal === 0;

  return (
    <section
      id="closing-review"
      aria-label="Review and submit"
      className="mt-6 rounded-2xl border-2 border-co-text bg-co-surface p-5 sm:p-6"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        Review &amp; submit
      </p>
      <h2 className="mt-1 text-lg font-extrabold text-co-text">
        {allDone
          ? "All required items complete"
          : `${completedCount} of ${requiredTotal} required complete`}
      </h2>
      {!allDone ? (
        <p className="mt-1 text-sm text-co-text-muted">
          {incompleteTotal} item{incompleteTotal === 1 ? "" : "s"} require{" "}
          {incompleteTotal === 1 ? "a " : ""}written reason
          {incompleteTotal === 1 ? "" : "s"} before you submit.
        </p>
      ) : (
        <p className="mt-1 text-sm text-co-text-muted">
          Tap continue to confirm with your PIN.
        </p>
      )}

      {/* Incomplete-required reason inputs */}
      {incompleteRequiredIds.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          {incompleteRequiredIds.map((id) => {
            const it = itemsById.get(id);
            if (!it) return null;
            const draft = reasonDrafts.get(id) ?? "";
            return (
              <label key={id} className="block">
                <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
                  {it.station ?? STATION_FALLBACK} · {it.label}
                </span>
                <textarea
                  value={draft}
                  onChange={(e) => {
                    const v = e.target.value;
                    setReasonDrafts((prev) => {
                      const next = new Map(prev);
                      next.set(id, v);
                      return next;
                    });
                  }}
                  rows={2}
                  placeholder="Why couldn't this be completed?"
                  className="
                    mt-1 w-full rounded-md border-2 border-co-border bg-white px-3 py-2
                    text-sm text-co-text
                    focus:outline-none focus:border-co-gold focus-visible:ring-4 focus-visible:ring-co-gold/40
                  "
                />
              </label>
            );
          })}
        </div>
      ) : null}

      {/* Continue */}
      <button
        type="button"
        onClick={onContinue}
        disabled={!reasonsReady}
        className={[
          "mt-5 inline-flex min-h-[56px] w-full items-center justify-center rounded-xl",
          "px-5 text-base font-bold uppercase tracking-[0.12em]",
          "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
          reasonsReady
            ? "border-2 border-co-text bg-co-gold text-co-text hover:bg-co-gold-deep"
            : "border-2 border-co-border-2 bg-co-surface text-co-text-faint cursor-not-allowed",
        ].join(" ")}
      >
        Continue to PIN confirm
      </button>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StickyFooter — always-reachable shortcut, less prominent than inline button
// ─────────────────────────────────────────────────────────────────────────────

function StickyFooter({
  completed,
  required,
  allRequiredDone,
  onTap,
}: {
  completed: number;
  required: number;
  allRequiredDone: boolean;
  onTap: () => void;
}) {
  // Reduced opacity + smaller height per step 9 Dim 11 pushback: sticky is
  // the shortcut, not the destination. Inline submit at the bottom of the
  // list is the primary natural-arc-completion CTA.
  return (
    <div
      className="
        pointer-events-none fixed inset-x-0 bottom-0 z-30
        flex justify-center px-4 pb-3
      "
      aria-hidden={false}
    >
      <button
        type="button"
        onClick={onTap}
        style={{ "--alpha": "0.92" } as CSSProperties}
        className={[
          "pointer-events-auto inline-flex min-h-[52px] items-center justify-center rounded-full",
          "px-5 text-xs font-bold uppercase tracking-[0.14em] shadow-md",
          "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
          "max-w-md w-full",
          allRequiredDone
            ? "border-2 border-co-text bg-co-gold/95 text-co-text hover:bg-co-gold-deep"
            : "border-2 border-co-border-2 bg-co-surface/95 text-co-text-muted hover:border-co-text hover:text-co-text",
        ].join(" ")}
      >
        Review &amp; submit · {completed}/{required}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG icons
// ─────────────────────────────────────────────────────────────────────────────

function CheckMarkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 7.5L6 10.5L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5L15 14H1L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M8 6v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 6.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.75" r="0.75" fill="currentColor" />
    </svg>
  );
}

function SmallCheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="6" fill="currentColor" />
      <path d="M4 7.2L6 9.2L10 5" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 6L8 11L13 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 10L8 5L13 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
