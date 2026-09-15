"use client";

/**
 * GuideReader — the reading surface for the three written guides.
 *
 * DISPLAY-STRING CONTRACT (the CollapsibleSection contract, for the same
 * reason): every visible string arrives ALREADY TRANSLATED. /training sits
 * outside the (authed) route group, so there is no TranslationProvider above it
 * — the page runs serverT and hands the results down, exactly as PlaceholderCard
 * does for the stubs.
 *
 * IT RENDERS NODES, NEVER MARKUP. The tree comes from lib/guides/markdown-shared
 * and every node becomes a React element here. There is no HTML string anywhere
 * in this path and no dangerouslySetInnerHTML — guide text cannot become markup
 * even if someone pastes a tag into the Markdown.
 *
 * PHONE FIRST — this is read at 6 AM on a phone and again on a laptop. One
 * reading column; tabs are a wrapping pill row (D6: tabs partition concerns and
 * never collapse); contents is a CollapsibleSection (D3 — secondary to the guide
 * itself) that opens itself on desktop widths and stays shut on a phone, where
 * 16 section links ahead of the text is the whole first screen; every heading
 * carries an anchor so a manager can send one section to one person.
 */

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import type { GuideBlock, GuideDoc, GuideListItem, GuideSlug, InlineRun } from "@/lib/guides/markdown-shared";

export interface GuideTab {
  slug: GuideSlug;
  /** Translated tab label. */
  label: string;
  doc: GuideDoc;
  /** Translated, already-interpolated "{n} sections" for the contents header. */
  contentsCount: string;
}

export interface GuideReaderLabels {
  contents: string;
  backToTop: string;
  tabsAria: string;
  /** Template carrying `{section}` — interpolated per heading below. */
  sectionLinkAria: string;
}

/** The provider's own interpolation, inlined: this surface has no provider. */
function withSection(template: string, section: string): string {
  return template.replace("{section}", section);
}

// ─── The viewport, as an external store ─────────────────────────────────────

const WIDE_VIEWPORT = "(min-width: 768px)";

function subscribeToWideViewport(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE_VIEWPORT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isWideViewport(): boolean {
  return window.matchMedia(WIDE_VIEWPORT).matches;
}

// ─── Inline runs ────────────────────────────────────────────────────────────

function Runs({ runs }: { runs: InlineRun[] }): ReactNode {
  return runs.map((run, i) => <Run key={i} run={run} />);
}

function Run({ run }: { run: InlineRun }): ReactNode {
  switch (run.kind) {
    case "text":
      return run.text;
    case "bold":
      return (
        <strong className="font-bold text-co-text">
          <Runs runs={run.runs} />
        </strong>
      );
    case "italic":
      return (
        <em className="italic">
          <Runs runs={run.runs} />
        </em>
      );
    case "code":
      return (
        <code className="rounded bg-co-surface-inset px-1 py-0.5 font-mono text-[0.9em] text-co-text">
          {run.text}
        </code>
      );
    case "image":
      return <GuideImage src={run.src} alt={run.alt} />;
    case "link": {
      const classes =
        "font-bold text-co-gold-text underline underline-offset-2 transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60";
      // An in-document anchor is a jump, not a navigation — a plain <a> is the
      // correct element and next/link would be wrong.
      if (run.href.startsWith("#")) {
        return (
          <a href={run.href} className={classes}>
            <Runs runs={run.runs} />
          </a>
        );
      }
      if (run.href.startsWith("/")) {
        return (
          <Link href={run.href} className={classes}>
            <Runs runs={run.runs} />
          </Link>
        );
      }
      return (
        <a href={run.href} target="_blank" rel="noreferrer" className={classes}>
          <Runs runs={run.runs} />
        </a>
      );
    }
  }
}

function GuideImage({ src, alt }: { src: string; alt: string }) {
  // next/image would want a loader and a known intrinsic size for a route that
  // streams bytes from docs/; these are documentation screenshots inside a
  // reading column, so the plain element with max-w-full is the honest answer.
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="my-3 block h-auto w-full max-w-full rounded-xl border border-co-border bg-co-surface"
    />
  );
}

// ─── Blocks ─────────────────────────────────────────────────────────────────

function ListItems({ items }: { items: GuideListItem[] }) {
  return (
    <ul className="my-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-co-text-muted">
      {items.map((item, i) => (
        <li key={i}>
          <Runs runs={item.runs} />
          {item.children.length > 0 && <ListItems items={item.children} />}
        </li>
      ))}
    </ul>
  );
}

const HEADING_CLASSES: Record<number, string> = {
  1: "mt-2 mb-3 text-xl font-bold text-co-text",
  2: "mt-8 mb-2 text-base font-bold uppercase tracking-[0.14em] text-co-text",
  3: "mt-6 mb-2 text-sm font-bold text-co-text",
};

function Heading({ block, labels }: { block: Extract<GuideBlock, { kind: "heading" }>; labels: GuideReaderLabels }) {
  // The guide's own `#` is the page's second-level heading (the page owns the
  // h1), so every level shifts down one and anything past `###` lands on h5.
  const tag = (["h2", "h3", "h4", "h5", "h5", "h5"][block.level - 1] ?? "h5") as "h2" | "h3" | "h4" | "h5";
  const Tag = tag;
  return (
    <Tag id={block.id} className={`scroll-mt-4 ${HEADING_CLASSES[block.level] ?? HEADING_CLASSES[3]}`}>
      <Runs runs={block.runs} />
      <a
        href={`#${block.id}`}
        aria-label={withSection(labels.sectionLinkAria, block.text)}
        className="ml-1 inline-flex min-h-[44px] items-center px-2 align-middle text-xs font-normal text-co-text-dim transition hover:text-co-gold-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
      >
        <span aria-hidden>#</span>
      </a>
    </Tag>
  );
}

function Block({ block, labels }: { block: GuideBlock; labels: GuideReaderLabels }) {
  switch (block.kind) {
    case "heading":
      return <Heading block={block} labels={labels} />;
    case "paragraph":
      return (
        <p className="my-2 text-sm leading-relaxed text-co-text-muted">
          <Runs runs={block.runs} />
        </p>
      );
    case "list":
      return <ListItems items={block.items} />;
    case "image":
      return <GuideImage src={block.src} alt={block.alt} />;
    case "rule":
      return <hr className="my-6 border-0 border-t border-co-border" />;
    case "table":
      return (
        // Wide content scrolls inside its own container — the page body never does.
        <div className="my-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-xs">
            <thead>
              <tr>
                {block.head.map((cell, i) => (
                  <th
                    key={i}
                    className="border-b border-co-border px-2 py-2 align-top font-bold uppercase tracking-wide text-co-text-muted"
                  >
                    <Runs runs={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-co-border/50 px-2 py-2 align-top text-co-text-muted">
                      <Runs runs={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// ─── The reader ─────────────────────────────────────────────────────────────

export function GuideReader({
  title,
  description,
  spanishNote,
  labels,
  guides,
  initialGuide,
}: {
  title: string;
  description: string;
  /** One calm line when the reader's language is Spanish; null otherwise. */
  spanishNote: string | null;
  labels: GuideReaderLabels;
  guides: GuideTab[];
  initialGuide: GuideSlug;
}) {
  const [active, setActive] = useState<GuideSlug>(initialGuide);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Contents opens itself where there is room for it (D8: the collapsed state IS
  // the phone design; desktop gets the denser, more-open summary). The viewport
  // is an EXTERNAL store, so it is read through useSyncExternalStore rather than
  // pushed into state from an effect — that keeps the server snapshot (closed)
  // and the hydrated client render in agreement with no cascading render. A
  // manual toggle overrides the width from then on; per-session useState only (D9).
  const isWide = useSyncExternalStore(subscribeToWideViewport, isWideViewport, () => false);
  const [contentsOverride, setContentsOverride] = useState<boolean | null>(null);
  const contentsOpen = contentsOverride ?? isWide;

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const current = guides.find((g) => g.slug === active) ?? guides[0];
  if (!current) return null;

  const selectGuide = (slug: GuideSlug) => {
    setActive(slug);
    // Keep the URL naming the open guide WITHOUT a navigation, so a reload or a
    // copied link reopens this tab and the guides' own cross-links land right.
    // The guide is not disclosure state (D9) — it is which document you are
    // reading, the thing a shared link has to carry.
    window.history.replaceState(null, "", `/training?guide=${slug}`);
    window.scrollTo({ top: 0 });
  };

  const tabClasses = (isActive: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-full border-2 px-4 text-sm font-bold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60 ${
      isActive
        ? "border-co-gold-deep bg-co-surface-2 text-co-text"
        : "border-co-border-2 bg-co-surface text-co-text-dim hover:text-co-text"
    }`;

  return (
    <div className="mx-auto w-full max-w-3xl p-3 pb-16">
      <h1 className="m-0 text-base font-bold text-co-text">{title}</h1>
      <p className="mt-1 mb-3 text-xs text-co-text-muted">{description}</p>

      {spanishNote && (
        <p className="mb-3 rounded-xl border border-co-border bg-co-surface-inset px-3 py-2 text-xs font-medium text-co-info">
          {spanishNote}
        </p>
      )}

      {guides.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={labels.tabsAria}>
          {guides.map((guide) => (
            <button
              key={guide.slug}
              type="button"
              role="tab"
              aria-selected={guide.slug === active}
              className={tabClasses(guide.slug === active)}
              onClick={() => selectGuide(guide.slug)}
            >
              {guide.label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-3">
        <CollapsibleSection
          idBase={`guide-contents-${current.slug}`}
          title={labels.contents}
          count={current.contentsCount}
          open={contentsOpen}
          onToggle={() => setContentsOverride(!contentsOpen)}
        >
          <ul className="m-0 list-none space-y-0 p-0">
            {current.doc.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="flex min-h-[44px] items-center text-sm text-co-text-muted transition hover:text-co-text focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
                >
                  {section.text}
                </a>
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      </div>

      <article className="co-card px-4 py-3">
        {current.doc.blocks.map((block, i) => (
          <Block key={i} block={block} labels={labels} />
        ))}
      </article>

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed right-4 bottom-4 z-30 inline-flex min-h-[44px] items-center rounded-full border-2 border-co-border-2 bg-co-surface px-4 text-xs font-bold uppercase tracking-[0.1em] text-co-text shadow-md transition hover:bg-co-surface-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60"
        >
          {labels.backToTop}
        </button>
      )}
    </div>
  );
}
