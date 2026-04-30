"use client";

/**
 * PinKeypad — Phase 2 Session 4.
 *
 * Layout (mobile portrait):
 *   Top ~40%: user identity (name + role) + PIN dot indicator.
 *   Bottom ~60%: 3×4 keypad with Clear / 0 / Submit on the bottom row.
 *
 * Tablet/desktop: same column layout, max-width capped at 480px (max-w-md),
 * centered horizontally — Mayo whitespace fills the rest of the viewport.
 *
 * Haptic feedback (feature-detected):
 *   - 10ms tap on each digit press
 *   - 200ms single buzz on error
 *   - NO vibrate on submit (success is its own feedback — page navigates)
 *
 * Errors:
 *   - Wrong credentials: subtle horizontal shake + inline error text
 *   - Account locked: full-width banner with live countdown
 *
 * "Use system keyboard instead" toggle: swaps the on-screen keypad for a
 * native <input inputMode="numeric"> for users who prefer their phone's
 * keyboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ROLES, type RoleCode } from "@/lib/roles";

const PIN_LENGTH = 4;

export interface PinKeypadProps {
  userName: string;
  role: RoleCode;
  /** Called with the entered PIN once the user submits. Returns when the API resolves. */
  onSubmit: (pin: string) => Promise<{ ok: true } | { ok: false; error: PinKeypadError }>;
  onBack: () => void;
}

export type PinKeypadError =
  | { kind: "invalid"; message?: string }
  | { kind: "locked"; retryAfterSeconds: number }
  | { kind: "inactive" }
  | { kind: "network"; message?: string };

function vibrateIfAvailable(durationMs: number) {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(durationMs);
  } catch {
    // Some browsers throw on disallowed vibration contexts; ignore.
  }
}

function formatRetryAfter(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function PinKeypad({ userName, role, onSubmit, onBack }: PinKeypadProps) {
  const def = ROLES[role];
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<PinKeypadError | null>(null);
  const [shake, setShake] = useState(false);
  const [useSystemKeyboard, setUseSystemKeyboard] = useState(false);
  const [retryRemaining, setRetryRemaining] = useState<number | null>(null);
  const systemInputRef = useRef<HTMLInputElement | null>(null);

  // Live lockout countdown
  useEffect(() => {
    if (retryRemaining === null) return;
    if (retryRemaining <= 0) {
      setError(null);
      setRetryRemaining(null);
      return;
    }
    const t = window.setTimeout(() => {
      setRetryRemaining((s) => (s === null ? null : s - 1));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [retryRemaining]);

  useEffect(() => {
    if (useSystemKeyboard) systemInputRef.current?.focus();
  }, [useSystemKeyboard]);

  const triggerError = useCallback((err: PinKeypadError) => {
    setError(err);
    vibrateIfAvailable(200);
    setShake(true);
    window.setTimeout(() => setShake(false), 400);
    setPin("");
    if (err.kind === "locked") {
      setRetryRemaining(err.retryAfterSeconds);
    }
  }, []);

  const submit = useCallback(
    async (full: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const result = await onSubmit(full);
        if (!result.ok) triggerError(result.error);
      } catch {
        triggerError({ kind: "network", message: "Network error. Try again." });
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, triggerError],
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (submitting || retryRemaining !== null) return;
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
    [submitting, retryRemaining, submit],
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

  // Physical keyboard handling — accessibility affordance + desktop testing.
  useEffect(() => {
    if (useSystemKeyboard) return;
    function onKey(e: KeyboardEvent) {
      if (submitting || retryRemaining !== null) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setPin((prev) => prev.slice(0, -1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [useSystemKeyboard, submitting, retryRemaining, handleDigit, handleClear]);

  const dots = Array.from({ length: PIN_LENGTH }, (_, i) => i < pin.length);
  const isLocked = retryRemaining !== null;

  return (
    <div className="flex w-full flex-col items-stretch gap-6">
      {/* Identity + dots — top ~40% */}
      <div className="flex flex-col items-center gap-4 pt-2">
        <div className="flex flex-col items-center gap-1">
          <span
            className="rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-co-text"
            style={{ background: def.color + "33", border: `1px solid ${def.color}` }}
          >
            {def.label}
          </span>
          <h2 className="mt-2 text-3xl font-extrabold leading-tight text-co-text">{userName}</h2>
          <p className="text-sm text-co-text-dim">Enter your 4-digit PIN</p>
        </div>

        <div
          aria-label={`PIN entry: ${pin.length} of ${PIN_LENGTH} digits entered`}
          className={`flex items-center gap-4 ${shake ? "co-shake" : ""}`}
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

        {error && error.kind !== "locked" && (
          <p className="text-center text-sm font-semibold text-co-cta" role="alert">
            {error.kind === "invalid" && (error.message ?? "Wrong PIN. Try again.")}
            {error.kind === "inactive" && "This account is inactive. Ask an admin."}
            {error.kind === "network" && (error.message ?? "Network error. Try again.")}
          </p>
        )}

        {isLocked && retryRemaining !== null && (
          <div
            role="alert"
            className="w-full rounded-xl border-2 border-co-cta bg-co-cta/10 px-4 py-3 text-center"
          >
            <p className="text-sm font-bold uppercase tracking-wide text-co-cta">Account locked</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-co-text">
              {formatRetryAfter(retryRemaining)}
            </p>
            <p className="mt-1 text-xs text-co-text-muted">
              Too many failed attempts. Try again in {formatRetryAfter(retryRemaining)}.
            </p>
          </div>
        )}
      </div>

      {/* Keypad — bottom ~60% */}
      {!useSystemKeyboard ? (
        <div className="grid grid-cols-3 gap-3" aria-label="PIN keypad">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <KeypadButton key={d} onClick={() => handleDigit(d)} disabled={submitting || isLocked}>
              {d}
            </KeypadButton>
          ))}
          <KeypadButton variant="ghost" onClick={handleClear} disabled={submitting || isLocked}>
            Clear
          </KeypadButton>
          <KeypadButton onClick={() => handleDigit("0")} disabled={submitting || isLocked}>
            0
          </KeypadButton>
          <KeypadButton variant="ghost" disabled aria-hidden>
            {submitting ? <Spinner /> : ""}
          </KeypadButton>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <input
            ref={systemInputRef}
            type="tel"
            inputMode="numeric"
            pattern="\d*"
            autoComplete="one-time-code"
            maxLength={PIN_LENGTH}
            value={pin}
            disabled={submitting || isLocked}
            onChange={(e) => handleSystemInput(e.target.value)}
            aria-label="PIN"
            className="
              w-full max-w-[280px] rounded-xl border-2 border-co-border-2
              bg-co-surface px-4 py-3 text-center text-3xl font-extrabold
              tracking-[0.4em] tabular-nums text-co-text
              focus:border-co-text focus:outline-none focus:ring-4 focus:ring-co-gold/60
              disabled:opacity-50
            "
          />
          {submitting && <Spinner />}
        </div>
      )}

      {/* Footer: back + keyboard toggle */}
      <div className="mt-2 flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="
            inline-flex items-center gap-1 px-2 py-2 font-semibold text-co-text
            hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold
            disabled:opacity-50
          "
        >
          <span aria-hidden>←</span> Back
        </button>
        <button
          type="button"
          onClick={() => setUseSystemKeyboard((v) => !v)}
          disabled={submitting}
          className="
            px-2 py-2 text-co-text-dim underline-offset-2 hover:text-co-text hover:underline
            focus:outline-none focus-visible:ring-2 focus-visible:ring-co-gold
            disabled:opacity-50
          "
        >
          {useSystemKeyboard ? "Use on-screen keypad" : "Use system keyboard"}
        </button>
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
    "flex h-16 sm:h-20 items-center justify-center rounded-2xl text-2xl font-bold transition select-none focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 disabled:opacity-40 disabled:cursor-not-allowed";
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
