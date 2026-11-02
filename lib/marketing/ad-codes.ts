import 'server-only';
import type { AuthContext } from '@/lib/session';
import { getServiceRoleClient } from '@/lib/supabase-server';
import { MARKETING_SCORECARD_ROLES } from './access-shared';
import { jsonError } from '@/lib/api-helpers';

export interface AdCodeRow { code: string; slot: number; active: boolean }
export type AdCodeRegistry = { state: 'ok'; rows: AdCodeRow[] } | { state: 'not_switched_on' | 'unavailable'; rows: [] };
export async function loadAdCodes(ctx: AuthContext): Promise<AdCodeRegistry> {
  if (!MARKETING_SCORECARD_ROLES.some(role => role === ctx.user.role)) throw new Error('role_not_allowed');
  if (process.env.MARKETING_SCORECARD !== '1') return { state: 'not_switched_on', rows: [] };
  // Probe 0289 too: the registry table itself predates the scorecard writers.
  try {
    const sb = getServiceRoleClient();
    const probe = await sb.from('marketing_milestones').select('id').limit(1);
    if (probe.error) return { state: 'unavailable', rows: [] };
    const rows: AdCodeRow[] = [];
    // Supabase's default response cap is 1000; the registry allows 1024 slots.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await sb.from('landing_ad_codes').select('code,slot,active').order('slot').range(offset, offset + 499);
      if (error) return { state: 'unavailable', rows: [] };
      rows.push(...((data ?? []) as AdCodeRow[]));
      if (!data || data.length < 500) break;
    }
    return { state: 'ok', rows };
  } catch { return { state: 'unavailable', rows: [] }; }
}

const REFUSALS = new Set(['code_invalid', 'code_reserved', 'code_taken', 'slots_exhausted', 'code_not_found', 'already_retired', 'actor_not_allowed']);
export function adCodeRpcError(error: { code?: string; message: string }): Response {
  if (error.code === '42P01' || error.code === '42883' || error.code === 'PGRST202') return jsonError(503, 'marketing_unavailable');
  if (REFUSALS.has(error.message)) return jsonError(error.message === 'actor_not_allowed' ? 403 : 409, error.message);
  return jsonError(500, 'internal_error');
}
