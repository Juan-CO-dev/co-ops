/**
 * /written-reports — a legacy URL, kept as a redirect.
 *
 * Written reports joined the Reports hub (#392, 2026-10-07) and live at
 * /reports/written. This page renders nothing: it forwards every query
 * parameter (repeated ones included) to /reports/written, so bookmarks and old
 * notification deep links still land. Kept on purpose (nav spec r5 §7.3);
 * remove it once nothing external points here.
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
