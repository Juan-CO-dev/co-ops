"use client";

/**
 * B8 #1 (sim walk 2026-10-14) — a prep-row Undo that needs TWO taps.
 *
 * A saved Phase 2 row grew a one-tap "Undo" pill; a tap meant for blank space
 * below landed on it and revoked the entry at once (quick_reenter, silent, no
 * confirm). The first tap now only ARMS the button ("Tap again to undo"); it
 * disarms itself after UNDO_CONFIRM_WINDOW_MS. Only a second tap inside that
 * window calls `onConfirm`.
 *
 * The tap rule is the pure `twoTapStep` so it is testable without a DOM.
 */
import { useEffect, useRef, useState } from "react";

export const UNDO_CONFIRM_WINDOW_MS = 4000;

export type TwoTapEvent = "tap" | "timeout";
export type TwoTapStep = { armed: boolean; fire: boolean };

/** Pure tap rule: idle --tap--> armed · armed --tap--> fire + idle · any --timeout--> idle. */
export function twoTapStep(armed: boolean, event: TwoTapEvent): TwoTapStep {
  if (event === "timeout") return { armed: false, fire: false };
  return armed ? { armed: false, fire: true } : { armed: true, fire: false };
}

export function TwoTapUndoButton({
  onConfirm,
  disabled,
  pending,
  label,
  armedLabel,
  pendingLabel,
  ariaLabel,
  armedAriaLabel,
  variant = "opening",
  resetKey,
}: {
  onConfirm: () => void;
  disabled: boolean;
  pending: boolean;
  label: string;
  armedLabel: string;
  pendingLabel: string;
  ariaLabel: string;
  armedAriaLabel: string;
  variant?: "opening" | "closing";
  resetKey?: string;
}) {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different completion/action must never inherit the previous row's arm.
  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    armedRef.current = false;
    setArmed(false);
  }, [resetKey]);

  // Unmount cleanup.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const handleClick = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const step = twoTapStep(armedRef.current, "tap");
    armedRef.current = step.armed;
    setArmed(step.armed);
    if (step.armed) {
      timer.current = setTimeout(() => {
        timer.current = null;
        armedRef.current = false;
        setArmed(twoTapStep(true, "timeout").armed);
      }, UNDO_CONFIRM_WINDOW_MS);
    }
    if (step.fire) onConfirm();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || pending}
      aria-label={armed ? armedAriaLabel : ariaLabel}
      data-armed={armed ? "true" : "false"}
      className={[
        variant === "closing"
          ? "shrink-0 inline-flex min-h-[48px] min-w-[64px] items-center justify-center rounded-lg border-2 bg-co-surface px-3 py-1"
          : "inline-flex min-h-[44px] items-center rounded-full border-2 bg-co-surface px-3 py-1",
        "text-[10px] font-bold uppercase tracking-[0.12em]",
        "transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60",
        "disabled:cursor-not-allowed disabled:opacity-60",
        armed
          ? "border-co-cta-text text-co-cta-text"
          : "border-co-border-2 text-co-text-muted hover:border-co-cta-text hover:text-co-cta-text",
      ].join(" ")}
    >
      {pending ? pendingLabel : armed ? armedLabel : label}
    </button>
  );
}
