"use client";
import type { ReactNode } from 'react';
import type { LandingAction } from '@/lib/landing/tracking-client';
import type { LandingPlacement } from '@/lib/landing/tracking-schema-shared';
import { useLandingTracking } from './TrackingProvider';
export function OrderLink({href,children,store,placement,event='OrderClick',vendor,className,ariaLabel}:{href:string;children:ReactNode;store?:string;placement:LandingPlacement;event?:LandingAction;vendor?:string;className?:string;ariaLabel?:string}) {
  const tracking=useLandingTracking();
  return <a data-landing-placement={placement} href={href} rel="noopener" referrerPolicy="origin" aria-label={ariaLabel} className={className??'inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-[var(--co-cta)] px-5 py-3 text-[var(--co-text)]'} onClick={()=>tracking.dispatch(event,{store,placement,vendor})}>{children}</a>;
}
