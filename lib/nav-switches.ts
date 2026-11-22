/**
 * The navigation switches, read from the environment ONCE per request (nav PR 7, plan r2 section 2.2). Outside lib/nav on
 * purpose: the destination list stays pure and the caller reads the environment (lib/nav/types.ts `Switches`). The
 * Dashboard passes the same object to the engine's viewer, the shortcuts and the "All pages" list.
 */
import "server-only";
import { businessReportEnabled } from "@/lib/business-report-shared";
import { demandSignalsEnabled } from "@/lib/demand-signals/config-shared";
import type { Switches } from "@/lib/nav/types";
import { pulseV2Enabled } from "@/lib/pulse/flag";
import { vaultEnabled } from "@/lib/vault-flag";

export function navSwitches(): Switches {
  return {
    pulseV2: pulseV2Enabled(),
    vault: vaultEnabled(),
    businessReport: businessReportEnabled(process.env),
    demandSignals: demandSignalsEnabled(process.env.DEMAND_SIGNALS),
    // customerProfilesEnabled()'s rule (lib/customers/customers.ts), inlined: that module is the customers boundary and
    // would pull the audit and service-client graph into every Dashboard render. tests/dashboard-shortcuts.test.ts pins the two equal.
    customerProfiles: process.env.CUSTOMER_PROFILES === "1",
    // The scorecard's own switch test (lib/marketing/write.ts).
    marketingScorecard: process.env.MARKETING_SCORECARD === "1",
  };
}
