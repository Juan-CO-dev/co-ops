/**
 * /written-reports — the Written Reports surface.
 *
 * Free-text staff posts ("shift happened, something went wrong, write it down").
 * The list is visibility-gated server-side (listWrittenReports reproduces the
 * live RLS predicates); L3+ may author. Moved into the (authed) route group
 * (mirrors the reports hub migration) so it sits behind the authed layout while
 * keeping the /written-reports URL.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function WrittenReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  redirect(`/reports/written${params.size ? `?${params.toString()}` : ""}`);
}
