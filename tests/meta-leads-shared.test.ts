import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapMetaLeadFields, META_CONSENT_QUESTION_KEY } from "@/lib/meta-leads/intake-shared";
import { verifyMetaSignature } from "@/lib/meta-leads/signature-shared";
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
  it.each([{ preferred_shop: "" }, { fulfillment_method: "" }, { email: "guest@ezcater.com" }, { email: "noreply@example.org" }, { headcount: "1.5" }, { event_date: "2026-02-30" }])("refuses unsafe/incomplete mapping %j", extra => {
    expect(mapMetaLeadFields(fields(extra))).toMatchObject({ ok: false, error: "invalid_payload" });
  });
  it("refuses duplicate scalar identities", () => expect(mapMetaLeadFields([...fields(), { name: "email", values: ["other@example.org"] }])).toMatchObject({ ok: false }));
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
