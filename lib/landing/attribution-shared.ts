export const ATTRIBUTION_KEY = 'landing_attribution';
export interface AttributionPolicy { ads: readonly string[]; utm?: Readonly<Record<string, readonly string[]>> }
export interface Attribution { ad: string; utm: Record<string,string>; fbclid?: string; capturedAt?: number }
type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'>;
const validClick = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,500}$/.test(value);
export function buildFbc(fbclid: unknown, capturedAt: number): string | undefined {
  return validClick(fbclid) && Number.isSafeInteger(capturedAt) && capturedAt > 0 ? `fb.1.${capturedAt}.${fbclid}` : undefined;
}
export function captureAttribution(query: string, policy: AttributionPolicy, now = Date.now(), previous?: Attribution): Attribution {
  const params = new URLSearchParams(query);
  const single = (key: string) => params.getAll(key).length === 1 ? params.get(key) : null;
  const ad = single('ad');
  const result: Attribution = { ad: ad && policy.ads.includes(ad) ? ad : 'unattributed', utm: {} };
  for (const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
    const value = single(key);
    if (value && value.length <= 100 && policy.utm?.[key]?.includes(value)) result.utm[key] = value;
  }
  const fbclid = single('fbclid');
  if (validClick(fbclid)) {
    result.fbclid = fbclid;
    result.capturedAt = previous && previous.fbclid === fbclid && typeof previous.capturedAt === 'number' && Number.isSafeInteger(previous.capturedAt) && previous.capturedAt > 0 && previous.capturedAt <= now ? previous.capturedAt : now;
  }
  return result;
}
export function persistAttribution(storage: StorageWriter | undefined, value: Attribution, consented: boolean): void {
  try { if (consented) storage?.setItem(ATTRIBUTION_KEY, JSON.stringify(value)); else storage?.removeItem(ATTRIBUTION_KEY); } catch { /* denied storage is supported */ }
}
export function readAttribution(storage: StorageReader | undefined, policy: AttributionPolicy): Attribution | undefined {
  try {
    const raw = storage?.getItem(ATTRIBUTION_KEY);
    if (!raw || raw.length > 3000) return undefined;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
    const input = data as Record<string,unknown>;
    const params = new URLSearchParams();
    if (typeof input.ad === 'string') params.set('ad', input.ad);
    if (validClick(input.fbclid) && typeof input.capturedAt === 'number' && input.capturedAt > 0 && input.capturedAt <= Date.now()) params.set('fbclid', input.fbclid);
    if (input.utm && typeof input.utm === 'object') for (const [key,value] of Object.entries(input.utm)) if (['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].includes(key) && typeof value === 'string') params.set(key,value);
    return captureAttribution(params.toString(), policy, typeof input.capturedAt === 'number' ? input.capturedAt : Date.now());
  } catch { return undefined; }
}
