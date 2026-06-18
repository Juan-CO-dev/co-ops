import Link from "next/link";

import { serverT } from "@/lib/i18n/server";
import type { Language } from "@/lib/i18n/types";

/**
 * "← Back to trends" link for the trends sub-pages (ops / team). Points at the
 * trends landing (carrying the active location), so the nav hierarchy is
 * dashboard → trends landing → ops/team → person, rather than jumping straight
 * back to the dashboard.
 */
export function BackToTrendsLink({ locationId, language }: { locationId: string; language: Language }) {
  return (
    <Link
      href={`/reports/trends?location=${locationId}`}
      className="inline-flex items-center gap-1 text-xs font-semibold text-co-text-muted transition hover:text-co-text"
    >
      ← {serverT(language, "reports.trends.back")}
    </Link>
  );
}
