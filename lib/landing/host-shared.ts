import inventory from '@/config/tenant/landing-assets.json';
/** Pure host policy. HTTP Host is authoritative; forwarded hints never grant access. */
export interface LandingHostEnv { LANDING_HOSTS?: string; STAFF_ORIGIN?: string; SITE_ORIGIN?: string }
export interface Authority { hostname: string; port: number }
export function parseAuthority(raw: string | null): Authority | null {
  if (!raw || raw.length > 260 || /[^\x21-\x7e]/.test(raw)) return null;
  const match = /^([a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?)(?::([0-9]{1,5}))?$/.exec(raw);
  if (!match) return null;
  const hostname = match[1]!.toLowerCase();
  if (hostname.length > 253 || hostname.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label.startsWith('xn--'))) return null;
  const port = match[2] ? Number(match[2]) : 443;
  return port > 0 && port <= 65535 ? { hostname, port } : null;
}
export function configuredOrigin(raw: string | undefined): URL | null {
  if (!raw || !/^https:\/\/[^/?#]+$/.test(raw)) return null;
  const authority = parseAuthority(raw.slice(8));
  if (!authority) return null;
  try { return new URL(raw); } catch { return null; }
}
export function classifyLandingHost(headers: Pick<Headers, 'get'>, env: LandingHostEnv = { LANDING_HOSTS: process.env.LANDING_HOSTS, SITE_ORIGIN: process.env.SITE_ORIGIN, STAFF_ORIGIN: process.env.STAFF_ORIGIN }): 'landing' | 'staff' {
  const host = parseAuthority(headers.get('host'));
  if (!host) { console.warn('[landing] invalid host; landing dormant'); return 'staff'; }
  const forwarded = headers.get('x-forwarded-host');
  if (forwarded !== null) {
    const other = parseAuthority(forwarded);
    if (!other || other.hostname !== host.hostname || other.port !== host.port) { console.warn('[landing] host disagreement; landing dormant'); return 'staff'; }
  }
  const entries = (env.LANDING_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const allowed = entries.length > 0 && entries.every(s => parseAuthority(s)?.hostname === s && !s.includes(':'));
  const site = configuredOrigin(env.SITE_ORIGIN);
  const staff = configuredOrigin(env.STAFF_ORIGIN);
  // Misconfigured identity is dormant rather than guessing a redirect origin.
  if (!allowed || !site || !staff || !entries.includes(site.hostname) || site.hostname === staff.hostname || host.hostname === staff.hostname) return 'staff';
  return entries.includes(host.hostname) ? 'landing' : 'staff';
}
// Finite approved public inventory; new assets must be explicitly added with provenance.
export const LANDING_ASSETS = new Set(inventory.map(asset => asset.path));
export function isLandingAsset(path: string, search: URLSearchParams): boolean {
  if (LANDING_ASSETS.has(path)) return true;
  if (path.startsWith('/_next/static/') && !path.includes('..') && !path.includes('%')) return true;
  if (path === '/_next/image') return search.getAll('url').length === 1 && /\.(?:png|webp)$/.test(search.get('url') ?? '') && LANDING_ASSETS.has(search.get('url') ?? '');
  return false;
}
export function landingPathDecision(path: string, search: URLSearchParams): 'rewrite' | 'redirect' | 'allow' | 'deny' {
  if (path === '/' || path === '/privacy') return 'rewrite';
  if (path === '/eat' || path === '/eat/privacy') return 'redirect';
  if (['/api/landing/events', '/api/landing/order-click', '/eat/icon.png', '/eat/apple-icon.png', '/favicon.ico', '/robots.txt', '/sitemap.xml'].includes(path) || isLandingAsset(path, search)) return 'allow';
  return 'deny';
}
