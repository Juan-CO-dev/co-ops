"use client";

/**
 * PinConfirmModal — Phase 2 Session 4 scaffold; wired in Phase 4 checklist
 * confirmation flows.
 *
 * PIN re-entry attestation for checklist confirmations (all levels). NOT a
 * destructive-action gate — it's an attestation that "I, the signed-in user,
 * confirm this checklist submission." Used at the end of opening / closing
 * checklist flows.
 *
 * Props:
 *   open      — whether the modal is rendered
 *   onConfirm — called with the entered PIN after a successful pin-confirm.
 *   onCancel  — user backed out without confirming.
 *
 * Network: POST /api/auth/pin-confirm with { pin }. **NOT YET IMPLEMENTED** —
 * the route gets built when Phase 4 actually wires this. For now the network
 * call is stubbed: on 4-digit entry, the modal surfaces an inline error
 * "PIN confirmation not yet wired (Phase 4)." so the scaffold doesn't pretend
 * to work. Once the route lands, swap the stub for a real fetch with the same
 * response-handling pattern as PasswordModal:
 *
 *   200                     → onConfirm(pin)
 *   401 invalid_credentials → inline error "Wrong PIN." with shake + 200ms haptic
 *   401 unauthorized        → onCancel (parent's enforcement handles re-auth)
 *   network/server          → inline error
 *
 * Like the PIN keypad on the login surface, accepts haptic feedback (10ms
 * digit press, 200ms error buzz) and supports the "Use system keyboard"
 * toggle for users who prefer their phone's native keyboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const PIN_LENGTH = 4;

export interface PinConfirmModalProps {
  open: boolean;
  onConfirm: (pin: string) => Promise<void> | void;
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

export function PinConfirmModal({ open, onConfirm, onCancel }: PinConfirmModalProps) {
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
        // TODO(phase-4): implement /api/auth/pin-confirm and replace this stub.
        //   const res = await fetch("/api/auth/pin-confirm", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify({ pin: full }),
        //     redirect: "manual",
        //   });
        //   if (res.ok) { await onConfirm(full); return; }
        //   if (res.status === 401) { triggerError("Wrong PIN."); return; }
        //   triggerError("Try again.");
        triggerError("PIN confirmation not yet wired (Phase 4).");
      } catch {
        triggerError("Network error. Try again.");
      } finally {
        setSubmitting(false);
      }
      // Reference onConfirm so TS doesn't flag it unused while the network
      // call is stubbed; harmless no-op when triggerError fired.
      void onConfirm;
    },
    [onConfirm, triggerError],
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
