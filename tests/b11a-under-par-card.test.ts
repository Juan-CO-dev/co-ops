/**
 * B11a-floor — the under-par card never prints a blank "par ," (pre-0255 rows have no par).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { underParDetailKey } from "@/lib/notifications";

describe("underParDetailKey", () => {
  it("par + closer → the full line", () => {
    expect(underParDetailKey({ par: 6, closer: 2 })).toBe("notifications.card.under_par.detail");
  });
  it("par, no closer → no-estimate", () => {
    expect(underParDetailKey({ par: 6, closer: null })).toBe("notifications.card.under_par.detail_no_estimate");
    expect(underParDetailKey({ par: "6", closer: "" })).toBe("notifications.card.under_par.detail_no_estimate");
  });
  it("old row without par → the no-par variants", () => {
    expect(underParDetailKey({ closer: 2 })).toBe("notifications.card.under_par.detail_no_par");
    expect(underParDetailKey({ par: null, closer: undefined })).toBe("notifications.card.under_par.detail_no_estimate_no_par");
    expect(underParDetailKey({ par: "  ", closer: 0 })).toBe("notifications.card.under_par.detail_no_par");
  });
  it("a par of 0 is a value, not a blank", () => {
    expect(underParDetailKey({ par: 0, closer: 0 })).toBe("notifications.card.under_par.detail");
  });
  it("the no-par strings exist in en + es and never mention {par}", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      for (const k of ["notifications.card.under_par.detail_no_par", "notifications.card.under_par.detail_no_estimate_no_par"]) {
        expect(dict[k], `${lang} ${k}`).toBeTruthy();
        expect(dict[k]).not.toContain("{par}");
      }
    }
  });
});
