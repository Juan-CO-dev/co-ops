import { BackLink } from "@/components/nav/BackLink";
import type { Language } from "@/lib/i18n/types";
import { parentFor } from "@/lib/nav-parents";
import { reportNavigationHref, reportParentContext } from "@/lib/report-navigation";

/**
 * A report page's way up: the registry back link to its parent. Nav PR 9 (spec 4.4, lead ruling Q6): the extra
 * "Dashboard" link beside it is gone; the top bar's Dashboard link (on every signed-in page) replaces it. So the page
 * links to /dashboard exactly once, and only when the Dashboard IS its parent. `language` stays in the props for the
 * callers; the back link reads the translation context itself.
 */
export function ReportPageNav({ path, params, viewerLevel = 0 }: { path: string; params: Record<string, string | undefined>; language: Language; viewerLevel?: number }) {
  const parent = viewerLevel < 2 ? { href: "/dashboard", labelKey: "nav.dashboard" as const } : parentFor(path);
  const parentParams = reportParentContext(parent.href, params, viewerLevel);
  const dashboardParams = { ...params, loc: params.location && params.location !== "all" ? params.location : undefined };
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <BackLink hrefOverride={reportNavigationHref(parent.href, parent.href === "/dashboard" ? dashboardParams : parentParams)} labelKey={parent.labelKey} className="mb-0" />
  </div>;
}
