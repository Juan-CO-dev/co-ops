/**
 * The Back office hub's components sit outside the page-gate census (only `app/admin/page.tsx` is read, and the reader
 * enters no component but PulseHome). That is sound only while they hold NO gate and NO loader: the page decides who
 * gets there and what is loaded; the hub only renders what it is handed (Astra PR 4 r1 note). Pin it at the source.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "components/admin/back-office");
const FILES = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));

const FORBIDDEN_IMPORTS = [
  /from\s+["']next\/navigation["']/,
  /from\s+["']next\/headers["']/,
  /from\s+["']@\/lib\/session["']/,
  /from\s+["']@\/lib\/supabase[^"']*["']/,
  /from\s+["']@\/lib\/auth[^"']*["']/,
  /from\s+["']@\/lib\/locations["']/,
];
const FORBIDDEN_CALLS = [/\bredirect\s*\(/, /\bnotFound\s*\(/, /\bforbidden\s*\(/, /\bunauthorized\s*\(/, /\brequireSession/, /\bfetch\s*\(/];

describe("the Back office hub components hold no gate and no loader", () => {
  it("there are hub component files to check", () => {
    expect(FILES.length).toBeGreaterThan(0);
  });
  for (const f of FILES) {
    it(`${f}: no navigation exit, session, auth, location or database import, and no fetch`, () => {
      const src = readFileSync(join(DIR, f), "utf8");
      for (const re of FORBIDDEN_IMPORTS) expect(src, `${f} imports ${re}`).not.toMatch(re);
      for (const re of FORBIDDEN_CALLS) expect(src, `${f} calls ${re}`).not.toMatch(re);
    });
  }
});
