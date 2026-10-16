import { NextResponse, type NextRequest } from 'next/server';
import { verifyJwt } from './lib/auth';
import { loadLandingConfig } from './lib/landing/config';
import { resolveLandingLanguage } from './lib/landing/language-shared';
import { classifyLandingHost, configuredOrigin, landingPathDecision } from './lib/landing/host-shared';
import { LANDING_SECURITY_HEADERS, SECURITY_HEADERS } from './lib/security-headers';

const PUBLIC_PATHS = new Set(['/', '/verify', '/reset-password', '/api/auth/pin', '/api/auth/password', '/api/auth/logout', '/api/auth/verify', '/api/auth/password-reset-request', '/api/auth/password-reset', '/api/locations', '/api/users/login-options', '/order']);
function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || ['/order/', '/api/portal/', '/api/webhooks/', '/api/cron/', '/brand/', '/_next/static/'].some(prefix => path.startsWith(prefix)) || ['/favicon.ico', '/icon.png', '/apple-icon.png', '/opengraph-image.png', '/_next/image', '/robots.txt', '/sitemap.xml', '/window.svg', '/vercel.svg', '/next.svg', '/globe.svg', '/file.svg'].includes(path);
}
function finish(response: NextResponse, landing: boolean): NextResponse {
  for (const { key, value } of landing ? LANDING_SECURITY_HEADERS : SECURITY_HEADERS) response.headers.set(key, value);
  if (landing) {
    response.headers.set('Cache-Control', 'private, no-store');
    const vary = new Set((response.headers.get('Vary') ?? '').split(',').map(v => v.trim()).filter(Boolean));
    vary.add('Host');
    response.headers.set('Vary', [...vary].join(', '));
  }
  return response;
}
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const landingConfig = loadLandingConfig();
  const kind = classifyLandingHost(req.headers, landingConfig);
  const path = req.nextUrl.pathname;
  if (kind === 'invalid') return finish(new NextResponse(null, { status: 404 }), false);
  const headers = new Headers(req.headers);
  // No client-supplied routing/identity hints survive the public boundary.
  for (const key of [...headers.keys()]) if (key.startsWith('x-landing') || key.startsWith('x-co-')) headers.delete(key);
  if (kind === 'landing') {
    headers.set('x-landing-path', path === '/privacy' ? '/privacy' : '/');
    headers.set('x-landing-language', resolveLandingLanguage(req.nextUrl.searchParams.get('lang'), req.headers.get('accept-language')));
    const decision = landingPathDecision(path, req.nextUrl.searchParams);
    if (decision === 'deny') return finish(new NextResponse(null, { status: 404 }), true);
    if (decision === 'redirect') {
      const target = configuredOrigin(landingConfig.siteOrigin ?? undefined)!;
      target.pathname = path === '/eat' ? '/' : '/privacy';
      target.search = req.nextUrl.search;
      return finish(NextResponse.redirect(target, 301), true);
    }
    if (path === '/robots.txt') return finish(new NextResponse('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } }), true);
    if (path === '/sitemap.xml') return finish(new NextResponse('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', { headers: { 'Content-Type': 'application/xml' } }), true);
    const target = req.nextUrl.clone();
    if (decision === 'rewrite') target.pathname = path === '/' ? '/eat' : '/eat/privacy';
    if (['/favicon.ico', '/eat/icon.png', '/eat/apple-icon.png'].includes(path)) target.pathname = '/brand/co-icon.png';
    return finish(target.pathname !== path ? NextResponse.rewrite(target, { request: { headers } }) : NextResponse.next({ request: { headers } }), true);
  }
  if (path.startsWith('/eat') || path.startsWith('/api/landing')) return finish(new NextResponse(null, { status: 404 }), false);
  if (path !== '/' && path.endsWith('/')) {
    const canonical = req.nextUrl.clone(); canonical.pathname = path.replace(/\/+$/, '');
    return NextResponse.redirect(canonical, 308);
  }
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
