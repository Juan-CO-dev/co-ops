import { describe, expect, it, vi } from 'vitest';
import { captureAttribution, persistAttribution, readAttribution, buildFbc, ATTRIBUTION_KEY } from '@/lib/landing/attribution-shared';

describe('landing attribution', () => {
  const policy = { ads: ['subsim-photo'], utm: { utm_source: ['facebook'] } };
  it('keeps only approved values and a bounded genuine click id', () => {
    expect(captureAttribution('?ad=subsim-photo&utm_source=facebook&email=private@example.com&fbclid=Ab_c-1', policy, 123)).toEqual({ ad: 'subsim-photo', utm: { utm_source: 'facebook' }, fbclid: 'Ab_c-1', capturedAt: 123 });
    expect(buildFbc('Ab_c-1', 123)).toBe('fb.1.123.Ab_c-1');
  });
  it.each(['', 'a'.repeat(501), 'private@example.com', 'a/b', 'a b'])('refuses malformed fbclid %s', fbclid => {
    expect(captureAttribution(`?ad=unknown&fbclid=${encodeURIComponent(fbclid)}`, policy, 123)).toEqual({ ad: 'unattributed', utm: {} });
    expect(buildFbc(fbclid, 123)).toBeUndefined();
  });
  it('rejects ambiguous repeated query keys', () => {
    expect(captureAttribution('?ad=subsim-photo&ad=subsim-photo&fbclid=a&fbclid=b', policy)).toEqual({ ad: 'unattributed', utm: {} });
  });
  it('keeps the original capture time for the same genuine click across reloads', () => {
    const prior={ad:'subsim-photo',utm:{},fbclid:'same-click',capturedAt:123};
    expect(captureAttribution('?ad=subsim-photo&fbclid=same-click',policy,456,prior).capturedAt).toBe(123);
    expect(captureAttribution('?ad=subsim-photo&fbclid=new-click',policy,456,prior).capturedAt).toBe(456);
  });
  it('does not persist before consent and clears on withdrawal', () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    persistAttribution(storage, { ad:'subsim-photo', utm:{} }, false);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).toHaveBeenCalledWith(ATTRIBUTION_KEY);
    persistAttribution(storage, { ad:'subsim-photo', utm:{} }, true);
    expect(storage.setItem).toHaveBeenCalledOnce();
  });
  it('survives unavailable storage and revalidates restored values', () => {
    const storage = { setItem(){throw Error();}, getItem(){throw Error();}, removeItem(){throw Error();} };
    expect(() => persistAttribution(storage, { ad:'subsim-photo', utm:{} }, true)).not.toThrow();
    expect(readAttribution(storage, policy)).toBeUndefined();
    expect(readAttribution({getItem:()=>'{"ad":"email@example.com","utm":{},"email":"private"}'}, policy)).toEqual({ ad:'unattributed', utm:{} });
    expect(readAttribution({getItem:()=>'{"ad":"subsim-photo","utm":{"fbclid":"forged","ad":"other"}}'}, policy)).toEqual({ ad:'subsim-photo', utm:{} });
  });
});

it('a new registry-approved code survives capture but an unresolved or retired code cannot',()=>{
 expect(captureAttribution('?ad=new-campaign',{ads:[]})).toEqual({ad:'unattributed',utm:{}});
 expect(captureAttribution('?ad=new-campaign',{ads:['new-campaign']})).toEqual({ad:'new-campaign',utm:{}});
});
