import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInboundContent, INBOUND_ASSET_LIMIT, trustedAttachmentUrl } from "@/lib/inbound-fetch";

const emailId = "fixture-message";
const url = "https://inbound-cdn.resend.com/fixture-message/attachments/fixture-attachment";
const attachment = (overrides = {}) => ({ id: "fixture-attachment", filename: "invoice.pdf", content_type: "application/pdf",
  size: 3, download_url: url, expires_at: new Date(Date.now() + 60_000).toISOString(), ...overrides });
function mockFetch(items: unknown[], download = new Response(new Uint8Array([1, 2, 3]))) {
  return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: emailId, text: "Invoice body" }))
    .mockResolvedValueOnce(Response.json({ data: items, has_more: false })).mockResolvedValueOnce(download);
}
beforeEach(() => vi.stubEnv("RESEND_API_KEY", randomBytes(20).toString("hex")));
afterEach(() => vi.unstubAllEnvs());
describe("inbound receiving API", () => {
  it("catering opts into exactly one GET, preserving body/header and attachment metadata without bytes", async () => {
    const metadata = { id: emailId, text: "Catering request", html: "<p>Catering request</p>",
      headers: { "Message-ID": "<fixture>" }, attachments: [attachment()] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata));
    const result = await fetchInboundContent(emailId, fetcher, { metadataOnly: true });
    expect(result).toEqual({ text: metadata.text, html: metadata.html, headers: metadata.headers, attachments: metadata.attachments });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(`https://api.resend.com/emails/receiving/${emailId}?html_format=cid`);
    expect(fetcher.mock.calls[0]![1]?.method ?? "GET").toBe("GET");
    expect(result).not.toHaveProperty("rawEml");
    expect(result.attachments[0]).not.toHaveProperty("bytes");
  });
  it("fetches metadata-only mail body and attachment bytes, with no bearer on CDN", async () => {
    const fetcher = mockFetch([attachment()]);
    const content = await fetchInboundContent(emailId, fetcher);
    expect(content.rawEml?.bytes.toString()).toBe("Invoice body");
    expect([...content.attachments[0]!.bytes]).toEqual([1, 2, 3]);
    expect(fetcher.mock.calls[0]![0]).toBe(`https://api.resend.com/emails/receiving/${emailId}?html_format=cid`);
    expect(fetcher.mock.calls[1]![0]).toContain("/attachments?limit=100");
    expect(fetcher.mock.calls[2]![1]).toMatchObject({ redirect: "error" });
    expect(fetcher.mock.calls[2]![1]?.headers).toBeUndefined();
  });
  it.each([
    "https://inbound-cdn.resend.com/fixture-message/attachments/fixture-attachment?signature=x",
    "https://cdn.resend.app/receiving/fixture-message/attachments/fixture-attachment?signature=x",
  ])("trusts Resend's receiving CDN shape %s", ok => {
    expect(trustedAttachmentUrl(ok, emailId, "fixture-attachment")).toBe(true);
  });
  it.each(["https://evil.example.test/file", "https://inbound-cdn.resend.com/other/attachments/fixture-attachment",
    "https://inbound-cdn.resend.com.evil.example.test/fixture-message/attachments/fixture-attachment", "http://inbound-cdn.resend.com/fixture-message/attachments/fixture-attachment",
    "https://cdn.resend.app/fixture-message/attachments/fixture-attachment", "https://inbound-cdn.resend.com/receiving/fixture-message/attachments/fixture-attachment",
    "https://cdn.resend.app/receiving/other/attachments/fixture-attachment", "https://cdn.resend.app.evil.example.test/receiving/fixture-message/attachments/fixture-attachment",
    "https://cdn.resend.app:8443/receiving/fixture-message/attachments/fixture-attachment", "https://user@cdn.resend.app/receiving/fixture-message/attachments/fixture-attachment"])("refuses untrusted URL %s", async bad => {
    expect(trustedAttachmentUrl(bad, emailId, "fixture-attachment")).toBe(false);
    const fetcher = mockFetch([attachment({ download_url: bad })]);
    await expect(fetchInboundContent(emailId, fetcher)).rejects.toThrow("resend_untrusted_download");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects expired links and re-lists for fresh links on retry", async () => {
    const fetcher = mockFetch([attachment({ expires_at: "2020-01-01T00:00:00Z" })]);
    await expect(fetchInboundContent(emailId, fetcher)).rejects.toThrow("resend_download_expired");
    const retry = mockFetch([attachment()]);
    expect((await fetchInboundContent(emailId, retry)).attachments[0]?.bytes.length).toBe(3);
    expect(retry.mock.calls[1]![0]).toContain("/attachments?");
  });
  it("refuses failed downloads", async () => {
    await expect(fetchInboundContent(emailId, mockFetch([attachment()], new Response(null, { status: 403 })))).rejects.toThrow("resend_download_failed");
  });
  it("records oversize and disallowed content as omissions without downloading", async () => {
    const fetcher = mockFetch([attachment({ size: INBOUND_ASSET_LIMIT + 1 }), attachment({ id: "executable", content_type: "application/x-executable" })]);
    const content = await fetchInboundContent(emailId, fetcher);
    expect(content.attachments.map(a => [a.omitted, a.omissionReason, a.bytes.length])).toEqual([[true, "size", 0], [true, "content_type", 0]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("enforces actual download size even when listed size is small", async () => {
    const content = await fetchInboundContent(emailId, mockFetch([attachment()], new Response(null, { headers: { "content-length": String(INBOUND_ASSET_LIMIT + 1) } })));
    expect(content.attachments[0]).toMatchObject({ omitted: true, omissionReason: "size" });
  });
});

it.each([401, 403])("provider HTTP %s is a configuration failure", async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("do not persist provider text", { status }));
  await expect(fetchInboundContent(emailId, fetcher)).rejects.toThrow("provider_auth");
});
