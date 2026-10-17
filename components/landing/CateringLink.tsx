import type { LandingConfig } from '@/lib/landing/config';
import type { Language } from '@/lib/i18n/types';
import { serverT } from '@/lib/i18n/server';
import { getLandingLinks } from '@/lib/landing/links';
import { OrderLink } from './OrderLink';

/** Secondary first-screen action, outside the prototype's two shop buttons. */
export function CateringLink({config,language}:{config:LandingConfig;language:Language}) {
  return <OrderLink href={getLandingLinks(config).catering} placement="hero" event="CateringClick" className="landing-v2-catering-link">{serverT(language,'landing.catering.short')}</OrderLink>;
}
