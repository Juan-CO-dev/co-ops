/**
 * The guides' Markdown parser + the role→guide gate.
 *
 * PURE modules, so they belong on the vitest spine. The parser's contract is
 * "everything in the measured subset becomes the right node, and everything
 * outside it becomes readable text" — both halves are pinned here, because the
 * second half is what keeps a malformed line from blanking a page a manager
 * opens at 6 AM.
 */

import { describe, expect, it } from "vitest";

import { defaultGuideFor, guidesForLevel, resolveInitialGuide } from "@/lib/guides/access-shared";
import {
  isGuideSlug,
  parseGuideMarkdown,
  parseInline,
  rewriteImageSrc,
  rewriteLinkHref,
  runsToPlainText,
  slugify,
  type GuideBlock,
} from "@/lib/guides/markdown-shared";

function parse(md: string): GuideBlock[] {
  return parseGuideMarkdown(md, "staff").blocks;
}

describe("headings", () => {
  it("levels, text and ids", () => {
    const doc = parseGuideMarkdown("# Staff guide\n\n## Logging in\n\n### 1. Where are you?\n", "staff");
    expect(doc.title).toBe("Staff guide");
    expect(doc.blocks.map((b) => b.kind)).toEqual(["heading", "heading", "heading"]);
    expect(doc.blocks[0]).toMatchObject({ kind: "heading", level: 1, id: "staff-guide" });
    expect(doc.blocks[1]).toMatchObject({ kind: "heading", level: 2, id: "logging-in" });
    expect(doc.blocks[2]).toMatchObject({ kind: "heading", level: 3, id: "1-where-are-you" });
  });

  it("the contents list is exactly the ## headings, in order", () => {
    const doc = parseGuideMarkdown(
      "# T\n\n## One\n\ntext\n\n### Deep\n\n## Two\n",
      "manager",
    );
    expect(doc.sections).toEqual([
      { id: "one", text: "One" },
      { id: "two", text: "Two" },
    ]);
  });

  it("ids are GitHub-compatible, so the guides' own anchors resolve", () => {
    // The real headings behind #reports-and-trends and #3-company-accounts.
    expect(slugify("Reports and trends")).toBe("reports-and-trends");
    expect(slugify("3. Company accounts")).toBe("3-company-accounts");
    expect(slugify("Setting up catering (admin)")).toBe("setting-up-catering-admin");
    expect(slugify("The opening report (Phase 1 — Verification)")).toBe(
      "the-opening-report-phase-1-verification",
    );
  });

  it("duplicate heading text gets a deduplicated id", () => {
    // Both guides really do repeat a step heading (staff: "1. Open it").
    const doc = parseGuideMarkdown("### 1. Open it\n\n### 1. Open it\n\n### 1. Open it\n", "staff");
    expect(doc.blocks.map((b) => (b.kind === "heading" ? b.id : null))).toEqual([
      "1-open-it",
      "1-open-it-2",
      "1-open-it-3",
    ]);
  });

  it("a heading with no slug-able characters still gets an id", () => {
    const doc = parseGuideMarkdown("## ???\n", "staff");
    expect(doc.blocks[0]).toMatchObject({ kind: "heading", id: "section" });
  });
});

describe("inline runs", () => {
  it("bold, italic and inline code", () => {
    expect(parseInline("Tap **Verified** now")).toEqual([
      { kind: "text", text: "Tap " },
      { kind: "bold", runs: [{ kind: "text", text: "Verified" }] },
      { kind: "text", text: " now" },
    ]);
    expect(parseInline('the line *"not shown"* here')).toEqual([
      { kind: "text", text: "the line " },
      { kind: "italic", runs: [{ kind: "text", text: '"not shown"' }] },
      { kind: "text", text: " here" },
    ]);
    // Three lines across the manager and catering guides carry inline code.
    expect(parseInline("reads `EM-20260908-PFG` at a glance")).toEqual([
      { kind: "text", text: "reads " },
      { kind: "code", text: "EM-20260908-PFG" },
      { kind: "text", text: " at a glance" },
    ]);
  });

  it("two bold spans on one line do not swallow the text between them", () => {
    expect(runsToPlainText(parseInline("**Par**, **Closer count** and more"))).toBe(
      "Par, Closer count and more",
    );
    expect(parseInline("**Par**, **Closer count**").filter((r) => r.kind === "bold")).toHaveLength(2);
  });

  it("an in-document link keeps its anchor; a cross-guide link becomes a tab link", () => {
    expect(parseInline("see [Reports and trends](#reports-and-trends)")).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "link",
        href: "#reports-and-trends",
        runs: [{ kind: "text", text: "Reports and trends" }],
      },
    ]);
    expect(rewriteLinkHref("staff-guide.md")).toBe("/training?guide=staff");
    expect(rewriteLinkHref("staff-guide.md#maintenance-log")).toBe(
      "/training?guide=staff#maintenance-log",
    );
    expect(rewriteLinkHref("https://example.com")).toBe("https://example.com");
  });

  it("an unsupported href is refused and the link degrades to its own text", () => {
    expect(rewriteLinkHref("javascript:alert(1)")).toBeNull();
    expect(parseInline("[tap me](javascript:alert)")).toEqual([{ kind: "text", text: "tap me" }]);
  });
});

describe("image src rewrite", () => {
  it("guide images route through the authenticated image route", () => {
    expect(rewriteImageSrc("img/staff/01-where-are-you.png")).toBe(
      "/api/guides/img/staff/01-where-are-you.png",
    );
    // Five manager screenshots are lettered inserts.
    expect(rewriteImageSrc("img/manager/32b-ordering-draft-add-item.png")).toBe(
      "/api/guides/img/manager/32b-ordering-draft-add-item.png",
    );
  });

  it("anything that is not a guide image path is left alone", () => {
    expect(rewriteImageSrc("img/staff/../../../etc/passwd")).toBe("img/staff/../../../etc/passwd");
    expect(rewriteImageSrc("https://example.com/x.png")).toBe("https://example.com/x.png");
  });

  it("a standalone image line becomes an image block, indented or not", () => {
    const blocks = parse(
      '![Login screen](img/staff/01-where-are-you.png)\n\n  ![Tip Pool placeholder page](img/staff/29-tips-stub.png)\n',
    );
    expect(blocks).toEqual([
      { kind: "image", alt: "Login screen", src: "/api/guides/img/staff/01-where-are-you.png" },
      {
        kind: "image",
        alt: "Tip Pool placeholder page",
        src: "/api/guides/img/staff/29-tips-stub.png",
      },
    ]);
  });
});

describe("lists", () => {
  it("a flat bullet list, with inline markup inside the items", () => {
    const blocks = parse("- First **bold** item\n- Second item\n");
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list?.kind).toBe("list");
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(list.items).toHaveLength(2);
    expect(runsToPlainText(list.items[0]!.runs)).toBe("First bold item");
    expect(list.items[0]!.children).toEqual([]);
  });

  it("one level of indentation nests under the preceding item", () => {
    const blocks = parse(
      "- Trends is three small charts:\n  - **Under / Over Par** — lower is better.\n  - **Fridge Temp Flags** — zero is the goal.\n- Next top-level item\n",
    );
    const list = blocks[0];
    if (list?.kind !== "list") throw new Error("expected a list");
    expect(list.items).toHaveLength(2);
    expect(list.items[0]!.children).toHaveLength(2);
    expect(runsToPlainText(list.items[0]!.children[1]!.runs)).toBe(
      "Fridge Temp Flags — zero is the goal.",
    );
    expect(list.items[1]!.children).toEqual([]);
  });
});

describe("tables", () => {
  it("the staff guide's one table parses head + rows", () => {
    const blocks = parse(
      "| Where | When it saves |\n|---|---|\n| Opening report → **Add comment** | When the opening is submitted |\n",
    );
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    if (table?.kind !== "table") throw new Error("expected a table");
    expect(table.head.map(runsToPlainText)).toEqual(["Where", "When it saves"]);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.map(runsToPlainText)).toEqual([
      "Opening report → Add comment",
      "When the opening is submitted",
    ]);
  });

  it("a pipe block with no separator row degrades to paragraphs, never to a broken table", () => {
    const blocks = parse("| Where | When |\n| Opening report | Later |\n");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "paragraph"]);
  });
});

describe("degrading safely", () => {
  it("an unterminated bold span stays literal text", () => {
    const blocks = parse("Tap **Verified and nothing closes it\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ kind: "text", text: "Tap **Verified and nothing closes it" }],
    });
  });

  it("constructs outside the subset become plain paragraphs and never HTML", () => {
    const blocks = parse(
      "> a blockquote\n\n1. an ordered item\n\n```\nfenced\n```\n\n<script>alert(1)</script>\n",
    );
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
    // The script tag survives as TEXT — it is a string in a node, never markup.
    const texts = blocks.map((b) => (b.kind === "paragraph" ? runsToPlainText(b.runs) : ""));
    expect(texts).toContain("<script>alert(1)</script>");
    expect(texts).toContain("> a blockquote");
    expect(texts).toContain("1. an ordered item");
  });

  it("a horizontal rule is a rule, and consecutive plain lines join into one paragraph", () => {
    const blocks = parse("one line\ntwo lines\n\n---\n\nafter\n");
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      runs: [{ kind: "text", text: "one line two lines" }],
    });
    expect(blocks[1]).toEqual({ kind: "rule" });
  });

  it("CRLF input parses identically to LF", () => {
    expect(parseGuideMarkdown("## One\r\n\r\n- a\r\n", "staff")).toEqual(
      parseGuideMarkdown("## One\n\n- a\n", "staff"),
    );
  });
});

describe("role → guide gating", () => {
  it("the floors are staff 2, manager 4, catering 6", () => {
    expect(guidesForLevel(1)).toEqual([]);
    expect(guidesForLevel(2)).toEqual(["staff"]); // trainee
    expect(guidesForLevel(3)).toEqual(["staff"]); // employee
    expect(guidesForLevel(4)).toEqual(["staff", "manager"]); // key holder, trainer
    expect(guidesForLevel(5)).toEqual(["staff", "manager"]); // shift lead
    expect(guidesForLevel(6)).toEqual(["staff", "manager", "catering"]); // AGM and up
    expect(guidesForLevel(9)).toEqual(["staff", "manager", "catering"]); // owner
  });

  it("the default tab is the highest guide that matches the role", () => {
    expect(defaultGuideFor("employee", guidesForLevel(3))).toBe("staff");
    expect(defaultGuideFor("key_holder", guidesForLevel(4))).toBe("manager");
    expect(defaultGuideFor("gm", guidesForLevel(7))).toBe("manager");
    // The one role whose job IS the catering guide.
    expect(defaultGuideFor("catering_mgr", guidesForLevel(6))).toBe("catering");
    expect(defaultGuideFor("prospect", guidesForLevel(0))).toBeNull();
  });

  it("?guide= wins when it is readable, and a bad value falls back instead of failing", () => {
    expect(resolveInitialGuide("employee", guidesForLevel(3), "staff")).toBe("staff");
    expect(resolveInitialGuide("gm", guidesForLevel(7), "catering")).toBe("catering");
    // Out of reach for an employee — silently falls back to their default.
    expect(resolveInitialGuide("employee", guidesForLevel(3), "catering")).toBe("staff");
    expect(resolveInitialGuide("gm", guidesForLevel(7), "nonsense")).toBe("manager");
    expect(resolveInitialGuide("gm", guidesForLevel(7), undefined)).toBe("manager");
  });

  it("isGuideSlug is the only spelling of a guide name", () => {
    expect(isGuideSlug("staff")).toBe(true);
    expect(isGuideSlug("Staff")).toBe(false);
    expect(isGuideSlug("../staff")).toBe(false);
  });
});
