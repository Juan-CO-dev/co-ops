import type { ModifierEffect } from "./modifiers-shared";

export type BaseLineTarget = { kind: "menu_item" | "item" | "package"; id: string };
export type ResolvedLineTarget =
  | { kind: "base"; target: BaseLineTarget }
  | { kind: "modifier"; effect: ModifierEffect };

/** Preserve explicit maps; dual-role fallbacks only cover the reviewed entity kinds. */
export function resolveLineTarget(
  isModifier: boolean, base: BaseLineTarget | undefined, modifier: ModifierEffect | undefined,
): ResolvedLineTarget | null {
  if (isModifier) {
    if (modifier) return { kind: "modifier", effect: modifier };
    if (base && base.kind !== "package") return { kind: "base", target: base };
  } else {
    if (base) return { kind: "base", target: base };
    if (modifier?.disposition === "deplete" && modifier.targetKind !== "menu_item") {
      return { kind: "modifier", effect: modifier };
    }
  }
  return null;
}

const MISSPELLINGS: Readonly<Record<string, string>> = {
  chioz: "chips", crewm: "cream", proscuitto: "prosciutto", cstering: "catering",
};

export function normalizeOpenItemText(text: string): string {
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/);
  return words.map((word) => MISSPELLINGS[word] ?? word).join(" ").replace(/s$/, "").trim();
}

/** Run before punctuation stripping so ezCater codes and dates stay recognizable. */
export function shouldSkipOpenItem(text: string): boolean {
  const raw = text.trim().toLowerCase();
  return /^[0-9a-z]{3}-[0-9a-z]{3}$/.test(raw)
    || /^cater/.test(normalizeOpenItemText(raw))
    || /^(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}[/-]\d{1,2}[/-]\d{1,2})$/.test(raw);
}
