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
  type ChecklistPickerResult,
  type ChecklistRevokeResult,
  type ChecklistTagResult,
} from "@/components/ChecklistItem";
import { PinConfirmModal } from "@/components/auth/PinConfirmModal";
import { ReportReferenceItem } from "@/components/ReportReferenceItem";
import { resolveTemplateItemContent } from "@/lib/i18n/content";
import { useTranslation } from "@/lib/i18n/provider";
import type { Language } from "@/lib/i18n/types";
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
  // NOTE: actorName / actorEmail / actorLanguage no longer carried here —
  // UserMenu mounts at the (authed) route group layout (per
  // SPEC_AMENDMENTS.md C.39); TranslationProvider is layout-owned and
  // reads users.language directly. This component just consumes via
  // useTranslation().
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const STATION_FALLBACK = "General";

// The "I'm the last out" station. When all 5 of its items have live (non-
// superseded) completions, the finalize affordance unlocks for KH+ actors.
// String must match the seed-script ITEMS exactly — see
// scripts/seed-closing-template.ts.
//
// SYSTEM-KEY DISCIPLINE (per SPEC_AMENDMENTS.md C.38): all station-based
// matching/grouping uses the original (English) it.station value as the
// system key. Translation happens at DISPLAY ONLY via
// resolveTemplateItemContent — never on a key path. Translating the
// matching key would break the Walk-Out gate for Spanish-language users
// (Spanish "Verificación de Salida" wouldn't equal English
// "Walk-Out Verification" and the finalize affordance would never appear).
const WALK_OUT_VERIFICATION_STATION = "Walk-Out Verification";

function groupByStation(items: ChecklistTemplateItem[]): Map<string, ChecklistTemplateItem[]> {
  const out = new Map<string, ChecklistTemplateItem[]>();
  for (const it of items) {
    // System-key match against original (English) it.station per
    // SPEC_AMENDMENTS.md C.38 — translation is render-only.
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

/**
 * Language-aware time formatter (per AGENTS.md "Language-aware time/date
 * formatting" canonical pattern). Uses es-US when language === "es",
 * en-US otherwise.
 *
 * Lifted to language-aware in Build #2 PR 1's closing-client report-
 * reference rendering commit — closing-client was the outlier flagged
 * in the AGENTS.md durable lesson; previously hardcoded "en-US"
 * regardless of language (real Spanish-UX bug — Spanish users always
 * saw English-format times in the post-confirm banner). Now matches
 * dashboard's formatDateLabel + AmPrepForm's formatTime convention.
 */
function formatTime(iso: string, language: Language): string {
  try {
    return new Date(iso).toLocaleTimeString(
      language === "es" ? "es-US" : "en-US",
      { hour: "numeric", minute: "2-digit" },
    );
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export function ClosingClient({ initialState }: { initialState: ClosingInitialState }) {
  // TranslationProvider mounts at the (authed) route group layout level
  // (per SPEC_AMENDMENTS.md C.39). This component just consumes via
  // useTranslation(); UserMenu is also layout-owned and floats in the
  // top-right corner across all authenticated pages.
  //
  // `language` is destructured for resolveTemplateItemContent calls (per
  // SPEC_AMENDMENTS.md C.38) — the resolver runs at consistent locations:
  // station-display computation in the stations.map below, and inside
  // ChecklistItem for label/description display. NEVER on a key path.
  const { t, language } = useTranslation();
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

  // Walk-Out Verification is the "I'm the last out" signal. All 5 items
  // (lights off, devices charging, oven off, front doors locked, back door
  // locked) must have live (non-superseded) completions for the closing to
  // be finalize-eligible. If any item is undone or superseded by another
  // user, this flips back to false and the finalize UI disappears
  // reactively.
  //
  // SYSTEM-KEY MATCH (per SPEC_AMENDMENTS.md C.38): match against original
  // (English) it.station — never against a translated value. A Spanish-
  // language user's resolved station string "Verificación de Salida" would
  // NOT equal WALK_OUT_VERIFICATION_STATION ("Walk-Out Verification") if
  // we translated here, and the finalize gate would never unlock for them.
  // Translation happens at display only via resolveTemplateItemContent.
  const walkOutVerificationComplete = useMemo(() => {
    const walkOutItems = templateItems.filter(
      (it) => it.station === WALK_OUT_VERIFICATION_STATION,
    );
    if (walkOutItems.length === 0) return false;
    return walkOutItems.every((it) => completions.has(it.id));
  }, [templateItems, completions]);

  // Finalize gate: KH+ (security gate for lock-up) AND Walk-Out Verification
  // complete (the "I'm the last out" signal). Both must hold. See
  // SPEC_AMENDMENTS.md C.26 for the operational rationale.
  //
  // KH+ in current implementation = level >= 3 (key_holder is level 3 per
  // lib/roles.ts). The earlier `actor.level >= 4` value contradicted C.26
  // by excluding KHs (level 3); reconciled in Build #2 PR 1 per the C.41
  // sub-finding. The broader level-number restructure (renumbering KH=4,
  // SL=5 per spec C.33 intent) remains deferred to Module #2 user
  // lifecycle work.
  const canFinalize = !readOnly && actor.level >= 3 && walkOutVerificationComplete;

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

  // ─── Revoke / tag callbacks (Build #1.5 PR 2 per SPEC_AMENDMENTS.md C.28) ─

  /**
   * Silent within-60s self-revoke. Optimistic on the component side; on
   * server success we remove the completion from the parent map so the row
   * goes back to not-yet-completed (matches design lock #5: full revert,
   * forensic record lives in DB+audit).
   */
  const handleItemRevoke = useCallback(
    async (completionId: string): Promise<ChecklistRevokeResult> => {
      try {
        const res = await fetch(`/api/checklist/completions/${completionId}/revoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          redirect: "manual",
        });
        if (res.ok) {
          const data = (await res.json()) as { revoked: true; completion: ChecklistCompletion };
          // Drop the completion from the live map so the row visually reverts.
          setCompletions((prev) => {
            const next = new Map(prev);
            next.delete(data.completion.templateItemId);
            return next;
          });
          return { revoked: true, completion: data.completion };
        }
        let body: ChecklistApiError;
        try {
          body = (await res.json()) as ChecklistApiError;
        } catch {
          body = { code: "unknown", message: "Undo failed." };
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
    [],
  );

  /**
   * Post-60s structured self-revoke with reason (+ optional note). Pessimistic
   * — UI commits on server confirmation, then we remove from parent map.
   */
  const handleItemRevokeWithReason = useCallback(
    async (
      completionId: string,
      payload: { reason: "not_actually_done" | "other"; note?: string | null },
    ): Promise<ChecklistRevokeResult> => {
      try {
        const res = await fetch(
          `/api/checklist/completions/${completionId}/revoke-with-reason`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: payload.reason, note: payload.note ?? null }),
            redirect: "manual",
          },
        );
        if (res.ok) {
          const data = (await res.json()) as { revoked: true; completion: ChecklistCompletion };
          setCompletions((prev) => {
            const next = new Map(prev);
            next.delete(data.completion.templateItemId);
            return next;
          });
          return { revoked: true, completion: data.completion };
        }
        let body: ChecklistApiError;
        try {
          body = (await res.json()) as ChecklistApiError;
        } catch {
          body = { code: "unknown", message: "Undo failed." };
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
    [],
  );

  /**
   * Tag actual completer (KH+ peer correction or self wrong_user_credited).
   * Pessimistic — UI commits on server confirmation. The completion stays in
   * the live map (revoke-only removes); we replace it with the updated row
   * so the actual_completer_id annotation surfaces. Author name for the new
   * actualCompleterId is fetched from the picker candidates locally; if the
   * map doesn't have it (rare race), the page-level author resolution will
   * supply it on next render.
   */
  const handleItemTagActualCompleter = useCallback(
    async (completionId: string, actualCompleterId: string): Promise<ChecklistTagResult> => {
      try {
        const res = await fetch(
          `/api/checklist/completions/${completionId}/tag-actual-completer`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actualCompleterId }),
            redirect: "manual",
          },
        );
        if (res.ok) {
          const data = (await res.json()) as {
            tagged: true;
            completion: ChecklistCompletion;
            replacedPriorTag: boolean;
          };
          setCompletions((prev) => {
            const next = new Map(prev);
            next.set(data.completion.templateItemId, data.completion);
            return next;
          });
          return {
            tagged: true,
            completion: data.completion,
            replacedPriorTag: data.replacedPriorTag,
          };
        }
        let body: ChecklistApiError;
        try {
          body = (await res.json()) as ChecklistApiError;
        } catch {
          body = { code: "unknown", message: "Tag failed." };
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
    [],
  );

  /**
   * Loads picker candidates for a specific completion. Component caches the
   * result for the duration of the expand session; we re-fetch each time
   * the picker opens (no parent-side cache).
   *
   * Side-effect: when candidates load successfully, we merge their names
   * into the parent's authorMap so the eventual tagged annotation has the
   * actual_completer_id name available without a second fetch.
   */
  const handleLoadPickerCandidates = useCallback(
    async (completionId: string): Promise<ChecklistPickerResult> => {
      try {
        const res = await fetch(
          `/api/checklist/completions/${completionId}/picker-candidates`,
          {
            method: "GET",
            redirect: "manual",
          },
        );
        if (res.ok) {
          const data = (await res.json()) as {
            candidates: Array<{ id: string; name: string; role: RoleCode; level: number }>;
          };
          // Merge candidate names into authorMap for downstream tag annotation.
          setAuthorMap((prev) => {
            const next = new Map(prev);
            for (const c of data.candidates) {
              if (!next.has(c.id)) next.set(c.id, c.name);
            }
            return next;
          });
          return { candidates: data.candidates };
        }
        let body: ChecklistApiError;
        try {
          body = (await res.json()) as ChecklistApiError;
        } catch {
          body = { code: "unknown", message: "Picker load failed." };
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
    [],
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
        ? formatTime(confirmedInstance.confirmedAt, language)
        : "";
      const who = t("common.you");
      const timePrefix = time ? t("closing.banner.time_prefix", { time }) : "";
      if (confirmedInstance.status === "confirmed") {
        setBanner({
          tone: "confirmed",
          message: t("closing.banner.confirmed", { time: timePrefix, who }),
        });
      } else {
        setBanner({
          tone: "incomplete_confirmed",
          message: t("closing.banner.incomplete_confirmed", { time: timePrefix, who }),
        });
      }
    },
    [t],
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
        message: t("closing.error.concurrent_modification"),
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
      {/* Persistent back-to-dashboard CTA. UserMenu floats in the
          top-right corner from the (authed) layout (per
          SPEC_AMENDMENTS.md C.39); reserved zone has min-h sized so this
          back-link doesn't collide. */}
      <div className="mb-3">
        <a
          href="/dashboard"
          aria-label={t("closing.page.dashboard_back_aria")}
          className="
            inline-flex min-h-[44px] items-center gap-1.5 -ml-2 px-2 py-2
            text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted
            transition hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
            rounded-md
          "
        >
          <ChevronLeftIcon />
          <span>{t("closing.page.dashboard_back")}</span>
        </a>
      </div>

      {/* Header */}
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
          {t("closing.page.title")}
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
            {t("closing.page.progress_label")}
          </span>
          <span
            className="text-xs font-semibold tabular-nums text-co-text"
            aria-label={t("closing.page.progress_aria", { completed: totalCount.completed, total: totalCount.required })}
          >
            {t("closing.page.progress_count", { completed: totalCount.completed, total: totalCount.required })}
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

      {/* Stations.
          `station` value is the SYSTEM KEY (original English; used for
          React keys, refs, data-attrs, IntersectionObserver scroll
          detection, and the Walk-Out gate). `stationDisplay` is the
          render-only translation derived from the first item's
          translations via resolveTemplateItemContent. Per
          SPEC_AMENDMENTS.md C.38 system-key vs display-string discipline. */}
      <div className="mt-4 flex flex-col gap-4">
        {stationKeys.map((station) => {
          const items = stationGroups.get(station) ?? [];
          const firstItem = items[0];
          const stationDisplay =
            firstItem
              ? resolveTemplateItemContent(firstItem, language).station ?? station
              : station;
          return (
            <StationGroup
              key={station}
              station={station}
              stationDisplay={stationDisplay}
              items={items}
              completions={completions}
              authorMap={authorMap}
              actor={actor}
              instanceStatus={instance.status}
              readOnly={readOnly}
              expanded={stationExpanded.get(station) ?? true}
              locationId={location.id}
              onToggle={() => toggleStation(station)}
              onComplete={handleItemComplete}
              onRevoke={handleItemRevoke}
              onRevokeWithReason={handleItemRevokeWithReason}
              onTagActualCompleter={handleItemTagActualCompleter}
              onLoadPickerCandidates={handleLoadPickerCandidates}
              setRef={setStationRef(station)}
            />
          );
        })}
      </div>

      {/*
       * Finalization UI gated by TWO conditions (SPEC_AMENDMENTS.md C.26):
       *
       *   1. actor.level >= 3 (KH+, per C.41 reconciliation) — security
       *      gate; only KH+ can lock up
       *   2. walkOutVerificationComplete — operational gate; the "I'm the
       *      last out" signal. All 5 Walk-Out Verification items must have
       *      live completions. The person who tapped the last of them is
       *      the finalizer.
       *
       * Per CO's Model A: closing is multi-author over hours. Items A, B,
       * and C tick items throughout shift (Crunchy Boi at 2pm, 3rd Party
       * at 4pm, etc.). Whoever's actually last-out does Walk-Out Verification
       * (lights / devices / oven / doors). THAT action signals "I'm
       * finalizing this closing" and unlocks Review & submit for that person.
       *
       * Reactive: if a Walk-Out Verification item gets superseded or undone
       * by another user, walkOutVerificationComplete flips back to false
       * and the finalize UI disappears. Re-completing brings it back.
       *
       * Item completion stays open to anyone whose level >= each item's
       * min_role_level (gated inside ChecklistItem + RLS in
       * lib/checklists.ts) — this gate only governs the finalize path.
       *
       * The PinConfirmModal mount below is gated alongside — defense-in-
       * depth so any future code path that tries to setPinOpen(true) for
       * a non-finalizing actor finds no modal to open.
       */}
      {canFinalize ? (
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
              {reviewOpen
                ? t("closing.review.button_hide")
                : allRequiredDone
                ? t("closing.review.button_complete")
                : t("closing.review.button_incomplete")}
            </button>
            <p className="text-center text-[11px] text-co-text-muted">
              {t("closing.station.progress_required", {
                completed: totalCount.completed,
                total: totalCount.required,
              })}
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

      {/* Note: the read-only-mode "Back to dashboard" CTA was previously
       * here. It was lifted to the persistent top-of-page affordance so
       * the closer can navigate away across any state, not just after
       * finalization. */}

      {/* PinConfirmModal — mounted only when finalization is gate-allowed
       * (matches the canFinalize gate above per SPEC_AMENDMENTS.md C.26:
       * KH+ AND Walk-Out Verification complete). Defense-in-depth: any
       * future code path that tries to setPinOpen(true) outside the gate
       * finds no modal mounted. */}
      {canFinalize ? (
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
  stationDisplay,
  items,
  completions,
  authorMap,
  actor,
  instanceStatus,
  readOnly,
  expanded,
  locationId,
  onToggle,
  onComplete,
  onRevoke,
  onRevokeWithReason,
  onTagActualCompleter,
  onLoadPickerCandidates,
  setRef,
}: {
  /** SYSTEM KEY (original English) — used for data-station, refs, IntersectionObserver. */
  station: string;
  /** DISPLAY STRING (translated per current language) — used for the visible header text. */
  stationDisplay: string;
  items: ChecklistTemplateItem[];
  completions: Map<string, ChecklistCompletion>;
  authorMap: Map<string, string>;
  actor: { userId: string; role: RoleCode; level: number };
  instanceStatus: ChecklistStatus;
  readOnly: boolean;
  expanded: boolean;
  /**
   * Location id — threaded through to ReportReferenceItem for the
   * empty-state tap-to-navigate href (/operations/am-prep?location=<id>).
   * Cleaning rows ignore this prop.
   */
  locationId: string;
  onToggle: () => void;
  onComplete: (payload: ChecklistCompletePayload) => Promise<ChecklistCompleteResult>;
  onRevoke: (completionId: string) => Promise<ChecklistRevokeResult>;
  onRevokeWithReason: (
    completionId: string,
    payload: { reason: "not_actually_done" | "other"; note?: string | null },
  ) => Promise<ChecklistRevokeResult>;
  onTagActualCompleter: (
    completionId: string,
    actualCompleterId: string,
  ) => Promise<ChecklistTagResult>;
  onLoadPickerCandidates: (completionId: string) => Promise<ChecklistPickerResult>;
  setRef: (el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
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
      // System-key on data-station for IntersectionObserver auto-collapse
      // detection (per SPEC_AMENDMENTS.md C.38 — never translate keys).
      data-station={station}
      ref={setRef}
      // Display string in the user-facing aria-label.
      aria-label={t("closing.station.toggle_aria", { station: stationDisplay })}
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
            {/* Station header prominence per SPEC_AMENDMENTS.md C.30. text-lg
                bump + Mustard-deep accent line; font-bold preserved (existing
                baseline already at upper bound; spec's font-semibold would
                regress weight). border-b-2 over spec's ~1px guideline because
                text-lg at operational arm's length needs the confident anchor. */}
            <span className="text-lg font-bold uppercase tracking-[0.14em] text-co-text border-b-2 border-co-gold-deep pb-0.5">
              {stationDisplay}
            </span>
          </span>
          <span className="text-[11px] text-co-text-muted">
            {t("closing.station.progress_required", { completed: completedRequired, total: totalRequired })}
            {aboveRoleCount > 0 ? t("closing.station.awaiting_higher_role", { count: aboveRoleCount }) : ""}
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

            // Per SPEC_AMENDMENTS.md C.42: items with non-null
            // reportReferenceType are auto-completed by their source
            // report's submission RPC, NOT by user tap. They render a
            // distinct visual (Brand Green check + inline attribution
            // when complete; tap-to-navigate empty state when not yet
            // submitted). Walk-Out Verification gate is unaffected —
            // those items live in the "Walk-Out Verification" station,
            // never in stations that carry report-reference items.
            if (it.reportReferenceType !== null) {
              return (
                <ReportReferenceItem
                  key={it.id}
                  templateItem={it}
                  completion={c}
                  completionAuthor={author}
                  locationId={locationId}
                  readOnly={readOnly}
                />
              );
            }

            const actualCompleterAuthor =
              c && c.actualCompleterId
                ? {
                    name: authorMap.get(c.actualCompleterId) ?? "—",
                    isSelf: c.actualCompleterId === actor.userId,
                  }
                : null;
            return (
              <ChecklistItem
                key={it.id}
                templateItem={it}
                completion={c}
                completionAuthor={author}
                actualCompleterAuthor={actualCompleterAuthor}
                actorLevel={actor.level}
                actorUserId={actor.userId}
                instanceStatus={instanceStatus}
                readOnly={readOnly}
                onComplete={onComplete}
                onRevoke={onRevoke}
                onRevokeWithReason={onRevokeWithReason}
                onTagActualCompleter={onTagActualCompleter}
                onLoadPickerCandidates={onLoadPickerCandidates}
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
  const { t, language } = useTranslation();
  const itemsById = useMemo(() => {
    const m = new Map<string, ChecklistTemplateItem>();
    for (const it of templateItems) m.set(it.id, it);
    return m;
  }, [templateItems]);

  const requiredTotal = templateItems.filter((it) => it.required).length;
  const incompleteTotal = incompleteRequiredIds.length;
  const allDone = incompleteTotal === 0;

  return (
    <section
      id="closing-review"
      aria-label={t("closing.review.button_complete")}
      className="mt-6 rounded-2xl border-2 border-co-text bg-co-surface p-5 sm:p-6"
    >
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {t("closing.review.button_complete")}
      </p>
      <h2 className="mt-1 text-lg font-extrabold text-co-text">
        {allDone ? t("closing.review.heading_complete") : t("closing.review.heading_incomplete")}
      </h2>
      <p className="mt-1 text-sm text-co-text-muted">
        {t("closing.station.progress_required", {
          completed: requiredTotal - incompleteTotal,
          total: requiredTotal,
        })}
      </p>

      {/* Incomplete-required reason inputs */}
      {incompleteRequiredIds.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          {incompleteRequiredIds.map((id) => {
            const it = itemsById.get(id);
            if (!it) return null;
            const draft = reasonDrafts.get(id) ?? "";
            // Resolver call once per row — display only (per
            // SPEC_AMENDMENTS.md C.38). The reason-keying is by `id`
            // (line 1146 key), not by label/station, so no system-key
            // concern here.
            const resolved = resolveTemplateItemContent(it, language);
            return (
              <label key={id} className="block">
                <span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-co-text-dim">
                  {resolved.station ?? STATION_FALLBACK}
                  {t("closing.review.station_label_separator")}
                  {resolved.label}
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
                  placeholder={t("closing.review.reason_placeholder")}
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
        {t("closing.review.continue")}
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
  const { t } = useTranslation();
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
        {t("closing.review.button_complete")} ·{" "}
        {t("closing.page.progress_count", { completed, total: required })}
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

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
