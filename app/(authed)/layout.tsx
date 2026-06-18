/**
 * Authenticated route group layout.
 *
 * Cross-cutting concerns owned by this layout:
 *   - requireSessionFromHeaders() — auth boundary
 *   - TranslationProvider — i18n context for all authenticated client components
 *   - UserMenu — floating top-right (fixed top-4 right-4 z-30)
 *
 * Back-to-dashboard is an IN-FLOW per-page affordance (components/
 * DashboardBackLink), not global chrome — Juan preferred the in-flow muted
 * ChevronLeft style over a floating pill. UserMenu also carries a Dashboard item.
 *
 * Architectural constraint for future authenticated pages: top-right corner
 * real estate is reserved for UserMenu (and future floating elements like a
 * notification bell). Pages render their own structural chrome (headers,
 * banners, etc.) but must NOT place critical interactive content in the
 * top-right corner where UserMenu's avatar + dropdown panel would overlap.
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
        UserMenu floats fixed in the top-right corner. z-30 keeps it above
        page content (sticky progress bars use z-20; modals use z-50, so
        the menu sits between page chrome and modal overlays — modals can
        cover it when they open, which is correct: modal-mode owns the
        full screen).
      */}
      <div className="fixed top-4 right-4 z-30">
        <UserMenu
          userName={auth.user.name}
          userEmail={auth.user.email}
          actorLevel={ROLES[auth.user.role].level}
          initialBlurb={auth.user.profileBlurb}
        />
      </div>
      {children}
    </TranslationProvider>
  );
}
