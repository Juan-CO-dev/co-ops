/**
 * Admin layout (C.44 Module 1) — the admin shell.
 *
 * /admin is its own top-level route group (NOT under (authed)) so the single
 * requireSessionFromHeaders("/admin") call keeps the step-up auto-clear in
 * lib/session.ts coherent: that logic clears step_up_unlocked whenever the
 * served path doesn't start with "/admin/". Under (authed), the parent
 * layout's hardcoded requireSessionFromHeaders("/dashboard") would clear
 * step-up on every admin page load.
 *
 * Owns: auth boundary, role gate (level >= 6), TranslationProvider, NavFrame
 * (nav PR 9: the in-flow top bar, the idle-logout warning and Go to, the same
 * chrome as (authed); the floating user menu is gone), StepUpProvider (seeds the
 * two-tier step-up client state), and admin chrome (context-aware back link +
 * container). The bar renders BEFORE and OUTSIDE StepUpProvider; its background
 * requests are step-up NEUTRAL by exact path and its links never prefetch, so
 * the bar neither keeps nor clears an unlock (lib/session.ts STEP_UP_NEUTRAL_PATHS).
 */

import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";

import { BackLink } from "@/components/nav/BackLink";
import { ShopContextSync } from "@/components/ShopContextSync";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { stepUpEditWindowMs } from "@/lib/admin/step-up";
import { CanvasWatermark } from "@/components/layout/CanvasWatermark";
import { NavFrame } from "@/components/nav/NavFrame";
import { TranslationProvider } from "@/lib/i18n/provider";
import { accessibleLocations } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";

const ADMIN_MIN_LEVEL = 6;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Auth boundary — redirects to /?next=/admin on denial.
  const auth = await requireSessionFromHeaders("/admin");
  // Role gate — authenticated but below the admin floor.
  if (auth.level < ADMIN_MIN_LEVEL) redirect("/dashboard");

  const lang = auth.user.language;

  return (
    <TranslationProvider initialLanguage={lang}>
      {/* The top bar, the idle-logout warning and Go to, around the admin shell (nav PR 9). */}
      <NavFrame auth={auth} language={lang}>
        <CanvasWatermark />
        {/* B2: an explicit ?location= / ?loc= pick becomes the remembered shop (lib/shop-context-shared.ts). */}
        <Suspense fallback={null}>
          <ShopContextSync allowed={accessibleLocations({ role: auth.role, locations: auth.locations })} />
        </Suspense>
        <StepUpProvider
          unlocked={auth.session.stepUpUnlocked}
          unlockedAt={auth.session.stepUpUnlockedAt}
          catalogUnlockedAt={auth.session.catalogEditUnlockedAt ?? null}
          catalogWindow
          editWindowMs={stepUpEditWindowMs()}
        >
          <div className="mx-auto w-full max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 py-6">
            <BackLink />
            {children}
          </div>
        </StepUpProvider>
      </NavFrame>
    </TranslationProvider>
  );
}
