/**
 * Nav PR 3, commit 1: the legacy snapshot (plan r5, section 3).
 *
 * Generated at the PR's base (main after nav PR 2) BEFORE any refactor, and never regenerated in the PR. It pins,
 * as one string, every output today's three registries produce: NAV_LINKS and navDestinationsFor (the Dashboard
 * "Explore" chips), matchPages (unified search's page hits, in en and es), ADMIN_SECTIONS and adminSectionsFor (the
 * Back office cards) and the catering hub's EDITORS. The later commits derive those registries from the one
 * destination list (lib/nav/destinations.ts); the fixture must stay byte-identical through all of them.
 *
 * Serialization keeps `undefined` visible ("__undefined__"), so property order, an omitted key versus an undefined
 * key, and array order all count.
 *
 * Write mode (only at the base, to regenerate for verification): NAV_SNAPSHOT_WRITE=1 with CI unset writes the
 * fixture (to NAV_SNAPSHOT_OUT when set), recording `git rev-parse HEAD` as the base. Otherwise the test compares,
 * and a missing fixture fails.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, adminSectionsFor } from "@/lib/admin/sections";
import { serverT } from "@/lib/i18n/server";
import type { Language, TranslationKey } from "@/lib/i18n/types";
import { NAV_LINKS, navDestinationsFor } from "@/lib/nav-links";
import { CATERING_EDITORS } from "@/lib/nav/legacy";
import { ROLES, type RoleCode } from "@/lib/roles";
import { matchPages } from "@/lib/unified-search";

const FIXTURE = "tests/fixtures/nav-legacy-snapshot.json";
const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ROLE_CODES = Object.keys(ROLES) as RoleCode[];
const LANGS: Language[] = ["en", "es"];

type Editor = { id: string; i18nKey: TranslationKey; href: string; minLevel: number };

/** The catering hub's EDITORS. Commit 1 read the literal from the page source; since the editors derive
 *  (commit 6) the page uses CATERING_EDITORS, which is what this reads. The fixture is unchanged. */
function cateringEditors(): Editor[] {
  return CATERING_EDITORS;
}

const NAV_OPTS: { name: string; opts: { vault?: boolean; pulseV2?: boolean } | undefined }[] = [
  { name: "omitted", opts: undefined },
  { name: "{}", opts: {} },
  { name: "{vault:true}", opts: { vault: true } },
  { name: "{vault:false}", opts: { vault: false } },
  { name: "{pulseV2:true}", opts: { pulseV2: true } },
  { name: "{pulseV2:false}", opts: { pulseV2: false } },
  { name: "{vault:true,pulseV2:true}", opts: { vault: true, pulseV2: true } },
];

/** Every distinct 3-letter run (and the whole label) of every label navDestinationsFor can emit, per language, plus one
 *  query that matches nothing. */
function searchQueries(lang: Language): string[] {
  const keys = new Set<TranslationKey>();
  for (const level of LEVELS) for (const { opts } of NAV_OPTS) for (const l of navDestinationsFor(level, opts)) keys.add(l.key);
  const out = new Set<string>(["zzq"]);
  for (const key of keys) {
    const label = serverT(lang, key).toLowerCase();
    out.add(label);
    for (let i = 0; i + 3 <= label.length; i++) out.add(label.slice(i, i + 3));
  }
  return [...out].sort();
}

function computeSnapshot() {
  const navDestinations: Record<string, unknown> = {};
  for (const level of LEVELS) for (const { name, opts } of NAV_OPTS) navDestinations[`${level} ${name}`] = navDestinationsFor(level, opts);

  const search: Record<string, unknown> = {};
  for (const lang of LANGS) {
    const t = (key: TranslationKey) => serverT(lang, key);
    for (const q of searchQueries(lang)) {
      for (const level of LEVELS) {
        for (const pulseV2 of [false, true]) search[`${lang} ${level} pulseV2=${pulseV2} "${q}"`] = matchPages(level, q, t, { pulseV2 });
      }
    }
  }

  const adminFor: Record<string, unknown> = {};
  for (const level of LEVELS) for (const role of ROLE_CODES) adminFor[`${level} ${role}`] = adminSectionsFor(level, role);

  const editors = cateringEditors();
  const editorsFor: Record<string, unknown> = {};
  for (const level of LEVELS) editorsFor[`${level}`] = editors.filter((e) => level >= e.minLevel);

  return {
    NAV_LINKS,
    navDestinationsFor: navDestinations,
    matchPages: search,
    ADMIN_SECTIONS,
    adminSectionsFor: adminFor,
    EDITORS: editors,
    EDITORS_byLevel: editorsFor,
  };
}

const serialize = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (v === undefined ? "__undefined__" : v), 2) + "\n";

describe("nav legacy snapshot (frozen at the PR's base)", () => {
  it("today's registries produce exactly the frozen outputs", () => {
    const computed = computeSnapshot();
    if (process.env.NAV_SNAPSHOT_WRITE === "1" && !process.env.CI) {
      const base = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      writeFileSync(process.env.NAV_SNAPSHOT_OUT ?? FIXTURE, serialize({ base, ...computed }));
      return;
    }
    expect(existsSync(FIXTURE), `${FIXTURE} is missing`).toBe(true);
    const frozen = readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n");
    const base = (JSON.parse(frozen) as { base: string }).base;
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    const actual = serialize({ base, ...computed });
    // One string comparison (property order, omitted vs undefined, array order). On a mismatch, locate it by section.
    if (actual !== frozen) {
      const want = JSON.parse(frozen) as Record<string, unknown>;
      const got = JSON.parse(actual) as Record<string, unknown>;
      for (const k of Object.keys(got)) expect(serialize(got[k]), `section ${k}`).toBe(serialize(want[k]));
    }
    expect(actual === frozen).toBe(true);
  });

  it("the matrix is the size the plan names", () => {
    const s = computeSnapshot();
    expect(Object.keys(s.navDestinationsFor)).toHaveLength(77);
    expect(Object.keys(s.adminSectionsFor)).toHaveLength(165);
    expect(Object.keys(s.EDITORS_byLevel)).toHaveLength(11);
    expect(s.EDITORS).toHaveLength(11);
    expect(Object.keys(s.matchPages).length).toBeGreaterThan(1000);
  });
});
