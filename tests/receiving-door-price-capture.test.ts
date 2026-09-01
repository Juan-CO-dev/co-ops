/**
 * Unit spine — PRICE CAPTURE ON THE ORDINARY INTAKE PATH (2026-08-31).
 *
 * The wire was never broken. A non-null `unitPrice` on a delivery line is the ONE
 * trigger that inserts into `vendor_price_history` (lib/receiving.ts:522 recordDelivery,
 * :1150 addDeliveryLines), and it fired in production exactly once — the Banana Peppers
 * $20 row, written 97 ms before its own `delivery.received` audit row
 * (docs/seed/source/angel-wave6-dryrun.md § E.3). What was broken was the AFFORDANCE:
 * the price input rendered on EXPANDED rows only, while the door ceremony seeds every
 * templated line COLLAPSED. One line in the history of the app carries a price.
 *
 * So there is no new arithmetic to pin here — the value of this change lives in a
 * rendering condition and in two honesty notices. Two things are therefore assertable:
 *   1. The PURE rules the strip reads (lib/receiving-shared.ts) — the client's reading of
 *      a raw price string, and what the row must SAY about it. These mirror the server's
 *      own refusal (validateAndResolveDeliveryLines: finite AND > 0), and a drift between
 *      the two is a 400 at 6 AM with the truck idling.
 *   2. The SOURCE shape of the two components — the same posture
 *      tests/ui-control-floor-primitives.test.ts takes when the guarantee lives in a
 *      class string rather than a return value (the spine is node-environment, no DOM).
 *      What it protects: that the collapsed strip exists at all, that the EXPANDED path
 *      was not disturbed while adding it, and that the 44px floor + aria contract came
 *      with it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import {
  collapsedPriceNotice,
  priceEntryState,
  pricedLineCount,
} from "@/lib/receiving-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("priceEntryState — the client's reading of a raw price string", () => {
  it("treats blank and whitespace-only as EMPTY, never as an error", () => {
    // Pricing a line is optional at the door; a blank box is the ordinary state and the
    // ceremony must never grow a red mark for it.
    expect(priceEntryState("")).toBe("empty");
    expect(priceEntryState("   ")).toBe("empty");
  });

  it("accepts a positive number, trimmed", () => {
    expect(priceEntryState("12.5")).toBe("ok");
    expect(priceEntryState(" 12 ")).toBe("ok");
    expect(priceEntryState("0.01")).toBe("ok");
  });

  it("REFUSES zero — the same rule the server enforces, not `>= 0`", () => {
    // lib/receiving.ts:712 throws 400 invalid_price on `unitPrice <= 0`. A $0 row would
    // land in vendor_price_history as a real observation and then flow back out through
    // lib/purchase-orders.ts's price_cents_at_order as the vendor's price.
    expect(priceEntryState("0")).toBe("invalid");
    expect(priceEntryState("0.00")).toBe("invalid");
  });

  it("refuses negatives and anything non-numeric", () => {
    expect(priceEntryState("-1")).toBe("invalid");
    expect(priceEntryState("abc")).toBe("invalid");
    expect(priceEntryState("12,50")).toBe("invalid"); // a comma decimal is NaN, not 12.5
  });
});

describe("collapsedPriceNotice — the two things the row may not leave silent", () => {
  it("says nothing on the two ordinary states", () => {
    expect(collapsedPriceNotice("", false)).toBe(null);
    expect(collapsedPriceNotice("", true)).toBe(null);
    expect(collapsedPriceNotice("12.5", true)).toBe(null);
  });

  it("names a price the submit will silently drop for want of a count", () => {
    // readyLines requires qty > 0. Without this notice the operator types a number,
    // watches it disappear on submit, and has no way to learn why.
    expect(collapsedPriceNotice("12.5", false)).toBe("not_counted");
  });

  it("names a value the server will refuse, before the round trip", () => {
    expect(collapsedPriceNotice("0", true)).toBe("invalid");
    expect(collapsedPriceNotice("abc", true)).toBe("invalid");
  });

  it("ranks invalid ABOVE not_counted — the fixable errand wins", () => {
    // A malformed value is wrong whatever the qty is, and clearing it is the action the
    // operator can take right now; "count it first" is advice about a different field.
    expect(collapsedPriceNotice("0", false)).toBe("invalid");
  });
});

describe("pricedLineCount — the aggregate that survives the strip being hidden", () => {
  it("counts only prices the server would accept", () => {
    expect(
      pricedLineCount([
        { unitPrice: "12.5" },
        { unitPrice: "" },
        { unitPrice: "0" },
        { unitPrice: "abc" },
        { unitPrice: " 3 " },
      ]),
    ).toBe(2);
  });

  it("is 0 for an untouched intake", () => {
    expect(pricedLineCount([{ unitPrice: "" }, { unitPrice: "" }])).toBe(0);
  });
});

describe("IntakeLineRow — the collapsed row now carries the price box", () => {
  const src = read("components", "receiving", "IntakeLineRow.tsx");

  it("gates the collapsed strip on the parent's switch, defaulted OFF", () => {
    // An omitted prop must never change an existing caller's rendering.
    expect(src).toContain("showPrice = false");
    expect(src).toContain("showPrice?: boolean");
    expect(src).toContain("{showPrice ? (");
  });

  it("binds the collapsed input to the SAME line.unitPrice the expanded one writes", () => {
    // Two boxes, one value — a price typed either way rides the identical payload field.
    const collapsedInput = src.slice(src.indexOf("{showPrice ? ("), src.indexOf("// Expanded editor."));
    expect(collapsedInput).toContain("value={line.unitPrice}");
    expect(collapsedInput).toContain('onChange({ unitPrice: e.target.value })');
  });

  it("keeps the collapsed input at the 44px floor, paired with items-center", () => {
    expect(src).toContain("const priceField =");
    expect(src.slice(src.indexOf("const priceField ="))).toContain("min-h-[44px]");
    // The strip's own row centres its label + control as one unit, and the row is a real
    // <label> so the word itself is part of the tap target.
    expect(src).toContain('<label className="mt-2 flex items-center gap-2">');
  });

  it("separates a refusal from an advisory by voice, not just by wording", () => {
    // `invalid` will 400 the whole delivery — it takes the red TEXT role on a light
    // ground (co-cta-text; co-cta is a fill). `not_counted` keeps the dim hint voice the
    // flag auto-suggest uses one row up.
    const map = src.slice(src.indexOf("const noticeClass"), src.indexOf("/** The flag qty"));
    expect(map).toContain('invalid: "text-co-cta-text"');
    expect(map).toContain('not_counted: "text-co-text-dim"');
  });

  it("spells the price control's padding explicitly rather than layering over px-3", () => {
    // The "$" adornment sits in a left gutter; relying on Tailwind's utility-emission
    // order to make pl-7 beat px-3 is a silent-drift hazard, not a rule.
    const decl = src.slice(src.indexOf("const priceField ="), src.indexOf("const noticeKey"));
    expect(decl).toContain("pl-7 pr-3");
    expect(decl).not.toContain("px-3");
  });

  it("gives every price box a SKU-named accessible label", () => {
    // Eight identical "$" boxes down a list are indistinguishable to a screen reader
    // without the item name in the label.
    expect(src).toContain('aria-label={t("receiving.door.price_aria", { sku: line.skuName })}');
    // The "$" itself is decoration, not content.
    expect(src).toContain('aria-hidden="true"');
  });

  it("leaves the EXPANDED price + observed pair exactly as it was", () => {
    // The expanded row's own inputs use the untouched `field` const and the shared
    // two-column grid; the collapsed strip is an addition beside them, never a move.
    expect(src).toContain('<div className="mt-3 grid grid-cols-2 gap-2">');
    expect(src).toContain('{t("receiving.form.price")}');
    expect(src).toContain('{t("receiving.form.observed")}');
    expect(src).toContain("const field =");
  });
});

describe("ReceivingForm — one switch, remembered, and never hiding a price", () => {
  const src = read("components", "receiving", "ReceivingForm.tsx");

  it("passes the mode down to every row", () => {
    expect(src).toContain("showPrice={priceMode}");
  });

  it("keeps the toggle a real button with the pressed-state aria contract at the floor", () => {
    expect(src).toContain("aria-pressed={priceMode}");
    expect(src).toContain("onClick={togglePriceMode}");
    const toggle = src.slice(src.indexOf("aria-pressed={priceMode}"), src.indexOf('{t("receiving.door.prices_toggle")}'));
    expect(toggle).toContain("min-h-[44px] items-center");
  });

  it("persists the preference on the TAP, not on a render effect", () => {
    // A render-driven write would persist a mode the operator never chose (e.g. one
    // turned on by resuming a priced draft).
    const fn = src.slice(src.indexOf("const togglePriceMode"), src.indexOf("const resetForm"));
    expect(fn).toContain("writePriceMode(locationId, next)");
    expect(src).toContain("coops.intake.prices.");
  });

  it("guards every localStorage touch — private-mode Safari must not break the door", () => {
    const block = src.slice(src.indexOf("function readPriceMode"), src.indexOf("const field ="));
    expect(block).toContain("} catch {");
    expect(block.match(/} catch {/g)?.length).toBe(2); // read + write
  });

  it("does NOT reset the preference on a successful submit", () => {
    // resetForm runs on success; re-hiding the strip would make the manager re-find the
    // switch after every delivery, which is how the field got lost the first time.
    const reset = src.slice(src.indexOf("const resetForm = () =>"), src.indexOf("/** Continue one shelved intake."));
    expect(reset).not.toContain("setPriceMode");
  });

  it("opens the strip when a resumed draft already carries prices", () => {
    const resume = src.slice(src.indexOf("const resumeDraft"), src.indexOf("/** Throw ONE draft away"));
    expect(resume).toContain("if (pricedLineCount(draft.lines) > 0) setPriceMode(true)");
  });

  it("renders the priced tally in BOTH switch states", () => {
    // The tally sits outside the `priceMode ?` branch — it is what makes an entered price
    // impossible to hide.
    const bar = src.slice(src.indexOf('<div className="mb-2.5 flex flex-wrap items-center gap-2">'), src.indexOf("{priceMode ? ("));
    expect(bar).toContain("pricedCount > 0");
    expect(bar).toContain('t("receiving.door.prices_counted", { n: pricedCount })');
  });

  it("still submits the price through the untouched line payload", () => {
    // The wire shape was never the gap; this pins that the change did not re-plumb it.
    expect(src).toContain("unitPrice: num(l.unitPrice)");
  });
});

describe("i18n — en + es in the same PR (AGENTS.md translate-from-day-one)", () => {
  const KEYS = [
    "receiving.door.prices_toggle",
    "receiving.door.prices_help",
    "receiving.door.prices_counted",
    "receiving.door.price_label",
    "receiving.door.price_aria",
    "receiving.door.price_invalid",
    "receiving.door.price_not_counted",
  ] as const;

  const enKeys = en as Record<string, string>;
  const esKeys = es as Record<string, string>;

  it("every new key exists in BOTH locales", () => {
    for (const key of KEYS) {
      expect(enKeys[key], `${key} missing from en.json`).toBeTruthy();
      expect(esKeys[key], `${key} missing from es.json`).toBeTruthy();
    }
  });

  it("the interpolating keys keep their placeholder in both locales", () => {
    // A dropped placeholder renders the label with no value — the one failure mode that
    // survives a translation pass unnoticed.
    expect(enKeys["receiving.door.prices_counted"]).toContain("{n}");
    expect(esKeys["receiving.door.prices_counted"]).toContain("{n}");
    expect(enKeys["receiving.door.price_aria"]).toContain("{sku}");
    expect(esKeys["receiving.door.price_aria"]).toContain("{sku}");
  });

  it("opens the price aria-label with the VISIBLE label text (WCAG label-in-name)", () => {
    // The aria-label overrides the wrapping <label>'s text as the accessible name, so it
    // must still contain what the eye reads — otherwise voice control cannot address the
    // control by the words printed beside it.
    const startsWithLabel = (d: Record<string, string>) =>
      (d["receiving.door.price_aria"] ?? "").startsWith(d["receiving.door.price_label"] ?? " ");
    expect(startsWithLabel(enKeys)).toBe(true);
    expect(startsWithLabel(esKeys)).toBe(true);
  });

  it("the Spanish is actually translated, not the English copied through", () => {
    for (const key of KEYS) expect(esKeys[key]).not.toBe(enKeys[key]);
  });
});
