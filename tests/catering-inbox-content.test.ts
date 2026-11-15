import { describe, expect, it } from "vitest";
import { inboxLatestText, capInboxBody, inboxContent, inboxHeaders, inboxHtmlToText, inboxThreadInitial, inboxOwnAddresses, inboxAttachmentManifest, INBOX_BODY_MAX_BYTES } from "@/lib/catering/inbox-content-shared";
describe("inbox content evidence", () => {
  it("accepts receiving arrays and object maps with identical validation", () => {
    const map = { References: "<a>\r\n <b>", "Message-ID": "<id>", Authorization: "discard", "In-Reply-To": "bad\0" };
    expect(inboxHeaders([...Object.entries(map).map(([name, value]) => ({ name, value })), null, 4, { value: "missing name" }])).toEqual(inboxHeaders(map));
    for (const malformed of [null, undefined, false, "headers", 42]) expect(inboxHeaders(malformed)).toEqual({});
  });
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

it.each(["[EXTERNAL] RE: hello", "Re[2]: hi", "AW: hi", "RES: hi", "SV(3)\uff1a hi"])("extended prefix %s", subject => expect(inboxThreadInitial(subject, {})).toBe(false));
it("malformed non-string threading evidence stays noninitial", () => {
  for (const value of [false, 0, [], {}]) for (const key of ["In-Reply-To", "References"]) {
    const headers = inboxHeaders({ [key]: value });
    expect(headers[key.toLowerCase() as "references"]).toBe("[invalid]");
    expect(inboxThreadInitial("Hello", headers)).toBe(false);
  }
  expect(inboxThreadInitial("Hello", inboxHeaders({ References: null }))).toBe(true);
});
it("normalizes quote markers, drops blockquotes and preserves hearts", () => {
  expect(inboxLatestText("Hello\nEl lunes escribio\u0301:\nNeed catering").text).toBe("Hello");
  expect(inboxHtmlToText("<p>I <3 your subs</p><blockquote>Need catering</blockquote>")).toBe("I <3 your subs");
});
it("only bounded full template lines are stripped", () => {
  expect(inboxLatestText("The Tenant catering team").text).toBe("");
  const long = `The ${"x".repeat(121)} catering team`;
  expect(inboxLatestText(long).text).toBe(long);
  expect(inboxLatestText("Hi customer, I need catering").text).toBe("Hi customer, I need catering");
});

// Audit W11/B017: one HTML-only email must never freeze the worker (quadratic regex on unclosed openers).
describe("html-to-text is linear on unclosed openers", () => {
  it.each([
    ["<style>", 70_000], ["<script>", 60_000], ["<blockquote>", 40_000], ["<style ", 70_000], ["<br", 160_000], ["<STYLE>", 70_000],
  ] as const)("%s x %d", (chunk, times) => {
    const html = chunk.repeat(times);
    const start = performance.now();
    inboxHtmlToText(html);
    expect(performance.now() - start).toBeLessThan(500);
  });
  it("keeps today's output for closed and unclosed blocks", () => {
    expect(inboxHtmlToText("<style>a</style>b<style>c")).toBe("b c");
    expect(inboxHtmlToText("x<STYLE type=x>a</style >y<script>z")).toBe("x y z");
    expect(inboxHtmlToText("a<style>b<script>c</script>d")).toBe("a b d");
    expect(inboxHtmlToText("a<br>b<br/>c<br")).toBe("a\nb\nc");
    expect(inboxHtmlToText("a<blockquote x>q<blockquote>r</blockquote>s</blockquote>t")).toBe("a s t");
  });
  it("caps HTML before conversion and records the truncation", () => {
    const result = inboxContent({ html: "<p>x</p>" + "y".repeat(3_000_000) });
    expect(result.body_truncated).toBe(true);
    expect(result.body_original_bytes).toBeGreaterThan(Buffer.byteLength(result.body_text));
    expect(result.body_from_html).toBe(true);
  });
  it("a small HTML body is not marked truncated", () => {
    expect(inboxContent({ html: "<p>hello</p>" })).toMatchObject({ body_text: "hello", body_truncated: false });
  });
});
