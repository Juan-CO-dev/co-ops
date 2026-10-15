"use client";

/**
 * StepUpProvider — client orchestration for admin step-up (C.44 Module 1; catalog Phase 1
 * 2026-10-15 adds Tier E and one-shot grants). Hosts a single PasswordModal for the admin
 * subtree and exposes requestStepUp(tier) and requestStepUpGrant(purpose) to descendants.
 *
 *   Tier A — if the shared flag is set, resolve "ok" without a prompt; else prompt.
 *   Tier B — always prompt (the server-side freshness check is the real gate).
 *   Tier E — the catalog/recipe edit window, on its OWN clock: no prompt while this device's
 *            catalog unlock is inside the window (minus a 30 s margin); else prompt.
 *   Grant  — ALWAYS prompt; the password POST carries the purpose and the server mints one
 *            single-use grant for exactly that action and target.
 *
 * `catalogWindow` is true only on the admin surface: its passwords also open the window. The
 * client's memory is ADVISORY — when a route answers step_up_required / step_up_stale, the
 * caller runs forgetStepUp() (useStepUpPost does it) so the next request prompts. Refs mirror
 * the state so a forget or a confirm takes effect for a request made in the same tick.
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
import {
  confirmClientUnlock,
  DEFAULT_EDIT_WINDOW_MS,
  stepUpDecision,
  type StepUpPurpose,
  type StepUpTier,
} from "@/lib/admin/step-up-shared";

export { stepUpDecision };

interface StepUpContextValue {
  /** Ensure step-up for the tier; resolves "ok" once satisfied (possibly after a prompt) or "cancelled". */
  requestStepUp: (tier: StepUpTier) => Promise<"ok" | "cancelled">;
  /** Always prompt, and mint a one-shot grant for exactly this destructive act. */
  requestStepUpGrant: (purpose: StepUpPurpose) => Promise<"ok" | "cancelled">;
  /** Drop this device's memory of an unlock the server refused, so the next request prompts. */
  forgetStepUp: () => void;
  /** A password confirmed by an admin modal the provider does not own (the reactive CatalogClient
   *  modal): record it exactly as the provider's own confirm would (Astra r3 #1). */
  noteStepUpConfirmed: () => void;
  unlocked: boolean;
  unlockedAt: string | null;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({
  unlocked: initialUnlocked,
  unlockedAt: initialUnlockedAt,
  catalogUnlockedAt: initialCatalogUnlockedAt = null,
  catalogWindow = false,
  editWindowMs = DEFAULT_EDIT_WINDOW_MS,
  children,
}: {
  unlocked: boolean;
  unlockedAt: string | null;
  /** The server's catalog clock (sessions.catalog_edit_unlocked_at) at render. */
  catalogUnlockedAt?: string | null;
  /** True on the admin surface: a password typed here also opens the catalog edit window. */
  catalogWindow?: boolean;
  /** The server's Tier E window (lib/admin/step-up.ts stepUpEditWindowMs) — how the env override reaches the client. */
  editWindowMs?: number;
  children: ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [unlockedAt, setUnlockedAt] = useState<string | null>(initialUnlockedAt);
  const unlockedRef = useRef(initialUnlocked);
  const catalogRef = useRef<string | null>(initialCatalogUnlockedAt);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPurpose, setModalPurpose] = useState<StepUpPurpose | null>(null);
  const resolverRef = useRef<((r: "ok" | "cancelled") => void) | null>(null);

  const openModal = useCallback(
    (purpose: StepUpPurpose | null) =>
      new Promise<"ok" | "cancelled">((resolve) => {
        resolverRef.current = resolve;
        setModalPurpose(purpose);
        setModalOpen(true);
      }),
    [],
  );

  const requestStepUp = useCallback(
    (tier: StepUpTier): Promise<"ok" | "cancelled"> => {
      if (stepUpDecision(tier, { unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, Date.now(), editWindowMs) === "proceed") {
        return Promise.resolve("ok");
      }
      return openModal(null);
    },
    [editWindowMs, openModal],
  );

  const requestStepUpGrant = useCallback((purpose: StepUpPurpose) => openModal(purpose), [openModal]);

  const forgetStepUp = useCallback(() => {
    unlockedRef.current = false;
    catalogRef.current = null;
    setUnlocked(false);
    setUnlockedAt(null);
  }, []);

  // ONE way to record a confirmed password, whichever admin modal took it.
  const noteStepUpConfirmed = useCallback(() => {
    const now = new Date().toISOString();
    const next = confirmClientUnlock({ unlocked: unlockedRef.current, catalogUnlockedAt: catalogRef.current }, now, catalogWindow);
    unlockedRef.current = next.unlocked;
    catalogRef.current = next.catalogUnlockedAt;
    setUnlocked(true);
    setUnlockedAt(now);
  }, [catalogWindow]);

  const handleConfirm = useCallback(() => {
    // PasswordModal posts /api/auth/step-up and calls onConfirm only on 200.
    noteStepUpConfirmed();
    setModalOpen(false);
    setModalPurpose(null);
    resolverRef.current?.("ok");
    resolverRef.current = null;
  }, [noteStepUpConfirmed]);

  const handleCancel = useCallback(() => {
    setModalOpen(false);
    setModalPurpose(null);
    resolverRef.current?.("cancelled");
    resolverRef.current = null;
  }, []);

  return (
    <StepUpContext.Provider value={{ requestStepUp, requestStepUpGrant, forgetStepUp, noteStepUpConfirmed, unlocked, unlockedAt }}>
      {children}
      <PasswordModal
        open={modalOpen}
        purpose={modalPurpose}
        catalogWindow={catalogWindow}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </StepUpContext.Provider>
  );
}

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error("useStepUp must be used within <StepUpProvider>.");
  return ctx;
}
