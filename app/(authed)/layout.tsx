/**
 * Authenticated route group layout.
 *
 * Cross-cutting concerns owned by this layout:
 *   - requireSessionFromHeaders() — auth boundary
 *   - TranslationProvider — i18n context for all authenticated client components
 *   - UserMenu — IN-FLOW top-right row above the page (scrolls away with it)
 *
 * Back-to-dashboard is an IN-FLOW per-page affordance (components/
 * DashboardBackLink), not global chrome — Juan preferred the in-flow muted
 * ChevronLeft style over a floating pill. UserMenu also carries a Dashboard item.
 *
 * UserMenu used to float (`fixed top-4 right-4`). A fixed 44px circle sat on top
 * of whatever a page put in its top-right (the DASHBOARD link on /my-feedback and
 * /reports/written, ORDERING > on Receiving) and covered anything that scrolled
 * under it (B3 / issue #53). It now takes its own row ABOVE the page content, so
 * it overlaps nothing and scrolls away with the page. Its dropdown is absolutely
 * positioned off the trigger and the row is `relative z-30`, so the open panel
 * still stacks above page content and sticky bars (z-20).
 *
 * Page-level requireSessionFromHeaders calls are KEPT for typed auth
 * access (locations, level, role for page logic). The ~5ms duplicate
 * cost is acceptable vs prop-drilling from this layout — Server
 * Component layouts can't cleanly pass typed objects to children, and
 * the alternatives (Context from a Server layer, or layout-children
 * prop API gymnastics) create worse downstream problems. See
 * SPEC_AMENDMENTS.md C.39 for the full architectural rationale.
 */

import type { ReactNode } from "react";

import { UserMenu } from "@/components/UserMenu";
import { CanvasWatermark } from "@/components/layout/CanvasWatermark";
import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { TranslationProvider } from "@/lib/i18n/provider";
import { ROLES } from "@/lib/roles";
import { requireSessionFromHeaders } from "@/lib/session";

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  // Auth boundary at the layout level. Pages still call
  // requireSessionFromHeaders themselves for typed auth access in their
  // own page logic (banner derivation, location-scoped queries, etc.) —
  // this call is the "you must be authenticated to render anything in
  // (authed)" gate. Per Phase 2 Session 4: requireSessionFromHeaders
  // redirects to /?next=<path> on denial via next/navigation redirect().
  const auth = await requireSessionFromHeaders("/dashboard");

  return (
    <TranslationProvider initialLanguage={auth.user.language}>
      {/*
        UserMenu sits in its own in-flow row. `relative z-30` keeps the OPEN
        dropdown above page content (sticky progress bars use z-20; modals use
        z-50, so the menu sits between page chrome and modal overlays - modals
        can cover it when they open, which is correct: modal-mode owns the
        full screen).
      */}
      <div className="relative z-30 flex justify-end px-4 pt-3 sm:px-6">
        <UserMenu
          userName={auth.user.name}
          userEmail={auth.user.email}
          actorLevel={ROLES[auth.user.role].level}
          initialBlurb={auth.user.profileBlurb}
        />
      </div>
      <CanvasWatermark />
      {/* Idle-timeout guard for ALL authenticated pages — hoisted here (was
          mounted on only 2 pages) so the 10-min idle logout warning is global. */}
      <IdleTimeoutWarning />
      {children}
    </TranslationProvider>
  );
}
