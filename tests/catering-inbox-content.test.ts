import { describe, expect, it } from "vitest";
import { capInboxBody, inboxContent, inboxHeaders, inboxHtmlToText, inboxThreadInitial, inboxOwnAddresses, inboxAttachmentManifest, INBOX_BODY_MAX_BYTES } from "@/lib/catering/inbox-content-shared";
describe("inbox content evidence", () => {
  it("caps bytes without splitting Unicode and retains original count", () => {
    expect(capInboxBody("a😀b", 4)).toEqual({ body_text: "a", body_original_bytes: 6, body_truncated: true });
    const result = capInboxBody("é".repeat(INBOX_BODY_MAX_BYTES));
    expect(new TextEncoder().encode(result.body_text).length).toBe(INBOX_BODY_MAX_BYTES);
    expect(result.body_original_bytes).toBe(INBOX_BODY_MAX_BYTES * 2);
  });
  it("keeps plain text, flags HTML-only and never preserves executable tags", () => {
    expect(inboxHtmlToText('<script>bad()</script><p>Hello &amp; hi</p><b>World</b>')).toBe("Hello & hi\n World");
    expect(inboxContent({ html: "<b>Hello</b>" })).toMatchObject({ body_text: "Hello", body_from_html: true });
    expect(inboxContent({ text: "plain", html: "<b>other</b>", subject: "x".repeat(2500) })).toMatchObject({ body_text: "plain", body_from_html: false, subject: "x".repeat(2000) });
  });
  it("allowlists, unfolds and bounds headers; refuses injection", () => {
    expect(inboxHeaders({ Authorization: "secret", References: "<a>\r\n <b>", "Message-ID": "x\r\nBcc: y", Precedence: "bulk" })).toEqual({ references: "<a> <b>", precedence: "bulk" });
    expect(inboxHeaders({ references: "x".repeat(3000) }).references).toHaveLength(2000);
    const malformed = inboxHeaders({ "in-reply-to": "<x>\r\nBcc: secret", references: "\0" });
    expect(malformed).toEqual({ "in-reply-to": "[invalid]", references: "[invalid]" });
    expect(inboxThreadInitial("Hello", malformed)).toBe(false);
    expect(inboxThreadInitial("Hello", inboxHeaders({ References: "<prior>", references: "" }))).toBe(false);
  });
  it.each(["Re: hello", "RE: hello", "Fw: hi", "Fwd: hi", "RV: hola", " re : hi"])("%s is not initial", subject => expect(inboxThreadInitial(subject, {})).toBe(false));
  it("both threading headers independently prevent a draft", () => {
    expect(inboxThreadInitial("Hello", {})).toBe(true);
    expect(inboxThreadInitial("Hello", { references: "<a>" })).toBe(false);
    expect(inboxThreadInitial("Hello", { "in-reply-to": "<a>" })).toBe(false);
  });
  it("computes own set from all configured sources without tenant literals", () => {
    expect([...inboxOwnAddresses({ aliases: [{ address: "alias@example.test", active: true }, { address: "old@example.test", active: false }], receiptAddresses: ["receipt@example.test", null], emailFrom: "Team <FROM@example.test>", emailFromTeam: "team@example.test", legacyAddresses: "legacy@example.test, second@example.test" })]).toEqual(["alias@example.test", "receipt@example.test", "from@example.test", "team@example.test", "legacy@example.test", "second@example.test"]);
  });
  it("caps manifest and strips provider data", () => {
    const manifest = inboxAttachmentManifest(Array.from({ length: 101 }, () => ({ filename: "x".repeat(300), content_type: "text/plain", size: 2, omission_reason: "not_fetched" as const, url: "secret" })));
    expect(manifest).toHaveLength(100); expect(manifest[0]?.filename).toHaveLength(255); expect(manifest[0]).not.toHaveProperty("url");
  });
});
