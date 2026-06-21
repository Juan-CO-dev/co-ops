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
 * Owns: auth boundary, role gate (level >= 6), TranslationProvider, floating
 * UserMenu (parity with (authed)), StepUpProvider (seeds the two-tier step-up
 * client state), and admin chrome (context-aware back link + container).
 */

import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AdminBackLink } from "@/components/admin/AdminBackLink";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { UserMenu } from "@/components/UserMenu";
import { TranslationProvider } from "@/lib/i18n/provider";
import { ROLES } from "@/lib/roles";
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
      <div className="fixed top-4 right-4 z-30">
        <UserMenu
          userName={auth.user.name}
          userEmail={auth.user.email}
          actorLevel={ROLES[auth.user.role].level}
          initialBlurb={auth.user.profileBlurb}
        />
      </div>
      <StepUpProvider
        unlocked={auth.session.stepUpUnlocked}
        unlockedAt={auth.session.stepUpUnlockedAt}
      >
        <div className="mx-auto w-full max-w-[640px] px-4 py-6">
          <AdminBackLink />
          {children}
        </div>
      </StepUpProvider>
    </TranslationProvider>
  );
}
