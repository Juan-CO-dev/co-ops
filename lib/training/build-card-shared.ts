/**
 * build-card-shared — "Learn the build" step data (co-scenes spec §3 + §9).
 *
 * PURE and client-safe: no I/O, no node imports. Three pieces:
 *
 *   1. `parseBuildSheetItem` reads ONE item's block out of the build-sheet CSV
 *      (docs/seed/source/sandwich-build-sheet.csv): the item name in column 0,
 *      its lines in columns 1–3, continuation rows with column 0 empty, the
 *      block ending ONLY at a fully blank row or the end of the file (anything
 *      else is refused, never truncated). Only the LEFT block
 *      (columns 0–3) is read; the sheet's right-hand block is another sandwich.
 *   2. `BUILD_DEFS` — the canonical build ORDER per item, each ingredient step
 *      BOUND to a card line by its verbatim sheet name, plus the en/es action
 *      and how-to note. The def never carries an amount: amounts and units are
 *      GENERATED from the card (one truth; spec §3 "never copies amounts").
 *   3. `buildSteps` joins def + card into the steps <crunchy-build> renders,
 *      REFUSING a def that binds an unknown line, binds a line twice, or leaves
 *      a card line unbound (a new ingredient on the sheet must get a step).
 *
 * Until `menu_item_build_steps` exists (spec §3, a migration on Juan's word),
 * the card comes from a build-time export of the CSV (scripts/export-build-card.ts
 * → lib/training/build-cards/*.card.json), and tests/training-build-card.test.ts
 * fails if that export is stale against the CSV.
 *
 * DISPLAY NAMES ARE VERBATIM from the sheet (Aioli, Utz Ripples, Shredduce)
 * in both languages, EXCEPT where a display rule (CARD_DISPLAY, Juan's
 * 2026-09-28 rulings, mirrored from co-scenes) says how a line reads:
 * Oil/Vin → "Oil and vinegar", provolone ×2 → "2 slices", a handful of chips
 * → "a handful (about 22 chips)". Display only; binding is by the sheet name.
 * The Spanish action + how-to text is a DRAFT pending Cristian's review.
 */

export type BuildLang = "en" | "es";

/** One ingredient line of an item's card, as the sheet states it. */
export interface CardLine {
  ingredient: string;
  /** null for a presentation amount ("Handfull"). */
  quantity: number | null;
  unit: string | null;
  presentation: "handful" | null;
}

/** The exported card: what the page ships (lib/training/build-cards/*.card.json). */
export interface BuildCard {
  item: string;
  source: string;
  /** sha256 of the canonical JSON of the item's CSV rows — the revision (spec §3). */
  revision_sha: string;
  lines: CardLine[];
}

/** The step shape <crunchy-build> renders (co-scenes src/web/types.ts WebStep, mirrored structurally). */
export interface WebStep {
  n: number;
  key: string;
  action: string;
  ingredient: string | null;
  amount: string | null;
  label: string;
  drawn: boolean;
  howto?: { en?: string; es?: string };
}

interface Bilingual {
  en: string;
  es: string;
}

export interface BuildStepDef {
  key: string;
  /** Verbatim sheet ingredient this step consumes; null for a state step (whole / slice / gut). */
  line: string | null;
  action: Bilingual;
  howto: Bilingual;
}

export interface BuildDef {
  slug: string;
  /** The sheet's item name (the card key). */
  item: string;
  steps: BuildStepDef[];
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Splits one CSV line. The build sheet has no quoted fields; a quote is refused rather than mis-read. */
function cells(line: string): string[] {
  if (line.includes('"')) throw new Error("build-card: quoted CSV fields are not supported");
  return line.split(",").map((c) => c.trim());
}

function parseAmount(raw: string, unitRaw: string, ingredient: string): Omit<CardLine, "ingredient"> {
  if (/^handfull?$/i.test(raw)) return { quantity: null, unit: null, presentation: "handful" };
  const q = Number(raw);
  if (!raw || !Number.isFinite(q) || q <= 0) throw new Error(`build-card: "${ingredient}" has a bad quantity "${raw}"`);
  if (!unitRaw) throw new Error(`build-card: "${ingredient}" has no unit`);
  return { quantity: q, unit: unitRaw, presentation: null };
}

/** The raw rows (columns 0–3) of one item's block, header excluded. Throws if the item is absent. */
export function itemRows(csvText: string, item: string): string[][] {
  const lines = csvText.replace(/^﻿/, "").split(/\r?\n/);
  const rows: string[][] = [];
  let inside = false;
  for (const line of lines.slice(1)) {
    const c = cells(line).slice(0, 4);
    while (c.length < 4) c.push("");
    const [name, ingredient] = c;
    if (!inside) {
      if (name === item) {
        inside = true;
        rows.push(c);
      }
      continue;
    }
    // The block ends ONLY at a fully blank row (or the end of the file). Anything
    // else is refused, never truncated: a human-edited sheet with a stray note in
    // column 0, or a next item with no blank row before it, would otherwise drop
    // lines silently and still pass if no step happened to bind them.
    if (c.every((x) => x === "")) return rows;
    if (name) throw new Error(`build-card: "${item}" block is not closed by a blank row before "${name}"`);
    if (!ingredient) throw new Error(`build-card: "${item}" has a row with no ingredient`);
    rows.push(c);
  }
  if (!inside) throw new Error(`build-card: item "${item}" is not on the sheet`);
  return rows;
}

export function parseBuildSheetItem(csvText: string, item: string): CardLine[] {
  return itemRows(csvText, item).map(([, ingredient = "", q = "", unit = ""]) => {
    if (!ingredient) throw new Error(`build-card: "${item}" has an empty ingredient row`);
    return { ingredient, ...parseAmount(q, unit, ingredient) };
  });
}

// ── amounts + steps ──────────────────────────────────────────────────────────

const HANDFUL: Record<BuildLang, string> = { en: "a handful", es: "un puñado" };

// ── display rules (Juan's scene-review rulings, 2026-09-28) ──────────────────

/** How a card line READS on screen. Display only: the card and its amounts are untouched. */
export interface DisplayRule {
  /** Shown in place of the card name. */
  label?: Bilingual;
  /** An each-count reads "<n> <unit>" instead of "×n". */
  each?: { one: Bilingual; other: Bilingual };
  /** A handful also states its typical count; the range is kept for the scene. */
  handful?: { min: number; max: number; typical: number; noun: Bilingual };
}

/**
 * MIRROR of co-scenes `src/card/display.ts` (CARD_DISPLAY), the ONE display
 * table track C's scene counters also read. co-scenes keys it by
 * sha256(trimmed, lower-cased card name) because that repo holds no CO-OPS
 * names; here it is keyed by the card name itself. tests/training-build-card.test.ts
 * hashes these names and asserts equality with the vendored
 * vendor/co-scenes/dist/card-display.json, so the two cannot drift: change
 * the rule in co-scenes, re-vendor, then mirror it here.
 * Spanish strings are drafts pending Cristian's review.
 */
export const CARD_DISPLAY: Readonly<Record<string, DisplayRule>> = {
  // "so they know exactly what it is"
  "Oil/Vin": { label: { en: "Oil and vinegar", es: "Aceite y vinagre" } },
  // ×2 reads "2 slices"
  Provolone: { each: { one: { en: "slice", es: "rebanada" }, other: { en: "slices", es: "rebanadas" } } },
  // a handful of chips = 20–25, 22 by default
  "Utz Ripples": { handful: { min: 20, max: 25, typical: 22, noun: { en: "chips", es: "papitas" } } },
};

const norm = (name: string) => name.trim().toLowerCase();

export function displayRuleFor(name: string): DisplayRule | null {
  const key = Object.keys(CARD_DISPLAY).find((k) => norm(k) === norm(name));
  return key ? (CARD_DISPLAY[key] ?? null) : null;
}

/** The on-screen name of a card line: the rule's label, else the card name verbatim. */
export function displayName(line: CardLine, lang: BuildLang): string {
  return displayRuleFor(line.ingredient)?.label?.[lang] ?? line.ingredient;
}

/**
 * "1.5 oz"; "×2", or "2 slices" under an each rule; "a handful" / "un puñado",
 * plus "(about 22 chips)" / "(unas 22 papitas)" under a handful rule. The
 * numbers always come from the card or the display table, never from here.
 */
export function formatAmount(line: CardLine, lang: BuildLang): string {
  const rule = displayRuleFor(line.ingredient);
  if (line.presentation === "handful") {
    const h = rule?.handful;
    if (!h) return HANDFUL[lang];
    return lang === "en"
      ? `${HANDFUL.en} (about ${h.typical} ${h.noun.en})`
      : `${HANDFUL.es} (unas ${h.typical} ${h.noun.es})`;
  }
  if (line.quantity === null || line.unit === null) throw new Error(`build-card: "${line.ingredient}" has no amount`);
  if (line.unit.toLowerCase() === "ea") {
    const each = rule?.each;
    return each ? `${line.quantity} ${(line.quantity === 1 ? each.one : each.other)[lang]}` : `×${line.quantity}`;
  }
  return `${line.quantity} ${line.unit}`;
}

export function buildSteps(def: BuildDef, card: BuildCard, lang: BuildLang): WebStep[] {
  if (card.item !== def.item) throw new Error(`build-card: card is "${card.item}", def is "${def.item}"`);
  const byName = new Map(card.lines.map((l) => [l.ingredient, l]));
  const used = new Set<string>();
  const steps = def.steps.map((s, i): WebStep => {
    // Every step is drawn until real photos land (real-food law: training may be drawn, marked "illustrated").
    // The host's flag is a floor, not the truth: the real-photo scene (track C) sets `drawn` from its own look plan.
    const base = { n: i + 1, key: s.key, action: s.action[lang], drawn: true, howto: { en: s.howto.en, es: s.howto.es } };
    if (s.line === null) return { ...base, ingredient: null, amount: null, label: s.action[lang] };
    const line = byName.get(s.line);
    if (!line) throw new Error(`build-card: step "${s.key}" binds "${s.line}", which is not on the ${def.item} card`);
    if (used.has(s.line)) throw new Error(`build-card: "${s.line}" is bound twice`);
    used.add(s.line);
    const amount = formatAmount(line, lang);
    const name = displayName(line, lang);
    return { ...base, ingredient: name, amount, label: `${name} · ${amount}` };
  });
  const unbound = card.lines.filter((l) => !used.has(l.ingredient)).map((l) => l.ingredient);
  if (unbound.length) throw new Error(`build-card: card lines with no step: ${unbound.join(", ")}`);
  return steps;
}

// ── the canonical builds ─────────────────────────────────────────────────────

/**
 * Crunchy Boi, in the canonical order: whole roll → slice → gut top half →
 * aioli → chips on the opposite half → provolone ×2 seal → turkey → onions →
 * pickles → shredduce → oil & vinegar → oregano. The how-to notes never state
 * an amount; the amount beside them comes from the card.
 */
const CRUNCHY_BOI: BuildDef = {
  slug: "crunchy-boi",
  item: "Crunchy Boi",
  steps: [
    {
      key: "whole",
      line: null,
      action: { en: "Whole roll", es: "Pan entero" },
      howto: {
        en: "Start with one whole sub roll. Check it is fresh and not crushed.",
        es: "Empieza con un pan de sub entero. Revisa que esté fresco y no aplastado.",
      },
    },
    {
      key: "slice",
      line: null,
      action: { en: "Slice it open", es: "Ábrelo" },
      howto: {
        en: "Slice the roll open lengthwise so you have a top half and a bottom half.",
        es: "Corta el pan a lo largo para tener una mitad de arriba y una de abajo.",
      },
    },
    {
      key: "gut",
      line: null,
      action: { en: "Gut the top half", es: "Ahueca la mitad de arriba" },
      howto: {
        en: "Pull some bread out of the top half to make a gut for the aioli.",
        es: "Saca un poco de miga de la mitad de arriba para hacer el hueco del aioli.",
      },
    },
    {
      key: "aioli",
      line: "Aioli",
      action: { en: "Into the gut", es: "En el hueco" },
      howto: {
        en: "Spread the aioli in the gut, end to end.",
        es: "Unta el aioli en el hueco, de punta a punta.",
      },
    },
    {
      key: "chips",
      line: "Utz Ripples",
      action: { en: "On the opposite half", es: "En la otra mitad" },
      howto: {
        en: "Lay the chips on the opposite half, the one with no aioli.",
        es: "Pon las papitas en la otra mitad, la que no tiene aioli.",
      },
    },
    {
      key: "provolone",
      line: "Provolone",
      action: { en: "Seal the chips", es: "Sella las papitas" },
      howto: {
        en: "Lay the provolone over the chips to seal them in, so they stay crunchy and in place.",
        es: "Cubre las papitas con el provolone para sellarlas, así quedan crujientes y en su lugar.",
      },
    },
    {
      key: "turkey",
      line: "Turkey",
      action: { en: "Add", es: "Agrega" },
      howto: {
        en: "Spread the turkey evenly, end to end.",
        es: "Reparte el pavo parejo, de punta a punta.",
      },
    },
    {
      key: "onions",
      line: "Onions",
      action: { en: "Add", es: "Agrega" },
      howto: {
        en: "Scatter the onions evenly over the turkey.",
        es: "Reparte la cebolla pareja sobre el pavo.",
      },
    },
    {
      key: "pickles",
      line: "Pickles",
      action: { en: "Add", es: "Agrega" },
      howto: {
        en: "Spread the pickles evenly so every bite gets some.",
        es: "Reparte los pepinillos parejos para que cada mordida tenga.",
      },
    },
    {
      key: "shredduce",
      line: "Shredduce",
      action: { en: "Add", es: "Agrega" },
      howto: {
        en: "Add the shredduce (our shredded-lettuce blend) evenly on top.",
        es: "Agrega el shredduce (nuestra mezcla de lechuga rallada) parejo por encima.",
      },
    },
    {
      key: "oil-vin",
      line: "Oil/Vin",
      action: { en: "Dress it", es: "Aderézalo" },
      howto: {
        en: "Drizzle the oil and vinegar over the shredduce.",
        es: "Echa el aceite y vinagre sobre el shredduce.",
      },
    },
    {
      key: "oregano",
      line: "Oregano",
      action: { en: "Finish", es: "Termina" },
      howto: {
        en: "Sprinkle the oregano over the top. That is the build.",
        es: "Espolvorea el orégano por encima. Así queda el armado.",
      },
    },
  ],
};

export const BUILD_DEFS: readonly BuildDef[] = [CRUNCHY_BOI];

export function buildDefForSlug(slug: string): BuildDef | null {
  return BUILD_DEFS.find((d) => d.slug === slug) ?? null;
}
