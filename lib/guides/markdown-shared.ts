/**
 * markdown-shared — the guides' Markdown subset, parsed into a typed block tree.
 *
 * PURE. Zero I/O, zero server imports (the `*-shared.ts` pattern, AGENTS.md
 * "Module boundaries"): the server reads the file and parses; the client
 * component renders the tree. Both sides import this module.
 *
 * WHY A PARSER AND NOT A DEPENDENCY. The three written guides
 * (docs/guides/*-guide.md) use a small, MEASURED subset of Markdown — headings,
 * paragraphs, bold/italic/inline-code, links, images, bullet lists (one level of
 * nesting), one table, and horizontal rules. No code fences, no HTML, no
 * blockquotes, no ordered lists. A markdown library would be a new npm
 * dependency plus an HTML string, and an HTML string on this surface means
 * `dangerouslySetInnerHTML`. **This module never emits HTML.** It emits typed
 * nodes; React renders them as elements, so authored guide text can never
 * become markup.
 *
 * THE SUBSET IS MEASURED, NOT ASSUMED. Counts taken over the three guides at
 * 2026-09-15 (staff 531 lines / manager 1116 / catering 652): 3 H1, 38 H2,
 * 143 H3, 38 rules, 427 bullets (7 of them one level deep), 146 images (4 of
 * them indented under a bullet), 1 table (staff), 10 inline links (7 in-document
 * anchors, 3 cross-guide), 3 lines carrying inline code, 86 italic spans, zero
 * code fences, zero raw HTML.
 *
 * ANYTHING OUTSIDE THE SUBSET DEGRADES TO PLAIN TEXT, NEVER TO AN ERROR. An
 * unterminated `**`, a table whose separator row is missing, an unknown line
 * shape — each renders as the paragraph a reader would still understand. A
 * guide is documentation a manager reads at 6 AM; a parse failure must never be
 * the reason a page is blank.
 */

export type GuideSlug = "staff" | "manager" | "catering";

export const GUIDE_SLUGS = ["staff", "manager", "catering"] as const satisfies readonly GuideSlug[];

export function isGuideSlug(value: string): value is GuideSlug {
  return (GUIDE_SLUGS as readonly string[]).includes(value);
}

// ─── The tree ───────────────────────────────────────────────────────────────

export type InlineRun =
  | { kind: "text"; text: string }
  | { kind: "bold"; runs: InlineRun[] }
  | { kind: "italic"; runs: InlineRun[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; runs: InlineRun[] }
  | { kind: "image"; src: string; alt: string };

export interface GuideListItem {
  runs: InlineRun[];
  children: GuideListItem[];
}

export type GuideBlock =
  | { kind: "heading"; level: number; text: string; id: string; runs: InlineRun[] }
  | { kind: "paragraph"; runs: InlineRun[] }
  | { kind: "list"; items: GuideListItem[] }
  | { kind: "table"; head: InlineRun[][]; rows: InlineRun[][][] }
  | { kind: "image"; src: string; alt: string }
  | { kind: "rule" };

/** One `##` heading — the contents list is exactly these, in document order. */
export interface GuideSection {
  id: string;
  text: string;
}

export interface GuideDoc {
  slug: GuideSlug;
  /** The `#` heading's text — the guide's own title. */
  title: string;
  blocks: GuideBlock[];
  sections: GuideSection[];
}

// ─── Reference rewriting ────────────────────────────────────────────────────

/**
 * `img/<guide>/<file>` → `/api/guides/img/<guide>/<file>`.
 *
 * The PNGs live under docs/, which is not public — they are screenshots OF THIS
 * APP's screens, so they sit behind the same staff login the screens do. The
 * route re-validates both segments; this rewrite is a display concern, never a
 * security boundary. Anything that is not a guide image path is left untouched.
 *
 * The filename shape deliberately allows an optional letter after the two
 * digits: five manager screenshots are inserts (`32b-`, `32c-`, `32d-`, `58b-`,
 * `58c-`) added after their neighbours were numbered.
 */
export function rewriteImageSrc(src: string): string {
  const m = /^img\/(staff|manager|catering)\/([0-9]{2}[a-z]?-[a-z0-9-]+\.png)$/.exec(src);
  return m ? `/api/guides/img/${m[1]}/${m[2]}` : src;
}

/**
 * Link targets, rewritten for the in-app reader.
 *
 * - `staff-guide.md#maintenance-log` → `/training?guide=staff#maintenance-log`
 *   (the guides cross-reference each other; in the app the other guide is a tab,
 *   and `?guide=` is what makes that tab addressable).
 * - `#some-heading` and absolute app paths pass through unchanged.
 * - Anything else — a scheme we do not recognise — returns null, and the caller
 *   renders the link's TEXT with no anchor. Refusing an unknown scheme here is
 *   what keeps `javascript:` out of an href by construction rather than by
 *   review.
 */
export function rewriteLinkHref(href: string): string | null {
  const cross = /^(staff|manager|catering)-guide\.md(#[a-z0-9-]*)?$/.exec(href);
  if (cross) return `/training?guide=${cross[1]}${cross[2] ?? ""}`;
  if (href.startsWith("#") || href.startsWith("/")) return href;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

/**
 * GitHub-compatible heading slug — the guides already link to each other's
 * headings by that spelling (`#reports-and-trends`, `#3-company-accounts`), and
 * all 7 in-document anchors were verified to resolve against this function.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function runsToPlainText(runs: InlineRun[]): string {
  return runs
    .map((run) => {
      switch (run.kind) {
        case "text":
        case "code":
          return run.text;
        case "image":
          return run.alt;
        default:
          return runsToPlainText(run.runs);
      }
    })
    .join("");
}

// ─── Inline parsing ─────────────────────────────────────────────────────────

const IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)/;
const LINK_RE = /^\[([^\]]+)\]\(([^)\s]+)\)/;
const BOLD_RE = /^\*\*([\s\S]+?)\*\*/;
const ITALIC_RE = /^\*(?!\*)([\s\S]+?)\*(?!\*)/;
const CODE_RE = /^`([^`\n]+)`/;

/**
 * Every branch consumes at least one character (the fallback consumes exactly
 * one), and every recursive call is on a strictly shorter substring — so this
 * terminates on any input, including malformed markup.
 */
export function parseInline(raw: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      runs.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < raw.length) {
    const rest = raw.slice(i);

    const image = IMAGE_RE.exec(rest);
    if (image) {
      flush();
      runs.push({ kind: "image", alt: image[1] ?? "", src: rewriteImageSrc(image[2] ?? "") });
      i += image[0].length;
      continue;
    }

    const link = LINK_RE.exec(rest);
    if (link) {
      flush();
      const href = rewriteLinkHref(link[2] ?? "");
      const inner = parseInline(link[1] ?? "");
      // An unsupported href degrades to its own text — the reader still reads
      // the sentence; only the anchor is gone.
      if (href === null) runs.push(...inner);
      else runs.push({ kind: "link", href, runs: inner });
      i += link[0].length;
      continue;
    }

    const bold = BOLD_RE.exec(rest);
    if (bold) {
      flush();
      runs.push({ kind: "bold", runs: parseInline(bold[1] ?? "") });
      i += bold[0].length;
      continue;
    }

    const italic = ITALIC_RE.exec(rest);
    if (italic) {
      flush();
      runs.push({ kind: "italic", runs: parseInline(italic[1] ?? "") });
      i += italic[0].length;
      continue;
    }

    const code = CODE_RE.exec(rest);
    if (code) {
      flush();
      runs.push({ kind: "code", text: code[1] ?? "" });
      i += code[0].length;
      continue;
    }

    buffer += raw[i];
    i += 1;
  }

  flush();
  return runs;
}

// ─── Block parsing ──────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const STANDALONE_IMAGE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const TABLE_SEPARATOR_RE = /^\|(?:\s*:?-+:?\s*\|)+$/;

function parseList(lines: string[]): GuideBlock {
  const root: GuideListItem[] = [];
  const stack: Array<{ indent: number; items: GuideListItem[] }> = [{ indent: -1, items: root }];

  for (const line of lines) {
    const m = BULLET_RE.exec(line);
    if (!m) continue;
    const indent = (m[1] ?? "").length;
    const item: GuideListItem = { runs: parseInline(m[2] ?? ""), children: [] };
    while (stack.length > 1 && indent <= (stack[stack.length - 1]?.indent ?? -1)) stack.pop();
    (stack[stack.length - 1]?.items ?? root).push(item);
    stack.push({ indent, items: item.children });
  }

  return { kind: "list", items: root };
}

function splitRow(line: string): InlineRun[][] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));
}

/** null = not a table after all; the caller degrades the lines to paragraphs. */
function parseTable(lines: string[]): GuideBlock | null {
  if (lines.length < 2) return null;
  if (!TABLE_SEPARATOR_RE.test(lines[1] ?? "")) return null;
  return {
    kind: "table",
    head: splitRow(lines[0] ?? ""),
    rows: lines.slice(2).map(splitRow),
  };
}

function uniqueId(base: string, seen: Map<string, number>): string {
  const next = (seen.get(base) ?? 0) + 1;
  seen.set(base, next);
  return next === 1 ? base : `${base}-${next}`;
}

export function parseGuideMarkdown(source: string, slug: GuideSlug): GuideDoc {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: GuideBlock[] = [];
  const sections: GuideSection[] = [];
  const seenIds = new Map<string, number>();
  let title = "";
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ kind: "paragraph", runs: parseInline(text) });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    if (RULE_RE.test(trimmed)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = (heading[1] ?? "#").length;
      const runs = parseInline(heading[2] ?? "");
      const text = runsToPlainText(runs);
      const id = uniqueId(slugify(text) || "section", seenIds);
      blocks.push({ kind: "heading", level, text, id, runs });
      if (level === 1 && !title) title = text;
      if (level === 2) sections.push({ id, text });
      i += 1;
      continue;
    }

    // A standalone image, indented or not. Four staff-guide screenshots sit
    // indented under a bullet; dedenting them to their own block keeps the
    // picture with its bullet visually and costs nothing structurally.
    const image = STANDALONE_IMAGE_RE.exec(trimmed);
    if (image) {
      flushParagraph();
      blocks.push({ kind: "image", alt: image[1] ?? "", src: rewriteImageSrc(image[2] ?? "") });
      i += 1;
      continue;
    }

    if (trimmed.startsWith("|")) {
      flushParagraph();
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        tableLines.push((lines[i] ?? "").trim());
        i += 1;
      }
      const table = parseTable(tableLines);
      if (table) blocks.push(table);
      else for (const raw of tableLines) blocks.push({ kind: "paragraph", runs: parseInline(raw) });
      continue;
    }

    if (BULLET_RE.test(line)) {
      flushParagraph();
      const listLines: string[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i] ?? "")) {
        listLines.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push(parseList(listLines));
      continue;
    }

    paragraph.push(trimmed);
    i += 1;
  }

  flushParagraph();

  return { slug, title, blocks, sections };
}
