"use client";

/**
 * DashboardBackLink — thin wrapper over the BackLink primitive that always
 * targets the dashboard.
 *
 * Kept (rather than deleted) because dozens of operator pages render it as
 * their top-of-page back affordance, and "back to dashboard" is genuinely the
 * right target for those top-level operator surfaces (closing, mid-day,
 * production, counts, cash, pm-report, etc. — pages with no intermediate
 * parent). Delegating to BackLink unifies the visual idiom (the ‹ chevron,
 * 44px, i18n aria) in one place; this wrapper just pins the target so callers
 * don't each pass the override.
 */

import { BackLink } from "@/components/nav/BackLink";

export function DashboardBackLink() {
  return <BackLink hrefOverride="/dashboard" labelKey="nav.dashboard" />;
}
