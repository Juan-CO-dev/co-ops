import { getLandingLinks } from '@/lib/landing/links';
import type { LandingConfig } from '@/lib/landing/config';
import type { Language } from '@/lib/i18n/types';
import { serverT } from '@/lib/i18n/server';
import { OrderLink } from './OrderLink';

export function Catering({config,language}:{config:LandingConfig;language:Language}) {
  const links=getLandingLinks(config);
  return <div className="mt-6 flex flex-wrap items-center gap-3">
    <OrderLink href={links.catering} placement="catering" event="CateringClick">{serverT(language,'landing.catering.order')}</OrderLink>
    <OrderLink href={links.inquiry} placement="catering" event="Lead" className="inline-flex min-h-11 items-center rounded-xl border-2 border-co-cta-text px-5 py-3 font-bold text-co-cta-text">{serverT(language,'landing.catering.inquiry')}</OrderLink>
  </div>;
}
