"use client";

/**
 * PinConfirmModal — Module #1 Build #1 step 7.
 *
 * PIN re-entry attestation for checklist instance confirmation (all levels).
 * NOT a destructive-action gate — it's an attestation that "I, the signed-in
 * user, confirm this checklist submission." Used at the end of opening,
 * prep, and closing checklist flows.
 *
 * Props:
 *   open               — whether the modal is rendered
 *   instanceId         — the checklist instance being confirmed
 *   incompleteReasons  — empty when all required items completed; populated
 *                        per template_item_id when the soft-block triggers
 *   onConfirmed        — fired with the confirmed instance on 200 OK; parent
 *                        uses this to refresh state and close the modal
 *   onError            — fired with the parsed ChecklistApiError for non-
 *                        recoverable cases (instance_closed, role_level_
 *                        insufficient, missing/extra reasons, supersede_
 *                        failed). Modal still surfaces an inline message so
 *                        the user sees feedback before parent reacts.
 *   onCancel           — user backed out without confirming
 *
 * Network: POST /api/checklist/confirm with body
 *   { instanceId, pin, incompleteReasons }
 * Per spec §6.1, PIN validation lives inside the confirm route — there is
 * no separate /api/auth/pin-confirm. Single PIN attestation covers the
 * entire close-of-shift workflow. PIN failure does NOT lock the account or
 * increment failed_login_count (Phase 2 Session 4 step-up precedent — the
 * actor is already authenticated; locking step-up doesn't raise the bar).
 * PIN failure DOES audit (lib/checklists.ts confirmInstance writes
 * `checklist.confirm` with `metadata.outcome: "pin_mismatch"`).
 *
 * Response handling (switches on err.code, not HTTP status — code is the
 * stable discriminator):
 *
 *   200                              → onConfirmed(instance), modal closes
 *   pin_mismatch                     → inline "Incorrect PIN.", clear, retry
 *   missing_pin_hash                 → inline "Account not configured…",
 *                                       defensive; unreachable per current
 *                                       schema (users.pin_hash NOT NULL)
 *   instance_closed                  → "Already submitted.", onError
 *   single_submission_locked         → "Locked.", onError
 *   role_level_insufficient          → "Your role can't confirm.", onError
 *   missing_reasons / extra_reasons  → "Reload and try again.", onError
 *                                       (parent computed reasons wrong)
 *   supersede_failed                 → "Save partially failed.", onError
 *   missing_count / missing_photo    → "Items still need data.", onError
 *                                       (parent didn't gate; defensive)
 *   (other / network)                → "Try again.", retry
 *
 * PIN handling: state-only during submission; cleared on every error path
 * via triggerError; cleared on success before onConfirmed; never logged,
 * never persisted, never sent anywhere except the API request body.
 *
 * UI: existing keypad / focus trap / shake-on-error / system-keyboard
 * toggle preserved verbatim from the Phase 2 Session 4 scaffold. Haptic
 * feedback (10ms digit press, 200ms error buzz) preserved. No lockout
 * banner (intentional — see Phase 2 Session 4 lesson).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChecklistApiError } from "@/components/ChecklistItem";
import { useTranslation } from "@/lib/i18n/provider";
import { createPinEntry } from "@/lib/pin-entry";
import type { ChecklistInstance } from "@/lib/types";

const PIN_LENGTH = 4;
/** Let the 4th dot paint before the POST goes out. */
const SUBMIT_DELAY_MS = 60;

export interface PinConfirmModalProps {
  open: boolean;
  instanceId: string;
  incompleteReasons: Array<{ templateItemId: string; reason: string }>;
  onConfirmed: (instance: ChecklistInstance) => void;
  onError: (error: ChecklistApiError) => void;
  onCancel: () => void;
}

function vibrateIfAvailable(durationMs: number) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(durationMs);
  } catch {
    // Some browsers throw on disallowed vibration contexts; ignore.
  }
}

export function PinConfirmModal({
  open,
  instanceId,
  incompleteReasons,
  onConfirmed,
  onError,
  onCancel,
}: PinConfirmModalProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  // Synchronous source of truth for the buffer AND the freeze (state is for rendering only):
  // two events before a re-render both read the same stale `pin` (a lost digit; an edit
  // after the 4th digit already queued the submit). Once the 4th digit lands the entry is
  // frozen until a failure/close path resets it - see lib/pin-entry.ts.
  const [entry] = useState(createPinEntry);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [useSystemKeyboard, setUseSystemKeyboard] = useState(false);
  const systemInputRef = useRef<HTMLInputElement | null>(null);
  // Synchronous one-shot latch: `submitting` only flips after a 60 ms timer + a
  // render, so a second timer/tap in that window could POST twice. A ref closes it.
  const inFlight = useRef(false);
  // The 4th digit schedules the POST SUBMIT_DELAY_MS out. In that window nothing
  // has flipped `submitting` yet, so Cancel/Escape/Clear/Backspace stayed live:
  // a Cancel closed the modal and the timer still confirmed the closing (#57).
  // `queued` (state, for rendering) is set the moment the timer is scheduled;
  // `queuedTimer` (ref, for synchronous checks) holds the timer id.
  const [queued, setQueued] = useState(false);
  const queuedTimer = useRef<number | null>(null);

  const clearQueued = useCallback(() => {
    if (queuedTimer.current !== null) {
      window.clearTimeout(queuedTimer.current);
      queuedTimer.current = null;
    }
  }, []);

  // Reset state on open via render-phase compare — a synchronous reset inside an
  // effect would trip react-hooks/set-state-in-effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPin("");
      setError(null);
      setSubmitting(false);
      setQueued(false);
      setShake(false);
    }
  }

  // A ref can't be reset in the render-phase block above, so release the latch here
  // when the modal (re)opens; error exits release it in submit's `finally`.
  useEffect(() => {
    if (open) inFlight.current = false;
  }, [open]);

  // The render-phase block above resets the PIN state; the entry half resets here.
  useEffect(() => {
    if (open) entry.reset();
  }, [open, entry]);

  // A scheduled confirm must never outlive the modal: closing (for any reason)
  // or unmounting cancels the timer.
  useEffect(() => {
    if (!open) clearQueued();
    return clearQueued;
  }, [open, clearQueued]);

  useEffect(() => {
    if (open && useSystemKeyboard) systemInputRef.current?.focus();
  }, [open, useSystemKeyboard]);

  const triggerError = useCallback((message: string) => {
    setError(message);
    vibrateIfAvailable(200);
    setShake(true);
    window.setTimeout(() => setShake(false), 400);
    entry.reset();
    setPin("");
  }, [entry]);

  const submit = useCallback(
    async (full: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      let confirmed = false;
      setQueued(false);
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/checklist/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instanceId,
            pin: full,
            incompleteReasons,
          }),
          // Per Phase 2 Session 3 lesson: NextResponse.redirect returns 307
          // and fetch follows by default, masking auth-gate denials. Manual
          // lets us see and surface the redirect as a recoverable error.
          redirect: "manual",
        });

        if (res.ok) {
          const data = (await res.json()) as { instance: ChecklistInstance };
          // Best-effort scrub of in-memory PIN before yielding control.
          entry.wipe(); // stays frozen: the dialog is finishing
          setPin("");
          confirmed = true; // success: leave the latch set, the modal is done
          onConfirmed(data.instance);
          return;
        }

        // Non-ok: parse as ChecklistApiError. Switch on err.code (the stable
        // discriminator); HTTP status is informational at most.
        let body: ChecklistApiError;
        try {
          body = (await res.json()) as ChecklistApiError;
        } catch {
          triggerError(t("auth.pin_modal.error_unknown"));
          return;
        }

        switch (body.code) {
          case "pin_mismatch":
            triggerError(t("auth.pin_modal.error_pin_mismatch"));
            return;

          case "missing_pin_hash":
            triggerError(t("auth.pin_modal.error_missing_pin_hash"));
            return;

          case "instance_closed":
            triggerError(t("auth.pin_modal.error_already_submitted"));
            onError(body);
            return;

          case "single_submission_locked":
            triggerError(t("auth.pin_modal.error_locked"));
            onError(body);
            return;

          case "role_level_insufficient":
            triggerError(t("auth.pin_modal.error_role"));
            onError(body);
            return;

          case "completion_set_changed":
            triggerError(t("closing.error.completion_set_changed"));
            onError(body);
            return;

          case "missing_reasons":
          case "extra_reasons":
            triggerError(t("auth.pin_modal.error_reload"));
            onError(body);
            return;

          case "blank_reason":
            // B11a: the server refused an empty "why" — close and let the closer write one.
            triggerError(t("auth.pin_modal.error_blank_reason"));
            onError(body);
            return;

          case "missing_count":
          case "missing_photo":
            triggerError(t("auth.pin_modal.error_reload"));
            onError(body);
            return;

          case "supersede_failed":
            triggerError(t("auth.pin_modal.error_partial_save"));
            onError(body);
            return;

          case "cash_deposit_required":
            triggerError(t("auth.pin_modal.error_cash_required"));
            onError(body);
            return;

          case "hard_gate_incomplete":
            // PR-4 (spec §3): the owner-ruled hard gate — one or more items must be
            // done before this checklist can be submitted (no reason path). The labels
            // are on body.labels; the message names how many are blocking.
            triggerError(t("auth.pin_modal.error_hard_gate"));
            onError(body);
            return;

          default:
            triggerError(t("auth.pin_modal.error_unknown"));
            return;
        }
      } catch {
        triggerError(t("auth.pin_modal.error_network"));
      } finally {
        if (!confirmed) {
          inFlight.current = false;
          entry.unfreeze();
        }
        setSubmitting(false);
      }
    },
    [instanceId, incompleteReasons, onConfirmed, onError, triggerError, entry, t],
  );

  // Schedule the POST and mark the modal busy in the same breath.
  const queueSubmit = useCallback(
    (full: string) => {
      clearQueued();
      setQueued(true);
      queuedTimer.current = window.setTimeout(() => {
        queuedTimer.current = null;
        void submit(full);
      }, SUBMIT_DELAY_MS);
    },
    [clearQueued, submit],
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (submitting || inFlight.current) return;
      if (queued) return;
      // A full PIN is already waiting on its submit timer; extra taps are noise.
      // Advance the entry synchronously (two events before a render must both land); null =
      // frozen/full/non-digit. Schedule from the result. Side effects live OUT here, never
      // inside an updater (Strict Mode double-invokes updaters, which scheduled two submits).
      const step = entry.append(d);
      if (!step) return;
      vibrateIfAvailable(10);
      setError(null);
      setPin(step.pin);
      if (step.completed) queueSubmit(step.pin);
    },
    [submitting, queued, entry, queueSubmit],
  );

  const handleClear = useCallback(() => {
    if (submitting || queued) return;
    if (!entry.clear()) return;
    vibrateIfAvailable(10);
    setPin("");
    setError(null);
  }, [submitting, queued, entry]);

  const handleSystemInput = useCallback(
    (value: string) => {
      if (submitting || inFlight.current) return;
      if (queued) return;
      const step = entry.input(value);
      if (!step) return;
      setError(null);
      setPin(step.pin);
      if (step.completed) queueSubmit(step.pin);
    },
    [submitting, queued, entry, queueSubmit],
  );

  // Cancel closes the dialog: drop any scheduled confirm with it, so a Cancel
  // can never be followed by a confirm POST (#57). The button and Escape are
  // disabled while `queued`; this clear is the belt to those braces.
  const handleCancel = useCallback(() => {
    if (submitting) return;
    clearQueued();
    setQueued(false);
    entry.unfreeze();
    onCancel();
  }, [submitting, clearQueued, entry, onCancel]);

  // Physical keyboard handling when modal is open and using on-screen keypad.
  useEffect(() => {
    if (!open || useSystemKeyboard) return;
    function onKey(e: KeyboardEvent) {
      // Guard with the SYNCHRONOUS latch too: `submitting`/`queued` are render state and lag
      // the 4th digit (Backspace before a render used to edit the display, not the submit).
      if (submitting || queued || inFlight.current || entry.frozen) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        const step = entry.backspace();
        if (step) setPin(step.pin);
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, useSystemKeyboard, submitting, queued, entry, handleDigit, handleCancel]);

  if (!open) return null;

  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => i < pin.length);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-co-text/60 backdrop-blur-sm px-4 py-6"
    >
      <div className="w-full max-w-sm rounded-2xl border-2 border-co-border bg-co-surface p-6 shadow-2xl">
        <h2 id="pin-confirm-title" className="text-xl font-extrabold leading-tight text-co-text">
          {t("auth.pin_modal.title")}
        </h2>
        <p className="mt-2 text-sm text-co-text-muted">
          {t("auth.pin_modal.subtitle")}
        </p>

        <div
          aria-label={t("auth.pin_modal.pin_entry_aria", { entered: pin.length, total: PIN_LENGTH })}
          className={`mt-5 flex items-center justify-center gap-4 ${shake ? "co-shake" : ""}`}
        >
          {dots.map((filled, i) => (
            <span
              key={i}
              aria-hidden
              className={`
                inline-block h-4 w-4 rounded-full border-2 transition-all
                ${filled ? "border-co-text bg-co-text" : "border-co-border-2 bg-transparent"}
              `}
            />
          ))}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm font-semibold text-co-cta-text" role="alert">
            {error}
          </p>
        )}

        {!useSystemKeyboard ? (
          <div className="mt-5 grid grid-cols-3 gap-2" aria-label={t("auth.pin_modal.keypad_aria")}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <KeypadButton key={d} onClick={() => handleDigit(d)} disabled={submitting || queued}>
                {d}
              </KeypadButton>
            ))}
            <KeypadButton variant="ghost" onClick={handleClear} disabled={submitting || queued}>
              {t("auth.pin_modal.clear")}
            </KeypadButton>
            <KeypadButton onClick={() => handleDigit("0")} disabled={submitting || queued}>
              0
            </KeypadButton>
            <KeypadButton variant="ghost" disabled aria-hidden>
              {submitting ? <Spinner /> : ""}
            </KeypadButton>
          </div>
        ) : (
          <div className="mt-5 flex flex-col items-center gap-3">
            <input
              ref={systemInputRef}
              type="tel"
              inputMode="numeric"
              pattern="\d*"
              autoComplete="one-time-code"
              maxLength={PIN_LENGTH}
              value={pin}
              disabled={submitting || queued}
              onChange={(e) => handleSystemInput(e.target.value)}
              aria-label={t("auth.pin_modal.pin_label")}
              className="
                w-full max-w-[240px] rounded-xl border-2 border-co-border-2
                bg-co-surface px-4 py-3 text-center text-2xl font-extrabold
                tracking-[0.4em] tabular-nums text-co-text
                focus:border-co-text focus:outline-none focus:ring-4 focus:ring-co-gold/60
                disabled:opacity-50
              "
            />
            {submitting && <Spinner />}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting || queued}
            className="
              inline-flex min-h-[52px] items-center justify-center rounded-xl
              border-2 border-co-border-2 bg-co-surface px-4 py-3 text-sm
              font-semibold text-co-text-muted transition
              hover:border-co-text hover:text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
              disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            {t("auth.pin_modal.cancel")}
          </button>
          <button
            type="button"
            onClick={() => setUseSystemKeyboard((v) => !v)}
            disabled={submitting || queued}
            className="
              self-center px-2 py-2 text-sm text-co-text-dim underline-offset-2
              hover:text-co-text hover:underline
              focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold
              disabled:opacity-50
            "
          >
            {useSystemKeyboard ? t("auth.pin_modal.use_keypad") : t("auth.pin_modal.use_system_keyboard")}
          </button>
        </div>
      </div>
    </div>
  );
}

function KeypadButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  ...rest
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  "aria-hidden"?: boolean;
}) {
  const base =
    "flex h-14 items-center justify-center rounded-xl text-xl font-bold transition select-none focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-40 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "border-2 border-co-border-2 bg-co-surface text-co-text shadow-sm hover:border-co-text active:bg-co-surface-2"
      : "text-co-text-muted hover:text-co-text hover:bg-co-surface-2/60 active:bg-co-surface-2";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${styles}`} {...rest}>
      {children}
    </button>
  );
}

function Spinner() {
  const { t } = useTranslation();
  return (
    <span
      aria-label={t("auth.pin_modal.loading_aria")}
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-co-text/30 border-t-co-text"
    />
  );
}
