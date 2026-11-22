/**
 * Authenticated route group layout.
 *
 * Cross-cutting concerns owned by this layout:
 *   - requireSessionFromHeaders() — auth boundary
 *   - TranslationProvider — i18n context for all authenticated client components
 *   - NavFrame (nav PR 9) — the one global chrome: the IN-FLOW top bar
 *     ([Dashboard] [bell] [Go to]), the idle-logout warning, and the Go to
 *     context, WRAPPING the page so the Dashboard's "All pages" opens the same
 *     sheet as the bar. It replaced the user-menu row.
 *
 * The bar never floats (B3 / issue #53: a fixed 44px circle covered whatever a
 * page put in its top-right). It is the first row above the page content, with
 * no z-index, and scrolls away with the page; the sheets it opens are portaled.
 *
 * Page-level requireSessionFromHeaders calls are KEPT for typed auth
 * access (locations, level, role for page logic). The ~5ms duplicate
 * cost is acceptable vs prop-drilling from this layout — Server
 * Component layouts can't cleanly pass typed objects to children, and
 * the alternatives (Context from a Server layer, or layout-children
 * prop API gymnastics) create worse downstream problems. See
 * SPEC_AMENDMENTS.md C.39 for the full architectural rationale.
 */

import { Suspense, type ReactNode } from "react";

import { ShopContextSync } from "@/components/ShopContextSync";
import { CanvasWatermark } from "@/components/layout/CanvasWatermark";
import { NavFrame } from "@/components/nav/NavFrame";
import { TranslationProvider } from "@/lib/i18n/provider";
import { accessibleLocations } from "@/lib/locations";
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
      {/* The top bar, the idle-logout warning and Go to, around the page (nav PR 9). */}
      <NavFrame auth={auth} language={auth.user.language}>
        <CanvasWatermark />
        {/* B2: an explicit ?location= / ?loc= pick becomes the remembered shop (lib/shop-context-shared.ts). */}
        <Suspense fallback={null}>
          <ShopContextSync allowed={accessibleLocations({ role: auth.role, locations: auth.locations })} />
        </Suspense>
        {children}
      </NavFrame>
    </TranslationProvider>
  );
}
