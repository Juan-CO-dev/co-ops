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
import type { ChecklistInstance } from "@/lib/types";

const PIN_LENGTH = 4;

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
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [useSystemKeyboard, setUseSystemKeyboard] = useState(false);
  const systemInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state on open.
  useEffect(() => {
    if (open) {
      setPin("");
      setError(null);
      setSubmitting(false);
      setShake(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && useSystemKeyboard) systemInputRef.current?.focus();
  }, [open, useSystemKeyboard]);

  const triggerError = useCallback((message: string) => {
    setError(message);
    vibrateIfAvailable(200);
    setShake(true);
    window.setTimeout(() => setShake(false), 400);
    setPin("");
  }, []);

  const submit = useCallback(
    async (full: string) => {
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
          setPin("");
          onConfirmed(data.instance);
          return;
        }

        // Non-ok: parse as ChecklistApiError. Switch on err.code (the stable
        // discriminator); HTTP status is informational at most.
        let body: ChecklistApiError;
        try {
          body = (await res.json()) as ChecklistApiError;
        } catch {
          triggerError("Unable to confirm. Please try again.");
          return;
        }

        switch (body.code) {
          case "pin_mismatch":
            // Recoverable: clear input, allow retry. No onError — modal
            // owns this case end-to-end.
            triggerError("Incorrect PIN.");
            return;

          case "missing_pin_hash":
            // Defensive: current schema (users.pin_hash NOT NULL) makes
            // this unreachable. Surfacing meaningfully if it ever fires.
            triggerError(
              "Account not configured for PIN confirmation. Contact your administrator.",
            );
            return;

          case "instance_closed":
            triggerError("This closing was already submitted.");
            onError(body);
            return;

          case "single_submission_locked":
            triggerError("This checklist is locked.");
            onError(body);
            return;

          case "role_level_insufficient":
            triggerError("Your role doesn't have permission to confirm this closing.");
            onError(body);
            return;

          case "missing_reasons":
          case "extra_reasons":
            // Caller bug — parent computed reasons wrong before opening.
            // Generic message so the user has a path forward; onError
            // lets the parent recover (close + recompute + reopen).
            triggerError("Unable to confirm. Please reload and try again.");
            onError(body);
            return;

          case "missing_count":
          case "missing_photo":
            // Parent bug — an item was marked complete without its required
            // count or photo. User can't fix by completing more items;
            // items they completed are already complete. Same recovery
            // path as missing/extra reasons: parent recomputes state.
            triggerError("Unable to confirm. Please reload and try again.");
            onError(body);
            return;

          case "supersede_failed":
            // Forensic case — both completion ids are in body. Don't
            // retry blindly; let parent decide.
            triggerError("Save partially failed. Please reload and try again.");
            onError(body);
            return;

          default:
            triggerError("Unable to confirm. Please try again.");
            return;
        }
      } catch {
        triggerError("Network error. Try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [instanceId, incompleteReasons, onConfirmed, onError, triggerError],
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (submitting) return;
      vibrateIfAvailable(10);
      setError(null);
      setPin((prev) => {
        const next = (prev + d).slice(0, PIN_LENGTH);
        if (next.length === PIN_LENGTH) {
          window.setTimeout(() => void submit(next), 60);
        }
        return next;
      });
    },
    [submitting, submit],
  );

  const handleClear = useCallback(() => {
    if (submitting) return;
    vibrateIfAvailable(10);
    setPin("");
    setError(null);
  }, [submitting]);

  const handleSystemInput = useCallback(
    (value: string) => {
      if (submitting) return;
      const cleaned = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
      setError(null);
      setPin(cleaned);
      if (cleaned.length === PIN_LENGTH) {
        window.setTimeout(() => void submit(cleaned), 60);
      }
    },
    [submitting, submit],
  );

  // Physical keyboard handling when modal is open and using on-screen keypad.
  useEffect(() => {
    if (!open || useSystemKeyboard) return;
    function onKey(e: KeyboardEvent) {
      if (submitting) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (!submitting) onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, useSystemKeyboard, submitting, handleDigit, onCancel]);

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
          Confirm with your PIN
        </h2>
        <p className="mt-2 text-sm text-co-text-muted">
          Enter your 4-digit PIN to confirm this action.
        </p>

        <div
          aria-label={`PIN entry: ${pin.length} of ${PIN_LENGTH} digits entered`}
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
          <p className="mt-3 text-center text-sm font-semibold text-co-cta" role="alert">
            {error}
          </p>
        )}

        {!useSystemKeyboard ? (
          <div className="mt-5 grid grid-cols-3 gap-2" aria-label="PIN keypad">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <KeypadButton key={d} onClick={() => handleDigit(d)} disabled={submitting}>
                {d}
              </KeypadButton>
            ))}
            <KeypadButton variant="ghost" onClick={handleClear} disabled={submitting}>
              Clear
            </KeypadButton>
            <KeypadButton onClick={() => handleDigit("0")} disabled={submitting}>
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
              disabled={submitting}
              onChange={(e) => handleSystemInput(e.target.value)}
              aria-label="PIN"
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
            onClick={onCancel}
            disabled={submitting}
            className="
              inline-flex min-h-[52px] items-center justify-center rounded-xl
              border-2 border-co-border-2 bg-co-surface px-4 py-3 text-sm
              font-semibold text-co-text-muted transition
              hover:border-co-text hover:text-co-text
              focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
              disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => setUseSystemKeyboard((v) => !v)}
            disabled={submitting}
            className="
              self-center px-2 py-2 text-sm text-co-text-dim underline-offset-2
              hover:text-co-text hover:underline
              focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold
              disabled:opacity-50
            "
          >
            {useSystemKeyboard ? "Use on-screen keypad" : "Use system keyboard"}
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
  return (
    <span
      aria-label="Loading"
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-co-text/30 border-t-co-text"
    />
  );
}
