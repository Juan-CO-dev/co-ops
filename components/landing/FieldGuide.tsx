import {products} from '@/lib/landing/products';
import {fieldGuideAnchors} from '@/lib/landing/crave-motion-shared';
import {spriteMedia} from '@/lib/landing/media';
import {serverT} from '@/lib/i18n/server';
import type {Language} from '@/lib/i18n/types';
import type {LandingStore} from '@/lib/landing/stores';
import {FieldGuideFigure} from './FieldGuideFigure';
import {CrunchyOrder} from './CrunchyOrder';
import type {OrderDetails} from '@/lib/landing/order-details';
/** The six words + leader lines carry the ingredients (the select screen lists them in full);
 * finding all six turns into the order action. */
export function FieldGuide({language,stores=[],now,details}:{language:Language;stores?:readonly LandingStore[];now?:Date;details?:OrderDetails}) {
  const crunchy=products.find(product=>product.id==='crunchy-boi');
  if(!crunchy)throw new Error('Missing Field Guide product');
  const labels=Object.fromEntries(fieldGuideAnchors.map(anchor=>[anchor.id,serverT(language,`landing.field-guide.${anchor.id}`)])) as Record<(typeof fieldGuideAnchors)[number]['id'],string>;
  return <div className="landing-v2-field-guide">
    <h3>{crunchy.name}</h3>
    <FieldGuideFigure labels={labels} groupLabel={serverT(language,'landing.field-guide.labels')} counter={serverT(language,'landing.field-guide.counter')}
      crossAlt={serverT(language,'landing.texture.cross-alt')} caption={serverT(language,'landing.field-guide.caption')} pickups={spriteMedia.pickups}
      ctaLabel={serverT(language,'landing.lineup.order',{name:crunchy.name})}
      cta={<CrunchyOrder language={language} stores={stores} placement="guide" label={serverT(language,'landing.lineup.order',{name:crunchy.name})} now={now} details={details}/>}/>
  </div>;
}
