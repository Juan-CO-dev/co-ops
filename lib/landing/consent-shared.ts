/** Necessary host-only preference; no marketing identifiers. */
export type ConsentChoice = 'accepted' | 'rejected' | 'unknown';
export interface PrivacySignals { doNotTrack?: string | null; globalPrivacyControl?: boolean }
export function marketingAllowed(serverApproved: boolean, choice: string | undefined, signals: PrivacySignals): boolean {
  return serverApproved && choice === 'accepted' && signals.doNotTrack !== '1' && signals.globalPrivacyControl !== true;
}
export function readConsent(cookie: string): ConsentChoice {
  const values = cookie.split(';').map(v => v.trim()).filter(v => v.startsWith('landing_consent='));
  if (values.length !== 1) return 'unknown';
  const value = values[0]?.slice('landing_consent='.length);
  return value === 'accepted' || value === 'rejected' ? value : 'unknown';
}
export function consentCookie(choice: Exclude<ConsentChoice, 'unknown'>, secure: boolean): string {
  return `landing_consent=${choice}; Path=/; SameSite=Lax; Max-Age=15552000${secure ? '; Secure' : ''}`;
}
/** The Meta Pixel's first-party cookies (set on the registrable domain, e.g. `.example.com`). */
export const MARKETING_COOKIES = ['_fbp', '_fbc'] as const;
/** Every Domain a marketing cookie may live on: the host and each parent, never a bare TLD,
 *  never for an IP or single-label host (those can only hold host-only cookies). */
export function marketingCookieDomains(hostname: string): string[] {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return [];
  const labels = host.split('.');
  const domains: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) domains.push(labels.slice(i).join('.'));
  return domains;
}
/** The cookie writes that expire every marketing cookie: a host-only expiry plus one per Domain.
 *  A browser treats each Domain as a different cookie, so one host-level write never removes
 *  the Pixel's parent-domain `_fbp` / `_fbc`. A public-suffix Domain write is refused by the browser (harmless). */
export function marketingCookieExpiries(hostname: string, https: boolean): string[] {
  const domains = marketingCookieDomains(hostname);
  const writes: string[] = [];
  for (const key of MARKETING_COOKIES) {
    const base = `${key}=; Path=/; Max-Age=0; SameSite=Lax${https ? '; Secure' : ''}`;
    writes.push(base);
    for (const domain of domains) writes.push(`${base}; Domain=${domain}`);
  }
  return writes;
}
