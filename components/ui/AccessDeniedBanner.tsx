import { BackLink } from "@/components/nav/BackLink";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

/**
 * AccessDeniedBanner — the honest "you don't have access" surface.
 *
 * Replaces the broken pattern where a gated page rendered its own PAGE TITLE
 * as the denial body (pm-report, mid-shift) — which told the user nothing and
 * looked like a rendering bug. This states plainly that access is denied and
 * to ask a manager, plus a BackLink home so the page is never a dead end.
 *
 * Server component (takes `language`, resolves via serverT) — the gated pages
 * that use it are all Server Components. BackLink is a client island rendered
 * inside; hrefOverride pins it to the dashboard (the universal home for a user
 * who lacks access to whatever they landed on).
 */
export function AccessDeniedBanner({ language }: { language: Language }) {
  return (
    <div>
      <BackLink hrefOverride="/dashboard" labelKey="nav.dashboard" />
      <div className="co-card p-5 text-center">
        <p className="text-sm font-bold text-co-text">
          {serverT(language, "access.denied.title")}
        </p>
        <p className="mt-1 text-sm text-co-text-muted">
          {serverT(language, "access.denied.body")}
        </p>
      </div>
    </div>
  );
}
