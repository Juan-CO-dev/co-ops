/**
 * Unit spine — batch vs bottle PHASE B surfaces (source pins + i18n parity).
 *
 *   · every yield.* / trends yield key the surfaces name exists in en AND es, with the same
 *     {placeholders} on both sides (translate-from-day-one);
 *   · the page refuses below level 5 and binds the shop like /operations/production;
 *   · the action buttons render only when view.canAct (GM 7, computed in the lib); a shift lead
 *     gets the hint instead, and a maker's retrain item never offers Update recipe yield;
 *   · Update recipe yield posts to /api/admin/… (so the Tier-B unlock survives) and handles the
 *     step-up loop; Retrain posts to the operations route.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { parentFor } from "@/lib/nav-parents";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

const component = read("components", "production", "YieldVariance.tsx");
const page = read("app", "(authed)", "operations", "production", "yield", "page.tsx");
const trendsPage = read("app", "(authed)", "reports", "trends", "page.tsx");
const landing = read("components", "team", "TrendsLanding.tsx");

function keysIn(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/["'`]((?:yield|reports\.trends\.yield|reports\.trends\.landing\.yield)[a-z_.]*)["'`]/g)) {
    const k = m[1]!;
    if (k.endsWith(".")) continue; // a prefix built at runtime ("yield.error." + code)
    if (k.includes(".")) out.add(k);
  }
  return [...out];
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n — every Phase B key in en + es with matching placeholders", () => {
  const keys = [...new Set([...keysIn(component), ...keysIn(page), ...keysIn(trendsPage), ...keysIn(landing),
    "yield.direction.under", "yield.direction.over", "yield.direction.on_card",
    ...["no_active_nudge", "forbidden", "invalid_yield", "not_batch_recipe", "invalid_note", "generic"].map((c) => `yield.error.${c}`)])];
  it("found the surface's keys (the scanner works)", () => {
    expect(keys.length).toBeGreaterThan(25);
  });
  it.each(keys)("%s", (k) => {
    expect(EN[k], `${k} en`).toBeTruthy();
    expect(ES[k], `${k} es`).toBeTruthy();
    expect(placeholders(ES[k]!)).toEqual(placeholders(EN[k]!));
  });
  it("Spanish is not a copy of English", () => {
    for (const k of keys) if (!/^\{/.test(EN[k]!)) expect(ES[k], k).not.toBe(EN[k]);
  });
});

describe("page — level 5+, shop-bound", () => {
  it("redirects below YIELD_STATS_READ_MIN and when the shop is not the actor's", () => {
    expect(page).toMatch(/if \(auth\.level < YIELD_STATS_READ_MIN\) redirect\("\/dashboard"\);/);
    expect(page).toMatch(/if \(!lockLocationContext\(locActor, location\)\) redirect\("\/dashboard"\);/);
    expect(page).toMatch(/loadYieldVariance\(auth, location\)/);
  });
  it("back goes to the production page", () => {
    expect(parentFor("/operations/production/yield").href).toBe("/operations/production");
  });
});

describe("component — GM-only actions", () => {
  it("renders NudgeActions only under view.canAct, the hint otherwise", () => {
    const blocks = component.split("{view.canAct ? (");
    expect(blocks.length).toBe(3); // the recipe nudge and the maker item
    expect(component).toMatch(/t\("yield\.nudge\.gm_only"\)/);
  });
  it("a maker's retrain item never offers Update recipe yield", () => {
    expect(component).toMatch(/scope="maker" makerId=\{maker\.makerId\}\s+updatable=\{false\}/);
    expect(component).toMatch(/scope === "recipe" && updatable \?/);
  });
  it("Update posts to /api/admin (step-up survives) and loops through PasswordModal on step_up_required/stale", () => {
    expect(component).toContain('fetch("/api/admin/recipes/yield-nudge"');
    expect(component).toMatch(/j\?\.code === "step_up_required" \|\| j\?\.code === "step_up_stale"/);
    expect(component).toContain("<PasswordModal");
  });
  it("Retrain posts to the operations route", () => {
    expect(component).toContain('fetch("/api/operations/production/yield/retrain"');
  });
});

describe("trends landing — the nudges join the attention strip, fail-soft", () => {
  it("gates on level 5 + the operational bind and never lets a yield failure take the hub down", () => {
    expect(trendsPage).toMatch(/auth\.level >= YIELD_STATS_READ_MIN && lockLocationContext\(locActor, locationParam\)/);
    expect(trendsPage).toMatch(/loadYieldVariance\(auth, locationParam\)\.catch\(/);
    expect(landing).toMatch(/item\.kind === "yield" \? yieldHref/);
  });
});
