/**
 * NavFrame: THE global chrome of every signed-in page (nav PR 9, plan r2 3.1; spec 4.1, 9; lead ruling r1 F1).
 *
 * Server component, mounted by both layouts and by every signed-in page tree outside them (/ordering, /training,
 * /training/build/[item], the standalone planned pages). It WRAPS the page: the caller's children stay server children,
 * rendered inside the client NavShell after the bar row, so the Dashboard's "All pages" and the bar share one Go to.
 *
 * - Takes the caller's AuthContext; never reads the session itself. Reads the switches once (env only) and builds the
 *   Go to model on the server from the session's REAL role and level (lib/nav/go-to.ts).
 * - Carries the idle-logout warning, today's exact mount: a page inside NavFrame has it; no page may lose it (the census,
 *   tests/nav-frame-mounts.test.ts).
 * - The bell: only for `notificationBellRoleAllowed(auth.role)`. Otherwise the `bell` prop is null: no TopBarBell element
 *   exists in the tree, so no notification read can start (the social media manager). The bell streams inside its own
 *   <Suspense>; the page shell never waits for it.
 */
import "server-only";
import { Suspense, type ReactNode } from "react";

import { IdleTimeoutWarning } from "@/components/auth/IdleTimeoutWarning";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { goToEntries } from "@/lib/nav/go-to";
import { navSwitches } from "@/lib/nav-switches";
import { notificationBellRoleAllowed } from "@/lib/notification-bell-shared";
import { ROLES } from "@/lib/roles";
import { sessionIdleMinutes, type AuthContext } from "@/lib/session";

import { BellSlot } from "./BellSlot";
import { NavShell } from "./NavShell";
import { TopBarBell } from "./TopBarBell";

export function NavFrame({ auth, language, children }: { auth: AuthContext; language?: Language; children?: ReactNode }) {
  const lang = language ?? auth.user.language;
  const switches = navSwitches();
  const model = goToEntries({ role: auth.role, level: auth.level, language: lang }, switches);
  const bellAllowed = notificationBellRoleAllowed(auth.role);
  const me = {
    userName: auth.user.name,
    userEmail: auth.user.email,
    actorLevel: ROLES[auth.user.role].level,
    initialBlurb: auth.user.profileBlurb,
    sessionId: auth.session.id,
  };
  return (
    <>
      <IdleTimeoutWarning idleMinutes={sessionIdleMinutes()} userId={auth.user.id} sessionId={auth.session.id} />
      <NavShell
        model={model}
        me={me}
        bell={bellAllowed ? (
          <Suspense fallback={<BellSlot label={serverT(lang, "notifications.bell.loading_aria")} />}>
            <TopBarBell auth={auth} />
          </Suspense>
        ) : null}
      >
        {children}
      </NavShell>
    </>
  );
}
