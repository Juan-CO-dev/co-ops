// A11: the privacy page's lead-form section — Juan-approved copy (2026-11-11) with the catering address
// read from tenant DATA, never a literal in code; unset → today's sentence.
import { expect, it } from "vitest";
import { leadformDeleteLine } from "@/lib/landing/privacy-copy";
import { loadLandingConfig } from "@/lib/landing/config";
import { serverT } from "@/lib/i18n/server";

it("renders the CO deletion line with the catering address from config, en + es", () => {
  const email = loadLandingConfig({}).cateringContactEmail;
  expect(email).toBe("catering@complimentsonlysubs.com");
  expect(leadformDeleteLine("en", email)).toBe("To ask us to delete your details or withdraw marketing consent, email us at catering@complimentsonlysubs.com from the email address you used. We confirm within a few business days.");
  expect(leadformDeleteLine("es", email)).toBe("Para pedirnos que borremos tus datos o retirar tu permiso de marketing, escríbenos a catering@complimentsonlysubs.com desde el correo que usaste. Te confirmamos en unos días hábiles.");
});
it("an unset or blank address falls back to the sentence that names none", () => {
  for (const unset of [undefined, "", "   "]) {
    expect(leadformDeleteLine("en", unset)).toBe(serverT("en", "landing.privacy.leadform.delete"));
    expect(leadformDeleteLine("es", unset)).toBe(serverT("es", "landing.privacy.leadform.delete"));
    expect(leadformDeleteLine("en", unset)).not.toContain("{email}");
  }
});
it("the rest of the approved section is pinned (en)", () => {
  expect(serverT("en", "landing.privacy.leadform.title")).toBe("Catering lead forms on Facebook and Instagram");
  expect(serverT("en", "landing.privacy.leadform.optin")).toContain("only at the email you ticked it for");
  expect(serverT("en", "landing.privacy.leadform.use")).toContain("expires after 72 hours");
  for (const key of ["collect", "use", "optin", "retention"] as const) expect(serverT("es", `landing.privacy.leadform.${key}`)).not.toBe(serverT("en", `landing.privacy.leadform.${key}`));
});
