import {products} from '@/lib/landing/products';
import {fieldGuideAnchors} from '@/lib/landing/crave-motion-shared';
import {serverT} from '@/lib/i18n/server';
import type {Language} from '@/lib/i18n/types';
import {TexturePhoto} from './CraveScene';
export function FieldGuide({language}:{language:Language}) {
  const crunchy=products.find(product=>product.id==='crunchy-boi');
  if(!crunchy)throw new Error('Missing Field Guide product');
  return <div className="landing-v2-field-guide">
    <h3>{crunchy.name}</h3>
    <p data-field-ingredients>{serverT(language,crunchy.ingredientsKey)}</p>
    <div className="landing-v2-anatomy-frame"><figure className="landing-v2-anatomy">
      <div className="landing-v2-anatomy-labels" role="group" aria-labelledby="field-guide-labels-title">
        <span id="field-guide-labels-title" className="sr-only">{serverT(language,'landing.field-guide.labels')}</span>
        {fieldGuideAnchors.map(anchor=><span key={anchor.id} data-anatomy-label={anchor.id} data-anchor-x={anchor.x} data-anchor-y={anchor.y} style={{top:`${anchor.y*100}%`}}>{serverT(language,`landing.field-guide.${anchor.id}`)}</span>)}
      </div>
      <TexturePhoto kind="crossSection" alt={serverT(language,'landing.texture.cross-alt')}/>
      <figcaption>{serverT(language,'landing.field-guide.caption')}</figcaption>
    </figure></div>
  </div>;
}
