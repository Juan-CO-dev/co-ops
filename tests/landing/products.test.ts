import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { products, validateProducts } from '@/lib/landing/products';
import { isLandingAsset } from '@/lib/landing/host-shared';

describe('approved landing lineup', () => {
  it('permits only approved lineup image paths through the host without the optimizer', () => {
    for (const product of products) {
      expect(isLandingAsset(product.image, new URLSearchParams())).toBe(true);
      expect(isLandingAsset(product.smallImage, new URLSearchParams())).toBe(true);
      expect(isLandingAsset('/_next/image', new URLSearchParams({url:product.image}))).toBe(false);
    }
    expect(isLandingAsset('/media/marisa-lineup-018.webp', new URLSearchParams())).toBe(false);
  });
  it('has exactly ten unique confirmed identities and sources', () => {
    expect(products.map(p => p.sourceId)).toEqual(['001','005','011','014','024','029','033','037','040','047']);
    expect(new Set(products.map(p => p.id)).size).toBe(10);
    expect(() => validateProducts(products)).not.toThrow();
    expect(() => validateProducts([...products, products[0]!])).toThrow();
    expect(() => validateProducts([{...products[0]!, sourceId:'018'}])).toThrow();
    expect(() => validateProducts([{...products[0]!, sourceId:'005'}])).toThrow();
  });
  it('uses direct real-photo exports with explicit mode, no ingredient guesses', () => {
    const manifest = JSON.parse(readFileSync('assets/approved-media.json','utf8'));
    for (const product of products) {
      for (const image of [product.image, product.smallImage]) {
      const asset = manifest.media.find((m: {publicPath:string}) => m.publicPath === image);
      expect(asset.sourceId).toBe(product.sourceId);
      expect(asset.classification).toBe('real-photo');
      expect(asset.mode).toBe('resize-only');
      expect(asset.bytes).toBeLessThanOrEqual(100000);
      expect(product.ingredientsKey).toBe(`landing.lineup.ingredients.${product.id}`);
      }
    }
  });
});

import { Lineup } from "@/components/landing/Lineup";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
vi.mock("@/components/landing/LineupPhoto", () => ({LineupPhoto: () => null}));
const expectedMenu = [
  [
    "Crunchy Boi",
    "Turkey, provolone, garlic mayo, onion, pickles, iceberg lettuce, oil & vinegar, ripple potato chips, sub roll.",
    "Pavo, provolone, mayonesa de ajo, cebolla, pepinillos, lechuga iceberg, aceite y vinagre, papas fritas onduladas, pan para sub."
  ],
  [
    "Farmers Market After Dark",
    "Salsa verde, cucumber, onion, sweet peppers, hot peppers, iceberg lettuce, arugula, oil & vinegar, sub roll.",
    "Salsa verde, pepino, cebolla, pimientos dulces, chiles picantes, lechuga iceberg, rúcula, aceite y vinagre, pan para sub."
  ],
  [
    "Hot Pants",
    "Capicola, pepperoni, Genoa salami, provolone, onion, sweet peppers, hot peppers, iceberg lettuce, arugula, oil & vinegar, sub roll.",
    "Capicola, pepperoni, salami de Génova, provolone, cebolla, pimientos dulces, chiles picantes, lechuga iceberg, rúcula, aceite y vinagre, pan para sub."
  ],
  [
    "Never Been Cheddar",
    "Roast beef, cheddar, mustard mayo, radish, arugula, lemon oil, sub roll.",
    "Roast beef, cheddar, mayonesa de mostaza, rábano, rúcula, aceite de limón, pan para sub."
  ],
  [
    "Our French Dip",
    "Roast beef, provolone, caramelized onion, horseradish mayo, black pepper, thyme, au jus for dipping, sub roll.",
    "Roast beef, provolone, cebolla caramelizada, mayonesa de rábano picante, pimienta negra, tomillo y jugo de carne para mojar, pan para sub."
  ],
  [
    "Sicky Wicky Club",
    "Ham, turkey, bacon, provolone, Duke's mayo, iceberg lettuce, onion, tomato, oil & vinegar, sub roll.",
    "Jamón, pavo, tocino, provolone, mayonesa Duke's, lechuga iceberg, cebolla, tomate, aceite y vinagre, pan para sub."
  ],
  [
    "The Frex",
    "Ham, capicola, Genoa salami, pepperoni, prosciutto, fresh mozzarella, hot peppers, arugula, oil & vinegar, balsamic vinaigrette, oregano, sub roll.",
    "Jamón, capicola, salami de Génova, pepperoni, prosciutto, mozzarella fresca, chiles picantes, rúcula, aceite y vinagre, vinagreta balsámica, orégano, pan para sub."
  ],
  [
    "The Teamster",
    "Ham, capicola, Genoa salami, provolone, onion, sweet peppers, hot peppers, iceberg lettuce, oil & vinegar, sub roll.",
    "Jamón, capicola, salami de Génova, provolone, cebolla, pimientos dulces, chiles picantes, lechuga iceberg, aceite y vinagre, pan para sub."
  ],
  [
    "Turkey Caesar Sub",
    "Turkey, butter, iceberg lettuce, Caesar dressing, Parmesan, black pepper, sub roll.",
    "Pavo, mantequilla, lechuga iceberg, aderezo César, parmesano, pimienta negra, pan para sub."
  ],
  [
    "Vesuvio II",
    "Meatballs, vodka sauce, shredded mozzarella, banana peppers, sub roll.",
    "Albóndigas, salsa de vodka, mozzarella rallada, chiles banana, pan para sub."
  ]
] as const;
it.each(["en", "es"] as const)("renders all ten complete menu lists in %s", language => {
 const html = renderToStaticMarkup(Lineup({language})).replaceAll("&amp;", "&").replaceAll("&#x27;", "'");
 for (const [name,en,es] of expectedMenu) { expect(html).toContain(name); expect(html).toContain(language === "en" ? en : es); }
 expect(html).not.toContain("Marisa");
});
