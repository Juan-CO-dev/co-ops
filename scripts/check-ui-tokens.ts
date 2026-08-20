/**
 * check-ui-tokens — the token-floor guard.
 *
 * Two checks over every .tsx under components/ and app/:
 *
 * (a) PHANTOM COLOR UTILITIES. Tailwind v4 is CSS-first: a `co-*` color utility
 *     exists only if app/globals.css declares BOTH halves — the raw var in
 *     `:root` AND a `--color-<name>` mapping inside `@theme inline`. Write
 *     `border-co-card-border` with no `--color-co-card-border` mapping and
 *     Tailwind emits NOTHING: no error, no warning, no class. The element falls
 *     back to the browser default, which for a border is ink black. That is not
 *     hypothetical — it shipped to production on 19 edges across the catering
 *     pipeline and customers surfaces and rendered as black boxes until the
 *     2026-08-19 token floor. A silent no-op needs a loud checker.
 *
 *     Only `co-*` and `role-*` tokens are checked. Stock Tailwind palette
 *     classes (`text-red-500`) are out of scope — they always resolve.
 *
 * (b) RAW HEX IN CLASSES. Arbitrary-value color utilities (`bg-[#f1ede0]`) route
 *     around the token layer, so a palette change misses them. Six pre-existing
 *     sites are allowlisted below with their reasons; they are debt for the
 *     restyle sweep, not approved patterns. Do not extend the allowlist to make
 *     a new finding go away — add a token instead.
 *
 * MANUAL run only — deliberately NOT wired into CI, pre-gate.sh, or
 * phase2-discipline-check.sh. The token floor is one PR of a multi-PR UX arc;
 * gating the arc's own in-progress surfaces on it would block the work that
 * fixes them. Wire it up once the restyle sweep lands and the tree is clean.
 *
 * Exit 1 on any finding, 0 when clean. Run:
 *   npx tsx scripts/check-ui-tokens.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Derived from the script path rather than import.meta.dirname: tsx transforms
// this to CJS, where import.meta.dirname is undefined. process.argv[1] is the
// script in both module modes, so this resolves whatever the cwd is.
const REPO_ROOT = resolve(dirname(process.argv[1] ?? "."), "..");
const GLOBALS_CSS = join(REPO_ROOT, "app", "globals.css");
const SCAN_DIRS = ["components", "app"];

/**
 * Raw hex values that predate the token floor. Each is a real site the restyle
 * sweep should tokenize; they are listed so this check can be red-on-new without
 * being red-on-arrival.
 *
 *   #E0A800  app/order/page.tsx            — 5-star glyph, public storefront reviews
 *   #c47d12  ProfileDirectory.tsx          — MVP star
 *   #f1ede0  PersonDetail / TeamRosterCard / TeamRosterTable — role-chip background
 *   #FFD0D0  OpeningPrepEntry.tsx          — hover tint on the under-par toggle
 */
const HEX_ALLOWLIST = new Set(["#e0a800", "#c47d12", "#f1ede0", "#ffd0d0"]);

/** Tailwind utility prefixes that take a color token. */
const COLOR_PREFIXES = [
  "bg", "text", "border", "ring", "fill", "stroke", "from", "via", "to",
  "decoration", "outline", "accent", "caret", "divide", "placeholder", "shadow",
];

const TOKEN_CLASS_RE = new RegExp(
  // optional variant chain (hover:, focus-visible:, sm:, dark:, …) is handled by
  // the leading boundary; capture the token name after the utility prefix.
  String.raw`\b(?:${COLOR_PREFIXES.join("|")})-((?:co|role)-[a-z0-9]+(?:-[a-z0-9]+)*)`,
  "g",
);

/** Arbitrary-value color utility carrying a literal hex: bg-[#f1ede0]. */
const HEX_CLASS_RE = new RegExp(
  String.raw`\b(?:${COLOR_PREFIXES.join("|")})-\[(#[0-9A-Fa-f]{3,8})\]`,
  "g",
);

type Finding = { file: string; line: number; message: string };

/** Token names with a `--color-*` mapping inside the `@theme inline` block. */
function loadMappedTokens(css: string): Set<string> {
  const start = css.indexOf("@theme inline");
  if (start === -1) throw new Error("app/globals.css has no `@theme inline` block");

  // Walk braces from the block's opening `{` so a nested rule cannot end it early.
  const open = css.indexOf("{", start);
  if (open === -1) throw new Error("`@theme inline` block is not opened");
  let depth = 0;
  let end = -1;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("`@theme inline` block is not closed");

  const tokens = new Set<string>();
  for (const m of css.slice(open, end).matchAll(/--color-([a-z0-9-]+)\s*:/g)) {
    if (m[1]) tokens.add(m[1]);
  }
  return tokens;
}

function collectTsx(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // directory absent — nothing to scan
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
}

function scanFile(file: string, mapped: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  lines.forEach((text, idx) => {
    for (const m of text.matchAll(TOKEN_CLASS_RE)) {
      const token = m[1];
      if (!token || mapped.has(token)) continue;
      findings.push({
        file: rel,
        line: idx + 1,
        message: `phantom utility \`${m[0]}\` — no \`--color-${token}\` in the @theme inline block, so this class emits nothing`,
      });
    }
    for (const m of text.matchAll(HEX_CLASS_RE)) {
      const hex = m[1];
      if (!hex || HEX_ALLOWLIST.has(hex.toLowerCase())) continue;
      findings.push({
        file: rel,
        line: idx + 1,
        message: `raw hex \`${m[0]}\` in a class — add a token in app/globals.css instead`,
      });
    }
  });

  return findings;
}

function main(): void {
  const mapped = loadMappedTokens(readFileSync(GLOBALS_CSS, "utf8"));

  const files: string[] = [];
  for (const dir of SCAN_DIRS) collectTsx(join(REPO_ROOT, dir), files);
  files.sort();

  const findings = files.flatMap((f) => scanFile(f, mapped));

  for (const f of findings) console.error(`${f.file}:${f.line}  ${f.message}`);

  const scanned = `${files.length} .tsx files, ${mapped.size} mapped color tokens`;
  if (findings.length > 0) {
    console.error(`\ncheck-ui-tokens: ${findings.length} finding(s) across ${scanned}`);
    process.exit(1);
  }
  console.log(`check-ui-tokens: clean — ${scanned}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
