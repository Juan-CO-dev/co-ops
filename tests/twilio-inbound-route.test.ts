import { createHmac, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Audit W11/B167: the signature was checked over a last-value-wins map while the ledgered fields came from form.get
// (first value), so forged fields prepended to a captured, signed body were ledgered. Synthetic numbers only; no send.
const mocks = vi.hoisted(() => ({ ingest: vi.fn() }));
vi.mock("@/lib/sms-messages", () => ({ ingestInboundSms: mocks.ingest }));
import { POST } from "@/app/api/webhooks/twilio-inbound/route";

const URL_SIGNED = "https://app.example.test/api/webhooks/twilio-inbound";
let token = "";
const sign = (params: Record<string, string>) =>
  createHmac("sha1", token).update(URL_SIGNED + Object.keys(params).sort().map(k => k + params[k]).join(""), "utf8").digest("base64");
const request = (body: string, signature: string) => new NextRequest(URL_SIGNED, { method: "POST", body,
  headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature } });
const legit = { From: "+15551110000", To: "+15552220000", Body: "hi", MessageSid: "SM1", NumMedia: "0" };
const legitBody = new URLSearchParams(legit).toString();

beforeEach(() => {
  vi.clearAllMocks();
  token = randomBytes(16).toString("hex");
  vi.stubEnv("TWILIO_AUTH_TOKEN", token);
  vi.stubEnv("TWILIO_WEBHOOK_URL", URL_SIGNED);
  mocks.ingest.mockResolvedValue({ smsId: "sms1", linkedPoId: null });
});
afterEach(() => vi.unstubAllEnvs());

it("a prepended duplicate field set is refused and never ledgered", async () => {
  const forged = "From=%2B15553330000&Body=PO-1234+confirmed&MessageSid=SMforged&" + legitBody;
  const response = await POST(request(forged, sign(legit)));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: "duplicate_field" });
  expect(mocks.ingest).not.toHaveBeenCalled();
});
it("ledgers exactly the verified values", async () => {
  const response = await POST(request(legitBody, sign(legit)));
  expect(response.status).toBe(200);
  expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({ providerSid: "SM1", fromNumber: "+15551110000", toNumber: "+15552220000", body: "hi", mediaUrls: [] }));
});
it("a bad signature is still 401 and never ledgered", async () => {
  expect((await POST(request(legitBody, sign({ ...legit, Body: "other" })))).status).toBe(401);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
