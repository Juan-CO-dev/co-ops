/**
 * Unit spine — lib/location-sku-shared.ts pure math (zero I/O, no server imports).
 * Covers overlay resolution for per-location par + active overrides (D1, migration 0174).
 *
 * Semantics (from spec §2.1 + lib/ordering.ts parForDay):
 *   resolvePar: resolve each field through the overlay (overlay.field ?? global.field),
 *   THEN apply the weekend-par day rule exactly as parForDay does:
 *     weekend && resolvedWeekendPar != null → resolvedWeekendPar, else resolvedWeekdayPar.
 *   resolveActive: overlayActive ?? globalActive.
 */
import { describe, it, expect } from "vitest";
import { resolvePar, resolveActive } from "../lib/location-sku-shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const global = (weekdayPar: number | null, weekendPar: number | null) => ({
  weekdayPar,
  weekendPar,
});

const overlay = (weekdayPar: number | null, weekendPar: number | null) => ({
  weekdayPar,
  weekendPar,
});

// ── resolvePar: no overlay (null) — today's behavior byte-identical ───────────

describe("resolvePar — no overlay (null)", () => {
  it("weekday walk: returns global weekdayPar", () => {
    expect(resolvePar(null, global(3, 5), false)).toBe(3);
  });

  it("weekend walk + weekendPar set: returns global weekendPar", () => {
    expect(resolvePar(null, global(3, 5), true)).toBe(5);
  });

  it("weekend walk + weekendPar null: falls back to global weekdayPar (the weekday-fallback rule)", () => {
    // weekend=true but no weekendPar → weekdayPar is the applicable par
    expect(resolvePar(null, global(3, null), true)).toBe(3);
  });

  it("neither par set: returns null (SKU excluded from walk)", () => {
    expect(resolvePar(null, global(null, null), false)).toBeNull();
  });

  it("neither par set on a weekend walk: returns null", () => {
    expect(resolvePar(null, global(null, null), true)).toBeNull();
  });

  it("only weekendPar set, weekday walk: returns null (weekendPar does not apply on weekdays)", () => {
    // weekend=false, weekendPar=5, weekdayPar=null → parForDay returns weekdayPar=null
    expect(resolvePar(null, global(null, 5), false)).toBeNull();
  });
});

// ── resolvePar: overlay overrides one field only ──────────────────────────────

describe("resolvePar — overlay overrides weekdayPar only", () => {
  it("weekday walk: overlay weekdayPar wins over global weekdayPar", () => {
    // overlay.weekdayPar = 7, global.weekdayPar = 3 → 7
    expect(resolvePar(overlay(7, null), global(3, 5), false)).toBe(7);
  });

  it("weekend walk: overlay weekdayPar does not affect weekendPar selection", () => {
    // weekend walk: resolved weekendPar = global.weekendPar = 5 (overlay has null)
    // weekend=true && resolvedWeekendPar(5) != null → 5
    expect(resolvePar(overlay(7, null), global(3, 5), true)).toBe(5);
  });

  it("weekend walk + overlay weekdayPar only, global weekendPar null: falls back to overlay weekdayPar", () => {
    // resolvedWeekendPar = null (both overlay and global null) → fall back to resolvedWeekdayPar = 7
    expect(resolvePar(overlay(7, null), global(3, null), true)).toBe(7);
  });
});

describe("resolvePar — overlay overrides weekendPar only", () => {
  it("weekend walk: overlay weekendPar wins over global weekendPar", () => {
    // overlay.weekendPar = 10, global.weekendPar = 5 → 10
    expect(resolvePar(overlay(null, 10), global(3, 5), true)).toBe(10);
  });

  it("weekday walk: overlay weekendPar has no effect (weekday rule applies)", () => {
    // weekday walk → resolvedWeekdayPar = global.weekdayPar = 3 (overlay.weekdayPar null)
    expect(resolvePar(overlay(null, 10), global(3, 5), false)).toBe(3);
  });

  it("weekday walk, global weekdayPar null, overlay weekdayPar null: returns null", () => {
    expect(resolvePar(overlay(null, 10), global(null, 5), false)).toBeNull();
  });
});

// ── resolvePar: overlay overrides both fields ─────────────────────────────────

describe("resolvePar — overlay overrides both fields", () => {
  it("weekday walk: overlay weekdayPar wins", () => {
    expect(resolvePar(overlay(8, 12), global(3, 5), false)).toBe(8);
  });

  it("weekend walk: overlay weekendPar wins", () => {
    expect(resolvePar(overlay(8, 12), global(3, 5), true)).toBe(12);
  });
});

// ── resolvePar: overlay weekend override with global weekday fallback ─────────

describe("resolvePar — overlay weekend par + global weekday fallback", () => {
  it("overlay sets weekendPar, no weekdayPar anywhere: weekend walk returns overlay weekendPar", () => {
    // resolvedWeekendPar = 9 (overlay), resolvedWeekdayPar = null (both null)
    expect(resolvePar(overlay(null, 9), global(null, null), true)).toBe(9);
  });

  it("overlay sets weekendPar; weekend walk returns overlay weekendPar, not global weekdayPar", () => {
    // resolvedWeekendPar = 9, resolvedWeekdayPar = 3 (global); weekend → 9
    expect(resolvePar(overlay(null, 9), global(3, null), true)).toBe(9);
  });

  it("overlay sets weekendPar; weekday walk falls back to resolvedWeekdayPar (global)", () => {
    // weekday walk → resolvedWeekdayPar = 3 (from global, overlay.weekdayPar=null)
    expect(resolvePar(overlay(null, 9), global(3, null), false)).toBe(3);
  });
});

// ── resolvePar: null-par result when neither layer has the day's value ─────────

describe("resolvePar — null-par result", () => {
  it("overlay weekdayPar null, global weekdayPar null, weekday walk → null", () => {
    expect(resolvePar(overlay(null, 5), global(null, null), false)).toBeNull();
  });

  it("overlay weekendPar null, global weekendPar null, weekend walk → falls back to resolvedWeekdayPar", () => {
    // resolvedWeekendPar = null → fall back to resolvedWeekdayPar = 4
    expect(resolvePar(overlay(null, null), global(4, null), true)).toBe(4);
  });

  it("all four par slots null, any walk day → null (SKU excluded from walk)", () => {
    expect(resolvePar(overlay(null, null), global(null, null), false)).toBeNull();
    expect(resolvePar(overlay(null, null), global(null, null), true)).toBeNull();
  });
});

// ── resolveActive ──────────────────────────────────────────────────────────────

describe("resolveActive — no overlay (null/undefined)", () => {
  it("null overlayActive: inherits globalActive = true", () => {
    expect(resolveActive(null, true)).toBe(true);
  });

  it("null overlayActive: inherits globalActive = false", () => {
    expect(resolveActive(null, false)).toBe(false);
  });

  it("undefined overlayActive: inherits globalActive = true", () => {
    expect(resolveActive(undefined, true)).toBe(true);
  });

  it("undefined overlayActive: inherits globalActive = false", () => {
    expect(resolveActive(undefined, false)).toBe(false);
  });
});

describe("resolveActive — explicit deactivation (overlay false)", () => {
  it("false deactivates even when globalActive = true", () => {
    expect(resolveActive(false, true)).toBe(false);
  });

  it("false deactivates when globalActive = false", () => {
    expect(resolveActive(false, false)).toBe(false);
  });
});

describe("resolveActive — promotional true-override", () => {
  it("true activates even when globalActive = false (promotional / location-specific)", () => {
    expect(resolveActive(true, false)).toBe(true);
  });

  it("true with globalActive = true: stays true", () => {
    expect(resolveActive(true, true)).toBe(true);
  });
});
