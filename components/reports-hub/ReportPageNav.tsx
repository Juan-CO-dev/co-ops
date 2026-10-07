import Link from "next/link";
import { BackLink } from "@/components/nav/BackLink";
import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";
import { parentFor } from "@/lib/nav-parents";
import { reportNavigationHref, reportParentContext } from "@/lib/report-navigation";

export function ReportPageNav({ path, params, language, viewerLevel = 0 }: { path: string; params: Record<string, string | undefined>; language: Language; viewerLevel?: number }) {
  const parent = parentFor(path);
  const parentParams = reportParentContext(parent.href, params, viewerLevel);
  const dashboardParams = { ...params, loc: params.location && params.location !== "all" ? params.location : undefined };
  return <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <BackLink hrefOverride={reportNavigationHref(parent.href, parent.href === "/dashboard" ? dashboardParams : parentParams)} labelKey={parent.labelKey} className="mb-0" />
    {parent.href !== "/dashboard" && <Link href={reportNavigationHref("/dashboard", dashboardParams)} className="inline-flex min-h-[44px] items-center rounded-md px-2 text-xs font-bold uppercase text-co-text-muted hover:text-co-text">{serverT(language, "nav.dashboard")}</Link>}
  </div>;
}
