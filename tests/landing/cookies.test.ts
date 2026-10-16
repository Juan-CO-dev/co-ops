import { describe, it, expect, vi } from 'vitest';
import { NextResponse, NextRequest } from 'next/server';
import { applySessionCookie, requireSession } from '@/lib/session';
import { applyPortalCookie, clearPortalCookie, requireCustomerSession } from '@/lib/portal/session';
import { shopCookieAssignment } from '@/lib/shop-context-shared';
function hostOnly(response: NextResponse) {
  const cookie = response.headers.get('set-cookie')!;
  expect(cookie).toBeTruthy(); expect(cookie).not.toMatch(/domain=/i); expect(cookie).toContain('Path=/');
}
describe('actual session cookie response serialization', () => {
  it('staff issuance and invalid session clearing remain host-only', async () => {
    const response = NextResponse.json({});
    applySessionCookie(response, { sessionId:'fixture', cookieName:'co_ops_session', jwt:'fixture', cookieMaxAgeSeconds:300 }); hostOnly(response);
    const invalid=await requireSession(new NextRequest('https://staff.example.test/api/test'), '/api/test');
    expect(invalid).toBeInstanceOf(NextResponse); hostOnly(invalid as NextResponse);
  });
  it('portal issuance, clearing and invalid session remain host-only', async () => {
    hostOnly(applyPortalCookie(NextResponse.json({}),{cookieName:'co_ops_portal',jwt:'fixture',cookieMaxAgeSeconds:300}));
    hostOnly(clearPortalCookie(NextResponse.json({})));
    hostOnly(await requireCustomerSession(new NextRequest('https://staff.example.test/api/test')) as NextResponse);
  });
  it('shop preference has no Domain',()=> { expect(shopCookieAssignment('fixture', true)).not.toMatch(/domain=/i); });
});
