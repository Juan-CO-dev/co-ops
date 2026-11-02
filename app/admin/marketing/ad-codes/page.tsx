import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSessionFromHeaders } from '@/lib/session';
import { MARKETING_SCORECARD_ROLES } from '@/lib/marketing/access-shared';
import { loadAdCodes } from '@/lib/marketing/ad-codes';
import { adCodeCopy } from '@/lib/marketing/ad-code-copy';
import { AdCodesClient } from './AdCodesClient';

export default async function AdCodesPage() {
  const ctx = await requireSessionFromHeaders('/admin/marketing/ad-codes');
  if (!MARKETING_SCORECARD_ROLES.some(role => role === ctx.user.role)) notFound();
  const registry = await loadAdCodes(ctx);
  const copy = adCodeCopy[ctx.user.language];
  return <div className="mx-auto w-full min-w-0 max-w-2xl space-y-4">
    <Link className="inline-flex min-h-11 items-center underline" href="/admin/marketing">{copy.back}</Link>
    <h1 className="text-2xl font-semibold">{copy.title}</h1>
    {registry.state === 'ok' ? <AdCodesClient rows={registry.rows} language={ctx.user.language} />
      : <p role="status">{registry.state === 'not_switched_on' ? copy.off : copy.unavailable}</p>}
  </div>;
}
