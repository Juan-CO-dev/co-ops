import {products} from '@/lib/landing/products';
import {fieldGuideAnchors} from '@/lib/landing/crave-motion-shared';
import {spriteMedia} from '@/lib/landing/media';
import {serverT} from '@/lib/i18n/server';
import type {Language} from '@/lib/i18n/types';
import {FieldGuideFigure} from './FieldGuideFigure';
export function FieldGuide({language}:{language:Language}) {
  const crunchy=products.find(product=>product.id==='crunchy-boi');
  if(!crunchy)throw new Error('Missing Field Guide product');
  const labels=Object.fromEntries(fieldGuideAnchors.map(anchor=>[anchor.id,serverT(language,`landing.field-guide.${anchor.id}`)])) as Record<(typeof fieldGuideAnchors)[number]['id'],string>;
  return <div className="landing-v2-field-guide">
    <h3>{crunchy.name}</h3>
    <p data-field-ingredients>{serverT(language,crunchy.ingredientsKey)}</p>
    <FieldGuideFigure labels={labels} groupLabel={serverT(language,'landing.field-guide.labels')} counter={serverT(language,'landing.field-guide.counter')}
      crossAlt={serverT(language,'landing.texture.cross-alt')} caption={serverT(language,'landing.field-guide.caption')} pickups={spriteMedia.pickups}/>
  </div>;
}
