'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Language } from '@/lib/i18n/types';
import type { AdCodeRow } from '@/lib/marketing/ad-codes';
import { adCodeCopy, adCodeRefusal } from '@/lib/marketing/ad-code-copy';
import { useStepUp } from '@/components/admin/StepUpProvider';
import { useStepUpPost } from '@/components/admin/useStepUpPost';

export function AdCodesClient({ rows, language }: { rows: AdCodeRow[]; language: Language }) {
  const copy = adCodeCopy[language];
  const router = useRouter();
  const post = useStepUpPost();
  const { requestStepUp } = useStepUp();
  const [creating, setCreating] = useState(false);
  const [retiring, setRetiring] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(retireCode?: string) {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      if (await requestStepUp(retireCode ? 'B' : 'A') !== 'ok') return;
      const result = await post(retireCode ? `/api/admin/marketing/ad-codes/${encodeURIComponent(retireCode)}/retire` : '/api/admin/marketing/ad-codes', retireCode ? {} : { code });
      if (!result.ok) { setMessage(adCodeRefusal(language, result.code)); return; }
      setMessage(copy.saved); setCreating(false); setRetiring(null); setCode(''); router.refresh();
    } catch { setMessage(copy.error); }
    finally { setBusy(false); }
  }
  const button = 'inline-flex min-h-11 items-center justify-center rounded border px-3 disabled:opacity-50';
  return <div className="min-w-0 space-y-4">
    <button type="button" className={button} disabled={busy} aria-expanded={creating} onClick={() => setCreating(!creating)}>{copy.add}</button>
    {creating && <form className="admin-form space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="block" htmlFor="ad-code">{copy.code}</label>
      <input id="ad-code" className="min-h-11 w-full min-w-0 rounded border px-3" value={code} onChange={event => setCode(event.target.value)} required maxLength={64} pattern="[a-z0-9][a-z0-9_-]{0,63}" aria-describedby="ad-code-hint" disabled={busy} />
      <p id="ad-code-hint">{copy.hint}</p>
      <button className={button} disabled={busy} type="submit">{copy.save}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    {!rows.length && <p>{copy.empty}</p>}
    <ul className="space-y-3">{rows.map(row => <li key={row.code} className="min-w-0 rounded border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><code className="break-all">{row.code}</code><span>{row.active ? copy.active : copy.retired}</span></div>
      {row.active && row.code !== 'unattributed' && <button type="button" className={button} disabled={busy} aria-expanded={retiring === row.code} onClick={() => setRetiring(row.code)}>{copy.retire}</button>}
      {retiring === row.code && <div className="space-y-2"><p>{copy.confirm}</p><div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} type="button" onClick={() => void save(row.code)}>{copy.retire}</button>
        <button className={button} disabled={busy} type="button" onClick={() => setRetiring(null)}>{copy.cancel}</button>
      </div></div>}
    </li>)}</ul>
  </div>;
}
