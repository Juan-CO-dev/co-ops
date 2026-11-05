"use client";
import type { ReactNode } from 'react';
import type { LandingAction } from '@/lib/landing/tracking-client';
import type { LandingItem, LandingPlacement } from '@/lib/landing/tracking-schema-shared';
import { hop } from '@/lib/landing/hop-shared';
import { useLandingTracking } from './TrackingProvider';
export function OrderLink({href,children,store,placement,event='OrderClick',vendor,item,mode,dataDirections,className,ariaLabel}:{href:string;children:ReactNode;store?:string;placement:LandingPlacement;event?:LandingAction;vendor?:string;mode?:'pickup'|'delivery';dataDirections?:string;item?:LandingItem;className?:string;ariaLabel?:string}) {
  const tracking=useLandingTracking();
  return <a data-directions={dataDirections} data-landing-mode={mode} data-landing-placement={event === 'OrderClick' || event === 'CateringClick' ? placement : undefined} href={href} rel="noopener" referrerPolicy="origin" aria-label={ariaLabel} className={className??'inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-[var(--co-cta)] px-5 py-3 text-[var(--co-text)]'} onClick={click=>{tracking.dispatch(event,{store,placement,vendor,...(mode?{mode}:{}),...(item?{item}:{})});hop(click.currentTarget);}}>{children}</a>;
}
