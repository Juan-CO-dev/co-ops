import type { NextRequest } from 'next/server';
import { assertSameOrigin } from '@/lib/portal/csrf';
import { requireSession } from '@/lib/session';
import { MARKETING_SCORECARD_ROLES } from '@/lib/marketing/access-shared';
import { assertStepUp } from '@/lib/admin/step-up';
import { jsonError, jsonOk, parseJsonBody } from '@/lib/api-helpers';
import { validAdCandidate } from '@/lib/landing/ad-codes-shared';
import { getServiceRoleClient } from '@/lib/supabase-server';
import { adCodeRpcError } from '@/lib/marketing/ad-codes';
import { audit } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const origin = assertSameOrigin(req);
  if (origin) return origin;
  const ctx = await requireSession(req, '/api/admin/marketing/ad-codes');
  if (ctx instanceof Response) return ctx;
  if (!MARKETING_SCORECARD_ROLES.some(role => role === ctx.user.role)) return jsonError(403, 'role_not_allowed');
  if (process.env.MARKETING_SCORECARD !== '1') return jsonError(503, 'marketing_unavailable');
  const su = assertStepUp(ctx, 'A');
  if (!su.ok) return jsonError(403, su.code);
  const body = await parseJsonBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== 'object' || !('code' in body) || !validAdCandidate(body.code)) return jsonError(400, 'code_invalid');
  const code = body.code;
  const { data, error } = await getServiceRoleClient().rpc('landing_ad_code_create', { p_actor: ctx.user.id, p_code: code });
  if (error) return adCodeRpcError(error);
  await audit({ actorId: ctx.user.id, actorRole: ctx.user.role, action: 'landing_ad_code.create', resourceTable: 'landing_ad_codes', resourceId: null, metadata: { code, slot: data }, ipAddress: null, userAgent: null });
  return jsonOk({ code, slot: data }, 201);
}
