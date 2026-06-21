"use client";

/**
 * StepUpProvider — client orchestration for two-tier admin step-up
 * (C.44 Module 1). Hosts a single PasswordModal for the admin subtree and
 * exposes requestStepUp(tier) to descendants.
 *
 *   Tier A — if already unlocked, resolve "ok" without a prompt; else prompt.
 *   Tier B — always prompt (the prompt refreshes step_up_unlocked_at; the
 *            server-side freshness check in lib/admin/step-up.ts is the real
 *            gate). Reads never call this.
 *
 * FOUNDATION PRIMITIVE: first live consumer is the User Management module.
 * The provider mounts in app/admin/layout.tsx so the whole admin surface can
 * call useStepUp(); it has no caller in this cycle (not dead code).
 *
 * Freshness is enforced server-side; the client `unlocked`/`unlockedAt` state
 * is convenience for the Tier A skip-the-prompt decision and is exposed on the
 * context for any future client-side pre-check.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { PasswordModal } from "@/components/auth/PasswordModal";
import type { StepUpTier } from "@/lib/admin/step-up";

/** Pure decision: does this tier need a password prompt given current unlock state? */
export function stepUpDecision(tier: StepUpTier, unlocked: boolean): "proceed" | "prompt" {
  if (tier === "A" && unlocked) return "proceed";
  return "prompt";
}

interface StepUpContextValue {
  /** Ensure step-up for the tier; resolves "ok" once satisfied (possibly after a prompt) or "cancelled". */
  requestStepUp: (tier: StepUpTier) => Promise<"ok" | "cancelled">;
  unlocked: boolean;
  unlockedAt: string | null;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({
  unlocked: initialUnlocked,
  unlockedAt: initialUnlockedAt,
  children,
}: {
  unlocked: boolean;
  unlockedAt: string | null;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [unlockedAt, setUnlockedAt] = useState<string | null>(initialUnlockedAt);
  const [modalOpen, setModalOpen] = useState(false);
  const resolverRef = useRef<((r: "ok" | "cancelled") => void) | null>(null);

  const requestStepUp = useCallback(
    (tier: StepUpTier): Promise<"ok" | "cancelled"> => {
      // Client `unlocked` is advisory — it drives the Tier A skip-the-prompt
      // UX only. The server-side assertStepUp (lib/admin/step-up.ts) is the
      // real gate; if the server flag was cleared underneath us, the consuming
      // action route returns step_up_required and the consumer re-prompts.
      if (stepUpDecision(tier, unlocked) === "proceed") return Promise.resolve("ok");
      return new Promise<"ok" | "cancelled">((resolve) => {
        resolverRef.current = resolve;
        setModalOpen(true);
      });
    },
    [unlocked],
  );

  const handleConfirm = useCallback(() => {
    // PasswordModal posts /api/auth/step-up and calls onConfirm only on 200.
    setUnlocked(true);
    setUnlockedAt(new Date().toISOString());
    setModalOpen(false);
    resolverRef.current?.("ok");
    resolverRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    resolverRef.current?.("cancelled");
    resolverRef.current = null;
  }, []);

  return (
    <StepUpContext.Provider value={{ requestStepUp, unlocked, unlockedAt }}>
      {children}
      <PasswordModal open={modalOpen} onConfirm={handleConfirm} onCancel={handleCancel} />
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error("useStepUp must be used within <StepUpProvider>.");
  return ctx;
}
