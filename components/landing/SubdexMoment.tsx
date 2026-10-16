import type { Language } from '@/lib/i18n/types';
import { serverT } from '@/lib/i18n/server';
import { subdexMedia } from '@/lib/landing/media';
import { HeroMotion } from './HeroMotion';

export function SubdexMoment({language}:{language:Language}) {
  return <div className="mt-6 max-w-xl">
    <HeroMotion src={subdexMedia.motion} testId="subdex-motion" pauseLabel={serverT(language,'landing.subdex.pause')} playLabel={serverT(language,'landing.subdex.play')}>
      <img src={subdexMedia.poster} alt={serverT(language,'landing.subdex.alt')} width={subdexMedia.width} height={subdexMedia.height} loading="lazy" decoding="async" className="block aspect-square h-auto w-full object-contain"/>
    </HeroMotion>
  </div>;
}
