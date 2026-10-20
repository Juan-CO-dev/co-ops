import { TexturePhoto } from './CraveScene';
import { getLandingLinks } from '@/lib/landing/links';
import type { LandingConfig } from '@/lib/landing/config';
import type { Language } from '@/lib/i18n/types';
import { serverT } from '@/lib/i18n/server';
import { spriteMedia } from '@/lib/landing/media';
import { OrderLink } from './OrderLink';

/** "Co-op mode": a real office spread, one strong order action, a light way to ask. */
export function Catering({config,language}:{config:LandingConfig;language:Language}) {
  const links=getLandingLinks(config);
  const basket=spriteMedia.basket;
  return <div className="landing-v3-catering">
    <p className="landing-v3-coop"><span>{serverT(language,'landing.catering.mode')}</span></p>
    {/* Nothing is layered over food: the spread, then the order action (walker beside it), then the box photo beside the points. */}
    <div className="landing-v3-catering-spread"><TexturePhoto kind="catering" alt={serverT(language,'landing.catering.spread-alt')}/></div>
    <div className="landing-v4-catering-act">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={basket.src} width={basket.width} height={basket.height} alt="" aria-hidden="true" loading="lazy" decoding="async" className="landing-v3-pixel landing-v3-catering-walker"/>
      <OrderLink href={links.catering} placement="catering" event="CateringClick" className="landing-v3-cta">{serverT(language,'landing.catering.order')}</OrderLink>
    </div>
    <OrderLink href={links.inquiry} placement="catering" event="Lead" className="landing-v3-ask">{serverT(language,'landing.catering.inquiry')}</OrderLink>
    <div className="landing-v3-catering-row">
      <div className="landing-v3-catering-box"><TexturePhoto kind="cateringBox" alt={serverT(language,'landing.catering.box-alt')}/></div>
      <div className="landing-v3-catering-side">
        <ul className="landing-v3-catering-points">
          <li>{serverT(language,'landing.catering.point-lineup')}</li>
          <li>{serverT(language,'landing.catering.point-online')}</li>
          <li>{serverT(language,'landing.catering.point-help')}</li>
        </ul>
      </div>
    </div>
  </div>;
}
