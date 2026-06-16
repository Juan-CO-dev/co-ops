/**
 * /cash — Cash Deposit page (Task 10).
 *
 * Auth → location guard → KH+ gate → load today's live cash report.
 *   – Report exists  → read-only summary view.
 *   – No report yet  → load active users, render <CashClient> entry form.
 *
 * User query mirrors loadAgmPlusManagers in the mid-day page but loads ALL
 * active users at the location (not just AGM+): two-step to avoid the
 * PostgREST embedded-select + RLS footgun documented in AGENTS.md Phase 2
 * Session 4.
 */

import { redirect } from "next/navigation";

import { CASH_REPORT_BASE_LEVEL, loadCashReport } from "@/lib/cash";
import { formatCents, formatTime } from "@/lib/i18n/format";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";

import { DashboardBackLink } from "@/components/DashboardBackLink";
import { CashClient } from "./cash-client";

const OPERATIONAL_TZ = "America/New_York";

// Labeled row for the read-only summary view. Declared at module scope to
// satisfy the react-hooks/static-components lint rule (no nested component
// declarations inside render functions).
function ReadOnlyRow({
  labelKey,
  value,
  lang,
}: {
  labelKey: TranslationKey;
  value: string;
  lang: Language;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm">
      <span className="font-semibold text-co-text">{serverT(lang, labelKey)}</span>
      <span className="shrink-0 font-bold text-co-text">{value}</span>
    </li>
  );
}

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

interface PageProps {
  searchParams: Promise<{ location?: string }>;
}

export default async function CashPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/cash");
  const { location: locationParam } = await searchParams;

  if (!locationParam) redirect("/dashboard");
  if (auth.level < CASH_REPORT_BASE_LEVEL) redirect("/dashboard");

  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

  const sb = getServiceRoleClient();
  const lang = auth.user.language;
  const today = nyDateString(new Date());

  const report = await loadCashReport(sb, { locationId: locationParam, date: today });

  // When no report exists, load active users at this location before the return.
  let users: { id: string; name: string }[] = [];
  if (!report) {
    const { data: locScoped, error: locErr } = await sb
      .from("user_locations")
      .select("user_id")
      .eq("location_id", locationParam);
    if (locErr) throw new Error(`CashPage: user_locations: ${locErr.message}`);
    const locIds = ((locScoped ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);

    if (locIds.length > 0) {
      const { data: candidates, error: usersErr } = await sb
        .from("users")
        .select("id, name")
        .eq("active", true)
        .in("id", locIds)
        .order("name", { ascending: true });
      if (usersErr) throw new Error(`CashPage: users: ${usersErr.message}`);
      users = (candidates ?? []) as { id: string; name: string }[];
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>
      <h1 className="mb-4 text-lg font-bold text-co-text">
        {serverT(lang, "cash.page.title")}
      </h1>

      {report ? (
        <section className="flex flex-col gap-3">
          {/* Signed-off banner */}
          <p className="rounded-lg border-2 border-co-success bg-[#E6F4E6] px-3 py-2 text-sm font-semibold text-co-text">
            {serverT(lang, "cash.read_only.banner", {
              amount: formatCents(report.depositCents, lang),
              name: report.signedByName ?? "—",
              time: formatTime(report.signedAt, lang),
            })}
          </p>

          {/* Detail rows */}
          <ul className="flex flex-col gap-1.5 text-sm">
            <ReadOnlyRow
              labelKey="cash.field.projected"
              value={formatCents(report.projectedCents, lang)}
              lang={lang}
            />
            <ReadOnlyRow
              labelKey="cash.field.drawer_total"
              value={formatCents(report.drawerTotalCents, lang)}
              lang={lang}
            />
            {/* Over/short — use readout keys which encode the sign */}
            <li className="flex items-center justify-between gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm">
              <span className="font-semibold text-co-text">
                {serverT(
                  lang,
                  report.overShortCents >= 0
                    ? "cash.readout.over"
                    : "cash.readout.short",
                  { amount: formatCents(Math.abs(report.overShortCents), lang) },
                )}
              </span>
              <span className="shrink-0 font-bold text-co-text">
                {formatCents(report.overShortCents, lang)}
              </span>
            </li>
            {/* Deposit total */}
            <li className="flex items-center justify-between gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm">
              <span className="font-semibold text-co-text">
                {serverT(lang, "cash.readout.deposit", {
                  amount: formatCents(report.depositCents, lang),
                })}
              </span>
              <span className="shrink-0 font-bold text-co-text">
                {formatCents(report.depositCents, lang)}
              </span>
            </li>
            <ReadOnlyRow
              labelKey="cash.field.cash_tips"
              value={formatCents(report.cashTipsCents, lang)}
              lang={lang}
            />
          </ul>

          {/* On-shift staff */}
          {report.onShift.length > 0 && (
            <div className="rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm">
              <span className="font-semibold text-co-text">
                {serverT(lang, "cash.section.on_shift")}:{" "}
              </span>
              <span className="text-co-text">
                {report.onShift.map((e) => e.name).join(", ")}
              </span>
            </div>
          )}
        </section>
      ) : (
        <CashClient
          locationId={locationParam}
          date={today}
          users={users}
          closerName={auth.user.name}
          closerRole={auth.role}
          language={lang}
        />
      )}
    </main>
  );
}
