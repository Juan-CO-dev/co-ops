import { NextResponse, type NextRequest } from 'next/server';
import { verifyJwt } from './lib/auth';
import { loadLandingConfig } from './lib/landing/config';
import { landingIndexable } from './lib/landing/indexing-shared';
import { resolveLandingLanguage } from './lib/landing/language-shared';
import { classifyLandingHost, configuredOrigin, parseAuthority, landingPathDecision, isLandingAsset } from './lib/landing/host-shared';
import { LANDING_SECURITY_HEADERS, SECURITY_HEADERS } from './lib/security-headers';

const PUBLIC_PATHS = new Set(['/', '/verify', '/reset-password', '/api/auth/pin', '/api/auth/password', '/api/auth/logout', '/api/auth/verify', '/api/auth/password-reset-request', '/api/auth/password-reset', '/api/locations', '/api/users/login-options', '/order']);
function isPublicPath(path: string): boolean {
  // The original matcher bypasses remain staff-only after the landing gate.
  return PUBLIC_PATHS.has(path) || ['/order/', '/api/portal/', '/api/webhooks/', '/api/cron/', '/brand/', '/_next/static', '/_next/image', '/favicon.ico'].some(prefix => path.startsWith(prefix)) || /\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf)$/.test(path);
}
function finishResponse(response: NextResponse, landing: boolean, assetPath?: string, nearbyEnabled = false): NextResponse {
  for (const { key, value } of landing ? LANDING_SECURITY_HEADERS : SECURITY_HEADERS) response.headers.set(key, value);
  if (landing && !assetPath) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  if (landing && assetPath?.startsWith('/media/')) response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (landing && assetPath?.startsWith('/brand/')) response.headers.set('Cache-Control', 'public, max-age=300');
  if (landing && (assetPath === '/robots.txt' || assetPath === '/sitemap.xml')) response.headers.set('Cache-Control', 'private, no-store');
  if (landing && assetPath?.startsWith('/api/landing/')) response.headers.set('Cache-Control', 'no-store');
  if (landing && nearbyEnabled) response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  return response;
}
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const landingConfig = loadLandingConfig();
  const kind = classifyLandingHost(req.headers, landingConfig);
  const indexable = landingIndexable(kind, req.headers, landingConfig);
  const finish = (response: NextResponse, landing: boolean, assetPath?: string) => {
    if (landing && !indexable) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return finishResponse(response, landing, assetPath, landingConfig.nearbyEnabled);
  };
  const path = req.nextUrl.pathname;
  const headers = new Headers(req.headers);
  // No client-supplied routing/identity hints survive the public boundary.
  for (const key of [...headers.keys()]) if (key.startsWith('x-landing') || key.startsWith('x-co-')) headers.delete(key);
  const requestedHost = parseAuthority(req.headers.get('host'));
  if (requestedHost && landingConfig.landingHosts.includes(requestedHost.hostname) && requestedHost.hostname !== configuredOrigin(landingConfig.STAFF_ORIGIN)?.hostname && !configuredOrigin(landingConfig.SITE_ORIGIN)) {
    return finish(new NextResponse(null, { status: 404 }), true);
  }
  if (kind === 'landing') {
    const targetOrigin = configuredOrigin(landingConfig.SITE_ORIGIN);
    if (!targetOrigin) return finish(new NextResponse(null, { status: 404 }), true);
    headers.set('x-landing-indexable', indexable ? '1' : '0');
    headers.set('x-landing-path', path === '/privacy' ? '/privacy' : '/');
    const languages = req.nextUrl.searchParams.getAll('lang');
    headers.set('x-landing-language', resolveLandingLanguage(languages.length === 1 ? languages[0] : undefined, req.headers.get('accept-language')));
    const decision = landingPathDecision(path, req.nextUrl.searchParams);
    if (decision === 'deny') return finish(new NextResponse(null, { status: 404 }), true);
    if (landingConfig.VERCEL_ENV === 'production' && !indexable) {
      targetOrigin.pathname = path;
      targetOrigin.search = req.nextUrl.search;
      return finish(NextResponse.redirect(targetOrigin, 301), true);
    }
    if (decision === 'redirect') {
      const target = targetOrigin;
      target.pathname = path === '/eat' ? '/' : '/privacy';
      target.search = req.nextUrl.search;
      return finish(NextResponse.redirect(target, 301), true);
    }
    const origin = targetOrigin.origin;
    if (path === '/robots.txt') return finish(new NextResponse(indexable ? `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } }), true, path);
    if (path === '/sitemap.xml') {
      const urls = ['/', '/privacy'].flatMap(page => {
        const en = `${origin}${page}`, es = `${en}?lang=es`;
        const alternates = `<xhtml:link rel="alternate" hreflang="en-US" href="${en}"/><xhtml:link rel="alternate" hreflang="es-US" href="${es}"/><xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`;
        return [en, es].map(url => `<url><loc>${url}</loc>${alternates}</url>`);
      });
      return finish(new NextResponse(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${indexable ? urls.join('') : ''}</urlset>`, { headers: { 'Content-Type': 'application/xml' } }), true, path);
    }
    const target = req.nextUrl.clone();
    if (decision === 'rewrite') target.pathname = path === '/' ? '/eat' : '/eat/privacy';
    const icon = ['/favicon.ico', '/eat/icon.png', '/eat/apple-icon.png'].includes(path);
    if (icon) target.pathname = '/brand/landing-icon.png';
    return finish(target.pathname !== path ? NextResponse.rewrite(target, { request: { headers } }) : NextResponse.next({ request: { headers } }), true, icon ? target.pathname : isLandingAsset(path, req.nextUrl.searchParams) || path.startsWith('/api/landing/') ? path : undefined);
  }
  if (path.startsWith('/eat') || path.startsWith('/api/landing') || path.startsWith('/media/')) return finish(new NextResponse(null, { status: 404 }), false);
  // Preserve the pre-chunk-A matcher bypass on staff, including static suffixes.
  if (isPublicPath(path)) return NextResponse.next({ request: { headers } });
  const jwt = req.cookies.get('co_ops_session')?.value;
  if (!jwt) return redirectToLogin(req);
  try {
    const claims = await verifyJwt(jwt);
    headers.set('x-co-user-id', claims.user_id);
    headers.set('x-co-app-role', claims.app_role);
    headers.set('x-co-role-level', String(claims.role_level));
    headers.set('x-co-session-id', claims.session_id);
    return NextResponse.next({ request: { headers } });
  } catch { return redirectToLogin(req); }
}
function redirectToLogin(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone(); url.pathname = '/'; url.search = '';
  if (req.nextUrl.pathname !== '/') url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/:path*'] };
