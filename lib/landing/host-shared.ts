import inventory from '@/config/tenant/landing-assets.json';
/** Pure host policy. HTTP Host is authoritative; forwarded hints never grant access. */
export interface LandingHostEnv { LANDING_HOSTS?: string; STAFF_ORIGIN?: string; SITE_ORIGIN?: string; PORTAL_HOSTS?: string; PORTAL_ORIGIN?: string }
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
export function classifyLandingHost(headers: Pick<Headers, 'get'>, env: LandingHostEnv = { LANDING_HOSTS: process.env.LANDING_HOSTS, SITE_ORIGIN: process.env.SITE_ORIGIN, STAFF_ORIGIN: process.env.STAFF_ORIGIN, PORTAL_HOSTS: process.env.PORTAL_HOSTS, PORTAL_ORIGIN: process.env.PORTAL_ORIGIN }): 'landing' | 'staff' | 'portal' {
  const host = parseAuthority(headers.get('host'));
  if (!host) { console.warn('[landing] invalid host; landing dormant'); return 'staff'; }
  const forwarded = headers.get('x-forwarded-host');
  if (forwarded !== null) {
    const other = parseAuthority(forwarded);
    if (!other || other.hostname !== host.hostname || other.port !== host.port) { console.warn('[landing] host disagreement; landing dormant'); return 'staff'; }
  }
  const entries = hostEntries(env.LANDING_HOSTS);
  const portalEntries = hostEntries(env.PORTAL_HOSTS);
  if (entries.includes(host.hostname) && portalEntries.includes(host.hostname)) return 'staff';
  const allowed = validHostEntries(entries);
  const site = configuredOrigin(env.SITE_ORIGIN);
  const staff = configuredOrigin(env.STAFF_ORIGIN);
  const portal = configuredOrigin(env.PORTAL_ORIGIN);
  if (staff && host.hostname !== staff.hostname && validHostEntries(portalEntries) && portal && portal.hostname !== staff.hostname && portalEntries.includes(portal.hostname) && portalEntries.includes(host.hostname)) return 'portal';
  // Misconfigured identity is dormant rather than guessing a redirect origin.
  if (!allowed || !site || !staff || !entries.includes(site.hostname) || site.hostname === staff.hostname || host.hostname === staff.hostname) return 'staff';
  return entries.includes(host.hostname) ? 'landing' : 'staff';
}
// Finite approved public inventory; new assets must be explicitly added with provenance.
export const LANDING_ASSETS = new Set(inventory.map(asset => asset.path));
export function isLandingAsset(path: string, _search: URLSearchParams): boolean {
  if (LANDING_ASSETS.has(path)) return true;
  // Turbopack hashes may contain adjacent dots; only dot path segments traverse.
  if (path.startsWith('/_next/static/') && !path.includes('%') && !path.includes('\\') && !path.split('/').some(segment => segment === '.' || segment === '..')) return true;
  return false;
}
export function landingPathDecision(path: string, search: URLSearchParams): 'rewrite' | 'redirect' | 'allow' | 'deny' {
  if (path === '/' || path === '/privacy') return 'rewrite';
  if (path === '/eat' || path === '/eat/privacy') return 'redirect';
  if (['/api/landing/events', '/api/landing/order-click', '/api/landing/ad-code', '/eat/icon.png', '/eat/apple-icon.png', '/favicon.ico', '/robots.txt', '/sitemap.xml'].includes(path) || isLandingAsset(path, search)) return 'allow';
  return 'deny';
}

/** Same exact, lower-case hostname allowlist grammar for both public hosts. */
export function hostEntries(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}
function validHostEntries(entries: string[]): boolean {
  return entries.length > 0 && entries.every(s => parseAuthority(s)?.hostname === s && !s.includes(':'));
}

/** Finite customer API inventory, traced from app/order. No blanket API bypass. */
export const PORTAL_API_PATHS = [
  '/api/portal/magic-link/request', '/api/portal/magic-link/verify',
  '/api/portal/order/draft/lines', '/api/portal/order/draft/preview', '/api/portal/order/draft/submit',
] as const;
export function portalPathDecision(path: string): 'redirect' | 'allow' | 'deny' {
  if (path === '/') return 'redirect';
  if (path.includes('%') || path.includes('\\') || path.split('/').some(s => s === '.' || s === '..')) return 'deny';
  if (path === '/order' || path.startsWith('/order/')) return 'allow';
  const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  if ((PORTAL_API_PATHS as readonly string[]).includes(path) ||
      new RegExp(`^/api/portal/order/draft/${uuid}$`).test(path) ||
      new RegExp(`^/api/portal/quote/${uuid}/pay$`).test(path)) return 'allow';
  if (path.startsWith('/_next/static/') || ['/favicon.ico', '/icon.png', '/apple-icon.png', '/brand/co-icon.png', '/brand/co-wordmark.png', '/brand/landing-icon.png'].includes(path)) return 'allow';
  return 'deny';
}
