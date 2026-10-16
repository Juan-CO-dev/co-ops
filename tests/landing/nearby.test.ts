import { describe, expect, it } from 'vitest';
import { distanceKm, nearestStores, validCoordinates } from '@/lib/landing/nearby-shared';

describe('opt-in shop distances', () => {
  it('rejects unavailable and out-of-range coordinates', () => {
    for (const point of [null, {latitude:91,longitude:0}, {latitude:0,longitude:181}, {latitude:NaN,longitude:0}]) expect(validCoordinates(point)).toBe(false);
    expect(validCoordinates({latitude:0,longitude:0})).toBe(true);
  });
  it('measures straight-line kilometres, never walking time', () => {
    expect(distanceKm({latitude:0,longitude:0},{latitude:0,longitude:1})).toBeCloseTo(111.195,2);
    expect(distanceKm({latitude:38,longitude:-77},{latitude:38,longitude:-77})).toBe(0);
  });
  it('sorts known distances while retaining every shop and its link', () => {
    const stores = [{key:'far',coordinates:{latitude:0,longitude:2},orderUrl:'https://example.test/far'}, {key:'unknown',coordinates:null,orderUrl:'https://example.test/unknown'}, {key:'near',coordinates:{latitude:0,longitude:1},orderUrl:'https://example.test/near'}];
    expect(nearestStores(stores,{latitude:0,longitude:0}).map(s=>s.key)).toEqual(['near','far','unknown']);
    expect(stores.map(s=>s.key)).toEqual(['far','unknown','near']);
    expect(nearestStores(stores,{latitude:0,longitude:0})[0]?.orderUrl).toBe(stores[2]?.orderUrl);
  });
  it('retains source order when user coordinates are invalid', () => {
    const stores=[{key:'a',coordinates:null},{key:'b',coordinates:{latitude:0,longitude:1}}];
    expect(nearestStores(stores,{latitude:Infinity,longitude:0}).map(s=>s.key)).toEqual(['a','b']);
  });
});
