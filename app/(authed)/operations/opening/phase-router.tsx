/**
 * C.53 — Opening phase-router contract (type-contract-lock stub).
 *
 * Decides which phase-specific component mounts based on `instance.status`.
 * The three phase components don't exist yet (UI restructure lands in
 * downstream commits); this stub locks the mounting contract so the page
 * wiring is stable across the restructure.
 *
 * Status → active phase mapping (mirrors `activeOpeningPhase` in lib/opening.ts;
 * the lib helper is for non-UI consumers, this is for the page render path):
 *   - `'open'`              → Phase 1 (verification + spot-check)
 *   - `'phase1_complete'`   → Phase 2 (prep entry)
 *   - `'phase2_complete'`   → Phase 3 (setup verification)
 *   - terminal statuses     → null (read-only branch is handled by page.tsx)
 *
 * Wiring contract: page.tsx passes the three phase component implementations
 * as props (`phase1`, `phase2`, `phase3`) when they exist. Until then the
 * router renders null for unmounted phases — page.tsx fallback (or the legacy
 * opening-client.tsx during the transition window) covers the gap.
 *
 * This file is intentionally minimal — no UI, no copy. The phase components
 * themselves will own their layout, copy, form state, and submission.
 */

import type { ReactNode } from "react";

import type { ChecklistInstance, ChecklistStatus } from "@/lib/types";

export type OpeningActivePhase = 1 | 2 | 3;

/**
 * Status → active phase derivation. Mirrors `activeOpeningPhase` in
 * lib/opening.ts (which is the non-UI / lib-side equivalent). Terminal
 * statuses return null; the caller renders a read-only branch.
 */
export function activePhaseForStatus(
  status: ChecklistStatus,
): OpeningActivePhase | null {
  if (status === "open") return 1;
  if (status === "phase1_complete") return 2;
  if (status === "phase2_complete") return 3;
  return null;
}

/**
 * Per-phase component contract. Each phase component receives the instance
 * row (and is free to load its own additional data via Server Components or
 * client-side fetches). Returning null is a valid response — the router will
 * fall through and the page can render its own fallback.
 */
export interface OpeningPhaseComponentProps {
  instance: ChecklistInstance;
}

export type OpeningPhaseComponent = (
  props: OpeningPhaseComponentProps,
) => ReactNode;

export interface OpeningPhaseRouterProps {
  instance: ChecklistInstance;
  /** Renders when instance.status === 'open'. Absent → null. */
  phase1?: OpeningPhaseComponent;
  /** Renders when instance.status === 'phase1_complete'. Absent → null. */
  phase2?: OpeningPhaseComponent;
  /** Renders when instance.status === 'phase2_complete'. Absent → null. */
  phase3?: OpeningPhaseComponent;
}

export function OpeningPhaseRouter({
  instance,
  phase1,
  phase2,
  phase3,
}: OpeningPhaseRouterProps): ReactNode {
  const active = activePhaseForStatus(instance.status);
  if (active === 1 && phase1) return phase1({ instance });
  if (active === 2 && phase2) return phase2({ instance });
  if (active === 3 && phase3) return phase3({ instance });
  return null;
}

/**
 * Type-contract-lock stub. Each phase component (Phase 1 / Phase 2 / Phase 3)
 * wraps its body in `<PhaseContainer phase={N}>` so the visual shell stays
 * consistent across the three downstream component implementations. The stub
 * is a thin pass-through that renders children verbatim; the real container
 * (header chrome, phase indicator, navigation affordances) lands when the
 * phase components themselves do. Defining the shape here keeps the per-phase
 * component call-sites stable across the restructure.
 */
export interface PhaseContainerProps {
  phase: OpeningActivePhase;
  children: ReactNode;
}

export function PhaseContainer({ children }: PhaseContainerProps): ReactNode {
  return children;
}
