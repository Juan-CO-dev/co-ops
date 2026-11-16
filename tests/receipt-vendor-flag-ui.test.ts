/** W20/B194 (owner decision W20-1 b): a receipt whose account number is on file for a different
 *  vendor than the sender is FLAGGED for a person. The triage row must say so in both languages. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const panel = readFileSync("components/receiving/VendorClaimPanel.tsx", "utf8");
const KEYS = ["receiving.claim.vendor_mismatch", "receiving.claim.use_account_vendor", "receiving.claim.attribution_conflict_count"] as const;

describe("vendor-mismatch flag on the receiving triage row", () => {
  it("has its own wording in English and Spanish, naming both vendors", () => {
    for (const key of KEYS) {
      expect((en as Record<string, string>)[key], key).toBeTruthy();
      expect((es as Record<string, string>)[key], key).toBeTruthy();
      expect((es as Record<string, string>)[key]).not.toBe((en as Record<string, string>)[key]);
    }
    for (const lang of [en, es] as Array<Record<string, string>>) {
      expect(lang["receiving.claim.vendor_mismatch"]).toContain("{account}");
      expect(lang["receiving.claim.vendor_mismatch"]).toContain("{sender}");
      expect(lang["receiving.claim.use_account_vendor"]).toContain("{vendor}");
      // The pill counts both kinds of flag, so it no longer says "shop".
      expect(lang["receiving.claim.attribution_conflict_count"]).not.toMatch(/shop|local/i);
    }
  });
  it("the row shows the vendor wording for a vendor flag and the shop wording otherwise", () => {
    expect(panel).toContain('r.conflictKind === "vendor" ? (');
    expect(panel).toContain('t("receiving.claim.vendor_mismatch", { account: r.accountVendorName ?? "?", sender: r.vendorName ?? "?" })');
    expect(panel).toContain('t("receiving.claim.attribution_conflict")');
    // Same shop, different vendor: the action names the vendor, never "Move to <same shop>".
    expect(panel).toContain('r.conflictKind === "vendor" && r.accountLocationId === r.locationId');
    expect(panel).toContain('t("receiving.claim.use_account_vendor", { vendor: r.accountVendorName ?? "?" })');
  });
});
