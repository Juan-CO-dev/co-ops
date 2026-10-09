/**
 * Where the Toast marketing list comes from — the seam (server-only). 0234.
 *
 * Step 0 finding (2026-10-08, scratch/toast-marketing-access.md): Toast documents NO endpoint or scope
 * for the Toast Marketing subscriber list or email opt-in status. Standard API access offers 14 read
 * scopes, none of them marketing; `guest.pi:read` exposes `check.customer` on orders, which carries no
 * consent. So the PRIMARY source is the Toast Web "Export Lists" CSV, imported by level 9+.
 *
 * If CC's live probe (or a Toast partner grant) ever exposes a subscriber read, it plugs in HERE:
 * implement `fetchSubscribers`, set TOAST_MARKETING_SYNC=1, and feed the rows to the SAME SQL path
 * (customer_consent_import_begin/chunk/finish with source 'toast_marketing_api') from the daily pull +
 * job-watch. Nothing else changes: same idempotency, same diff, same opt-out guard, same audit.
 */
import "server-only";
import type { ConsentImportRow } from "./consent-shared";

export type ConsentSourceKind = "toast_csv_import" | "toast_marketing_api";

export interface ConsentSourceStatus { kind: ConsentSourceKind; available: boolean; reason: string }

export function consentSources(env: Record<string, string | undefined> = process.env): ConsentSourceStatus[] {
  return [
    { kind: "toast_csv_import", available: true, reason: "toast_web_export_lists" },
    {
      kind: "toast_marketing_api",
      available: false,
      reason: env.TOAST_MARKETING_SYNC === "1" ? "toast_marketing_api_not_implemented" : "no_documented_toast_endpoint",
    },
  ];
}

/** The API seam. Refuses until a documented, granted endpoint exists; never guesses a URL. */
export async function fetchSubscribers(): Promise<{ rows: ConsentImportRow[]; explicitStatus: boolean; exportDate: string }> {
  throw new Error("toast_marketing_api_not_implemented");
}
