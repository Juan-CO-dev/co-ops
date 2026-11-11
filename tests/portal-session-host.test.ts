import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { applyPortalCookie, requireCustomerSession } from '@/lib/portal/session';
import { signCustomerJwt, verifyCustomerJwt, PORTAL_COOKIE_NAME } from '@/lib/portal/auth';
import { SignJWT } from 'jose';

// Any accidental database access fails this test; only cookie and JWT boundaries run.
vi.mock('@/lib/supabase-server', () => ({ getServiceRoleClient: () => { throw new Error('Database access forbidden'); } }));
afterEach(() => vi.unstubAllEnvs());
it('sets a host-only customer cookie on the portal origin', () => {
  vi.stubEnv('NODE_ENV','production');
  const response=applyPortalCookie(NextResponse.json({ok:true}),{cookieName:PORTAL_COOKIE_NAME,jwt:'synthetic',cookieMaxAgeSeconds:2592000});
  const cookie=response.headers.get('set-cookie')!;
  expect(cookie).toContain('co_ops_portal=synthetic');expect(cookie).toContain('Path=/');expect(cookie).toContain('HttpOnly');expect(cookie).toContain('Secure');expect(cookie).toContain('SameSite=lax');expect(cookie).not.toMatch(/domain=/i);
});
it('ignores a staff cookie before any database call', async () => {
  const result=await requireCustomerSession(new NextRequest('https://catering.example.test/api/portal/order/draft/lines',{headers:{cookie:'co_ops_session=synthetic'}}));
  expect(result).toBeInstanceOf(NextResponse);expect((result as NextResponse).status).toBe(401);
});
it('accepts customer JWT issuer but rejects staff issuer even under the customer cookie name', async () => {
  const claims={customer_id:'synthetic-customer',email:'test@example.test',session_id:'synthetic-session'};
  expect((await verifyCustomerJwt(await signCustomerJwt(claims))).customer_id).toBe(claims.customer_id);
  const wrongIssuer=await new SignJWT(claims).setProtectedHeader({alg:'HS256'}).setIssuer('co-ops').setExpirationTime('1h').sign(Buffer.from(process.env.AUTH_JWT_SECRET!,'hex'));
  await expect(verifyCustomerJwt(wrongIssuer)).rejects.toThrow();
  const result=await requireCustomerSession(new NextRequest('https://catering.example.test/api/portal/order/draft/lines',{headers:{cookie:`co_ops_portal=${wrongIssuer}`}}));
  expect((result as NextResponse).status).toBe(401);
});
