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
      expect(product).not.toHaveProperty('ingredients');
      }
    }
  });
});
