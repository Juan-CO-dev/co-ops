/**
 * /admin, the Back office (C.44 Module 1; grouped by nav PR 4, nav spec r5 section 5). Renders inside
 * app/admin/layout.tsx (auth + role gate + chrome). Re-calls requireSessionFromHeaders for typed auth access (the C.39
 * pattern; ~5ms duplicate cost is accepted vs prop-drilling from the layout).
 *
 * This page reads; BackOfficeHub (components/admin/back-office) draws. It reads the session, the `?denied=` notice,
 * the two switches the Back office needs and today's health loaders, each only for a viewer allowed its check. The
 * loaders run side by side and each fails SOFT: a rejected read is `failed` (shown as Unavailable, never as a zero),
 * so no loader can take the page down. Rows and jobs come from lib/nav/back-office.ts, by each destination's own rule,
 * for the session's trusted role.
 */

import { listVendorMail } from "@/lib/vendor-mail";
import { vendorMailRoleAllowed } from "@/lib/vendor-mail-shared";
import { countNotReady } from "@/lib/admin/readiness-load";
import { loadCronHealth, loadInboundHealth } from "@/lib/admin/ops-health";
import { canManageInboundAliases } from "@/lib/admin/inbound-settings-shared";
import { loadWeekCard } from "@/lib/admin/week-card";
import {
  READINESS_SECTIONS, inboxCheck, notReadyChecks, salesPullCheck, vendorMailCheck, type Read,
} from "@/lib/admin/back-office-shared";
import { backOfficeFor } from "@/lib/nav/back-office";
import { requireSessionFromHeaders } from "@/lib/session";
import { demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import { BackOfficeHub } from "@/components/admin/back-office/BackOfficeHub";

const DENIED_KEYS = {
  users: "admin.hub.denied.users",
  pricing: "admin.hub.denied.pricing",
  rate_rules: "admin.hub.denied.rate_rules",
} as const;

/** A loader as a Read that never rejects: a rejection is logged and becomes `failed`, never a value. */
function settle<T>(p: Promise<T>, what: string): Promise<Read<T>> {
  return p.then(
    (value): Read<T> => ({ state: "ok", value }),
    (e: unknown): Read<T> => {
      console.error(`hub ${what} failed (rendering it as Unavailable)`, e);
      return { state: "failed" };
    },
  );
}

export default async function AdminHubPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin");
  // A level-8 page (users · pricing · rate rules) sends a GM here with ?denied= instead of
  // bouncing to the dashboard with no message (guide-walk finding, 2026-09-08).
  const { denied } = await searchParams;
  const deniedKey = denied && denied in DENIED_KEYS ? DENIED_KEYS[denied as keyof typeof DENIED_KEYS] : null;
  // The switches the rows need (BACK_OFFICE_SWITCHES). MARKETING_SCORECARD === "1" is the old hand tile's own test.
  const switches = { demandSignals: demandSignalsEnabled(process.env.DEMAND_SIGNALS), marketingScorecard: process.env.MARKETING_SCORECARD === "1" };
  const office = backOfficeFor({ role: auth.role, level: auth.level, switches });

  // Each check is read only for a viewer shown it (today's panels' rules): readiness for a viewer with a SKU, recipe or
  // prep item row; vendor mail for GM and MoO+; inbound mail for MoO+.
  const shown = new Set(office.groups.flatMap((g) => g.rows.map((r) => r.id)));
  const readiness = new Set(READINESS_SECTIONS.filter((s) => shown.has(s)));
  const [counts, vendorMail, inbound, cron, week] = await Promise.all([
    readiness.size > 0 ? settle(countNotReady(auth), "readiness counts") : null,
    vendorMailRoleAllowed(auth.user.role)
      ? settle(listVendorMail(auth, { stale: true }).then((v) => v.reconciliation.stale_count), "vendor mail") : null,
    canManageInboundAliases(auth.user.role) ? settle(loadInboundHealth(auth), "inbound health") : null,
    settle(loadCronHealth(), "cron health"),
    // "This week in CO-OPS": the shops side by side, bound to the shops this viewer may read.
    settle(loadWeekCard({ role: auth.role, locations: auth.locations, level: auth.level }), "week card"),
  ]);

  const sales = salesPullCheck(cron);
  const checks = [
    sales,
    ...(inbound ? [inboxCheck(inbound)] : []),
    ...(vendorMail ? [vendorMailCheck(vendorMail)] : []),
    ...(counts ? notReadyChecks(counts, readiness) : []),
  ];

  return (
    <BackOfficeHub view={{
      lang: auth.user.language, now: new Date().toISOString(), deniedKey, office, checks, sales, cron, vendorMail, inbound, week,
    }} />
  );
}
