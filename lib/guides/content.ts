/**
 * content — the server side of the guides: read the Markdown, parse it once,
 * keep the tree.
 *
 * `server-only` (AGENTS.md "Module boundaries"): this module touches the
 * filesystem, so a client-component import path fails the build instead of
 * leaking `node:fs` into a bundle. The PURE half lives in markdown-shared.ts,
 * which the client component imports directly.
 *
 * LITERAL PATHS, DELIBERATELY. Vercel's build traces `fs` reads statically; a
 * path assembled from a variable traces to nothing and the .md files are absent
 * from the serverless bundle at runtime. So the filename comes from a literal
 * record keyed by the slug union, the path is built from literal segments, and
 * next.config.ts names `docs/guides/**` in `outputFileTracingIncludes` for both
 * the page and the image route — belt AND braces, because the failure mode is
 * invisible locally and total in production.
 *
 * CACHED FOR THE PROCESS LIFETIME. The guides are repo files: they cannot change
 * between deploys, so one parse per guide per server instance is correct — not a
 * staleness risk. Cache by language because each guide gets a translated launch section.
 */

import "server-only";

import fs from "node:fs";
import path from "node:path";

import { parseGuideMarkdown, type GuideDoc, type GuideSlug } from "./markdown-shared";
import type { Language } from "@/lib/i18n/types";

/** Literal filenames — see the path note in the module header. */
const GUIDE_FILES: Record<GuideSlug, string> = {
  staff: "staff-guide.md",
  manager: "manager-guide.md",
  catering: "catering-guide.md",
};

const parsed = new Map<string, GuideDoc>();

const LAUNCH_FILES: Record<Language, Record<GuideSlug, string>> = {
  en: { staff: "launch-staff.en.md", manager: "launch-manager.en.md", catering: "launch-catering.en.md" },
  es: { staff: "launch-staff.es.md", manager: "launch-manager.es.md", catering: "launch-catering.es.md" },
};

export function loadGuide(slug: GuideSlug, language: Language): GuideDoc {
  const key = `${language}:${slug}`;
  const cached = parsed.get(key);
  if (cached) return cached;

  const base = fs.readFileSync(
    path.join(process.cwd(), "docs", "guides", GUIDE_FILES[slug]),
    "utf8",
  );
  const launch = fs.readFileSync(
    path.join(process.cwd(), "docs", "guides", LAUNCH_FILES[language][slug]),
    "utf8",
  );
  const doc = parseGuideMarkdown(`${base}\n\n---\n\n${launch}`, slug);
  parsed.set(key, doc);
  return doc;
}

/**
 * Absolute path of one guide screenshot.
 *
 * Callers MUST have validated `slug` against the union and `file` against
 * GUIDE_IMAGE_FILE before calling — this function does no validation of its own,
 * which is exactly why the route does both checks before it gets here.
 */
export function guideImagePath(slug: GuideSlug, file: string): string {
  return path.join(process.cwd(), "docs", "guides", "img", slug, file);
}

/**
 * The only filenames the image route will serve.
 *
 * Two digits, an OPTIONAL single letter (five manager screenshots are inserts:
 * 32b, 32c, 32d, 58b, 58c), a lowercase-and-hyphen slug, `.png`. No dots, no
 * slashes, no uppercase — so no traversal sequence and no sibling directory can
 * be spelled, before any path is built.
 */
export const GUIDE_IMAGE_FILE = /^[0-9]{2}[a-z]?-[a-z0-9-]+\.png$/;
