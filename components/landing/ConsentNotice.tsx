"use client";
import { useState } from 'react';
import type { ConsentChoice } from '@/lib/landing/consent-shared';
export interface ConsentLabels { notice:string; accept:string; reject:string; settings:string; withdraw:string; privacy:string }
export function ConsentNotice({choice,labels,onChoose}:{choice:ConsentChoice; labels:ConsentLabels; onChoose:(choice:'accepted'|'rejected')=>void}) {
  const [open,setOpen]=useState(false);
  const button='inline-flex min-h-11 min-w-11 items-center justify-center rounded border px-4 py-2 focus-visible:outline-2';
  return <aside className="mx-auto max-w-5xl p-4" aria-label={labels.settings}>
    <button type="button" className={button} onClick={()=>setOpen(v=>!v)} aria-expanded={open||choice==='unknown'}>{labels.settings}</button>
    {(open||choice==='unknown') && <div className="mt-3 rounded border bg-[var(--co-bg)] p-4" data-landing-consent>
      <p>{labels.notice} <a href="/privacy" className="inline-flex min-h-11 items-center underline">{labels.privacy}</a></p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} onClick={()=>{onChoose('accepted');setOpen(false);}}>{labels.accept}</button>
        <button type="button" className={button} onClick={()=>{onChoose('rejected');setOpen(false);}}>{choice==='accepted'?labels.withdraw:labels.reject}</button>
      </div>
    </div>}
  </aside>;
}
