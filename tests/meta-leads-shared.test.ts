import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { mapMetaLeadFields, META_CONSENT_QUESTION_KEY, META_CONSENT_COPY, META_CONSENT_TEXT_VERSION, META_WORK_EMAIL_KEY } from "@/lib/meta-leads/intake-shared";
import { verifyMetaSignature } from "@/lib/meta-leads/signature";
import { readBoundedBytes } from "@/lib/meta-leads/request";

const fields = (extra: Partial<Record<string, string>> = {}) => Object.entries({ full_name: "Sample Guest", email: "Guest@Example.org", preferred_shop: "PST", fulfillment_method: "pickup", ...extra }).map(([name, value]) => ({ name, values: [value] }));
describe("Meta form mapping", () => {
  it("retains unknown key names without their values", () => {
    const result = mapMetaLeadFields(fields({ surprise: "private answer", company_name: "Company", headcount: "25", event_date: "2026-12-01" }));
    expect(result).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org", shopCode: "PST", headcount: 25 }, rawKeys: expect.arrayContaining(["surprise"]) });
    expect(JSON.stringify(result)).not.toContain("private answer");
  });
  it.each([{}, { [META_CONSENT_QUESTION_KEY]: "false" }, { [META_CONSENT_QUESTION_KEY]: "anything" }])("requires affirmative pinned optin %j", extra => {
    expect(mapMetaLeadFields(fields(extra))).toMatchObject({ ok: true, consent: { optedIn: false } });
  });
  it("accepts only the pinned checked disclaimer", () => {
    expect(mapMetaLeadFields(fields(), [{ checkbox_key: META_CONSENT_QUESTION_KEY, is_checked: true }])).toMatchObject({ consent: { optedIn: true } });
    expect(mapMetaLeadFields(fields(), [{ checkbox_key: "unknown", is_checked: true }])).toMatchObject({ consent: { optedIn: false } });
    expect(mapMetaLeadFields(fields({ [META_CONSENT_QUESTION_KEY]: "true" }))).toMatchObject({ consent: { optedIn: true } });
    expect(mapMetaLeadFields(fields({ [META_CONSENT_QUESTION_KEY]: "false" }), [{ checkbox_key: META_CONSENT_QUESTION_KEY, is_checked: true }])).toMatchObject({ consent: { optedIn: false } });
  });
  it.each([{ preferred_shop: "" }, { fulfillment_method: "" }, { email: "guest@ezcater.com" }, { email: "noreply@example.org" }])("refuses unsafe/incomplete mapping %j", extra => {
    expect(mapMetaLeadFields(fields(extra))).toMatchObject({ ok: false, error: "invalid_payload" });
  });
  it("refuses duplicate scalar identities", () => expect(mapMetaLeadFields([...fields(), { name: "email", values: ["other@example.org"] }])).toMatchObject({ ok: false }));
});

describe("Double capture — the optional work email (Juan 2026-11-11)", () => {
  it("no work email: the Meta email is both the order and the marketing email, nothing secondary", () => {
    expect(mapMetaLeadFields(fields())).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org", marketingEmail: "guest@example.org", secondaryEmail: null } });
  });
  it("a valid work email becomes the ORDER email; the Meta email stays the marketing email and a secondary note", () => {
    expect(mapMetaLeadFields(fields({ [META_WORK_EMAIL_KEY]: " Buyer@Work.example " }))).toMatchObject({
      ok: true, intake: { contactEmail: "buyer@work.example", marketingEmail: "guest@example.org", secondaryEmail: "guest@example.org", notes: null },
    });
  });
  it("the same address in both boxes (any case) is ONE address", () => {
    expect(mapMetaLeadFields(fields({ [META_WORK_EMAIL_KEY]: "GUEST@EXAMPLE.ORG" }))).toMatchObject({
      ok: true, intake: { contactEmail: "guest@example.org", marketingEmail: "guest@example.org", secondaryEmail: null },
    });
  });
  it.each(["not-an-email", "someone@ezcater.com", "noreply@work.example"])("an invalid or relay work email %s is kept as typed and never becomes the identity", work => {
    expect(mapMetaLeadFields(fields({ [META_WORK_EMAIL_KEY]: work }))).toMatchObject({
      ok: true, intake: { contactEmail: "guest@example.org", secondaryEmail: null, notes: `Work email (as typed): ${work}` },
    });
  });
  it("an empty work email answer is simply absent", () => {
    expect(mapMetaLeadFields(fields({ [META_WORK_EMAIL_KEY]: "  " }))).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org", secondaryEmail: null, notes: null } });
  });
  it("a malformed work email value is tolerated like every optional field", () => {
    expect(mapMetaLeadFields([...fields(), { name: META_WORK_EMAIL_KEY, values: [1, 2] }])).toMatchObject({ ok: true, intake: { contactEmail: "guest@example.org" } });
  });
});

describe("Meta raw body authentication", () => {
  it("verifies exact non-ASCII raw bytes and rejects a whitespace mutation", () => {
    const raw = new TextEncoder().encode('{ "name": "José" }');
    const signature = `sha256=${createHmac("sha256", "stub-secret").update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, "stub-secret")).toBe(true);
    expect(verifyMetaSignature(new TextEncoder().encode('{"name":"José"}'), signature, "stub-secret")).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=123", "stub-secret")).toBe(false);
  });
  it("retains streamed bytes and enforces a bound without Content-Length", async () => {
    const bytes = new Uint8Array([0xff, 0, 32]);
    expect(await readBoundedBytes(new Response(bytes))).toEqual({ ok: true, bytes });
    expect(await readBoundedBytes(new Response(bytes), 2)).toEqual({ ok: false, status: 413 });
  });
});

it.each(["50-60", "about 40", "1.5"])("retains unstructured headcount %s", headcount => {
  expect(mapMetaLeadFields(fields({ headcount }))).toMatchObject({ ok: true, intake: { headcount: null, notes: `Headcount (as typed): ${headcount}` } });
});
it.each(["11/20/2026", "2026-02-30"])("retains unstructured date %s", event_date => {
  expect(mapMetaLeadFields(fields({ event_date }))).toMatchObject({ ok: true, intake: { eventDate: null, notes: `Event date (as typed): ${event_date}` } });
});
it("bounds invalid optional answers without losing intake", () => {
  const result = mapMetaLeadFields(fields({ company_name: "x".repeat(201), notes: "y".repeat(4001), headcount: "50-60" }));
  expect(result).toMatchObject({ ok: true, intake: { company: null, headcount: null } });
  if (result.ok) { expect(result.intake.notes).toContain("Notes (as typed): "); expect(result.intake.notes!.length).toBeLessThan(900); }
});
it.each([true, "1", "true", false, "0", "false", 1, 0, null, undefined, "yes", {}, []])("checkbox accepts only the three explicit values: %j", value => {
  expect(mapMetaLeadFields(fields(), [{ checkbox_key: META_CONSENT_QUESTION_KEY, is_checked: value }])).toMatchObject({ consent: { optedIn: value === true || value === "1" || value === "true" } });
});
it("pins the CO tenant consent copy and version (v3 names the email above)", () => {
  expect(META_CONSENT_COPY.en).toBe("Email me news and offers from Compliments Only at my email above. I can unsubscribe anytime.");
  expect(META_CONSENT_COPY.es).toBe("Quiero recibir novedades y ofertas de Compliments Only en mi correo de arriba. Puedo cancelar la suscripción cuando quiera.");
  expect(META_CONSENT_TEXT_VERSION).toBe("meta-email-marketing-v3");
  expect(mapMetaLeadFields(fields())).toMatchObject({ consent: { textVersion: "meta-email-marketing-v3" } });
});

it("renders both consent languages for another tenant", async () => {
  vi.stubEnv("NEXT_PUBLIC_TENANT_NAME", "Example Deli");
  vi.resetModules();
  try {
    const { META_CONSENT_COPY: copy } = await import("@/lib/meta-leads/intake-shared");
    expect(copy.en).toContain("Example Deli"); expect(copy.es).toContain("Example Deli");
    expect(JSON.stringify(copy)).not.toContain("Compliments Only");
  } finally { vi.unstubAllEnvs(); vi.resetModules(); }
});
it("preserves malformed optional raw values without rejecting identity", () => {
  expect(mapMetaLeadFields([...fields(), { name: "headcount", values: [40] }])).toMatchObject({ ok: true, intake: { headcount: null, notes: "Headcount (as typed): 40" } });
});
