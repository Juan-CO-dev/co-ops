import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { vendorMailHtmlToText, vendorMailTextSegments } from "@/lib/vendor-mail-shared";
import { VendorMailBody } from "@/app/(authed)/operations/vendor-mail/VendorMailPane";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const invite = '<p>Welcome to Baldor.</p><p><a class="btn" href="https://portal.baldor.example/set-password?token=abc&amp;user=42">Create your password</a></p>';

describe("vendor mail HTML keeps its links as visible text", () => {
  it("an anchor becomes its text followed by the URL", () => {
    const text = vendorMailHtmlToText(invite);
    expect(text).toContain("Create your password <https://portal.baldor.example/set-password?token=abc&user=42>");
    expect(text).toContain("Welcome to Baldor.");
  });
  it("an anchor whose text IS the URL, or has no text, shows the URL once", () => {
    expect(vendorMailHtmlToText('<a href="https://x.example/a">https://x.example/a</a>')).toBe("https://x.example/a");
    expect(vendorMailHtmlToText("<a href='https://x.example/b'><img src=x></a>")).toBe("<https://x.example/b>");
    expect(vendorMailHtmlToText("<A HREF=https://x.example/c>Go</A>")).toBe("Go <https://x.example/c>");
  });
  it("javascript:, data: and other schemes keep the text and never show the target", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java&#x09;script:alert(1)", "data:text/html,&lt;b&gt;x", "vbscript:x", "/relative", "file:///etc/passwd"]) {
      const text = vendorMailHtmlToText(`<a href="${href}">Click</a> done`);
      expect(text, href).toBe("Click done");
    }
  });
  it("an unclosed anchor still shows its URL, and markup in the href cannot inject a tag", () => {
    expect(vendorMailHtmlToText('<a href="https://x.example/u">Open')).toBe("Open <https://x.example/u>");
    const text = vendorMailHtmlToText('<a href="https://x.example/?q=&lt;script&gt;">Go</a>');
    expect(text).not.toContain("<script>");
    expect(text).toContain("Go <https://x.example/?q=%3Cscript%3E>");
  });
  it("stays linear on hostile input", () => {
    for (const chunk of ["<a ", "<a href=https://x.example/>", "</a>", "<a href='https://x.example'>x"]) {
      const start = performance.now();
      vendorMailHtmlToText(chunk.repeat(40_000));
      expect(performance.now() - start, chunk).toBeLessThan(1500);
    }
  });
  it("keeps the pre-existing conversion for markup without links", () => {
    expect(vendorMailHtmlToText("<script>bad()</script><p>Hello &amp; hi</p><b>World</b>")).toBe("Hello & hi\n World");
  });
});

it("the stored original email is labelled in Attachments and still goes through the signed download", async () => {
  const { readFileSync } = await import("node:fs");
  const en = (await import("@/lib/i18n/en.json")).default as Record<string, string>;
  const es = (await import("@/lib/i18n/es.json")).default as Record<string, string>;
  expect(en["vendorMail.asset_original"]).toBeTruthy();
  expect(es["vendorMail.asset_original"]).toBeTruthy();
  const source = readFileSync("app/(authed)/operations/vendor-mail/VendorMailPane.tsx", "utf8");
  expect(source).toContain('asset.kind === "body" && <span>{t("vendorMail.asset_original")}</span>');
  const assets = readFileSync("lib/vendor-mail-assets.ts", "utf8");
  expect(assets).toContain("{ download: asset.filename }");
});

describe("vendor mail body links are clickable only for http(s)", () => {
  it("splits text into text and http(s) link segments, trimming trailing punctuation", () => {
    expect(vendorMailTextSegments("See https://a.example/x?y=1. Or <http://b.example/p>, ok")).toEqual([
      { text: "See " }, { text: "https://a.example/x?y=1", href: "https://a.example/x?y=1" },
      { text: ". Or <" }, { text: "http://b.example/p", href: "http://b.example/p" }, { text: ">, ok" },
    ]);
    expect(vendorMailTextSegments("(https://w.example/wiki/A_(b))")).toEqual([
      { text: "(" }, { text: "https://w.example/wiki/A_(b)", href: "https://w.example/wiki/A_(b)" }, { text: ")" },
    ]);
  });
  it("never links javascript:, data: or other schemes", () => {
    const segments = vendorMailTextSegments("javascript:alert(1) data:text/html,x mailto:a@b.example ftp://x.example");
    expect(segments.every(segment => !("href" in segment))).toBe(true);
  });
  it("renders anchors that open safely in a new tab, wrap long URLs, and never raw HTML", () => {
    const long = `https://track.example/${"x".repeat(400)}`;
    const html = renderToStaticMarkup(jsx(VendorMailBody, { text: `Create your password <${long}>\n<script>bad()</script> javascript:alert(1)` }));
    expect(html).toContain(`href="${long}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toMatch(/<a [^>]*class="[^"]*break-all/);
    expect(html).toMatch(/<pre [^>]*class="[^"]*whitespace-pre-wrap[^"]*break-words/);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript');
    expect((html.match(/<a /g) ?? []).length).toBe(1);
  });
});
