import { products } from '@/lib/landing/products';
import { serverT } from '@/lib/i18n/server';
import type { Language } from '@/lib/i18n/types';
import type { LandingStore } from '@/lib/landing/stores';
import { spinMedia, spriteMedia } from '@/lib/landing/media';
import { rosterOrder } from '@/lib/landing/fighter-select-shared';
import { FighterSelect } from './FighterSelect';

export function Lineup({language,stores}: {language: Language;stores: readonly LandingStore[]}) {
  const fighters=rosterOrder(products).map(product=>({id:product.id,name:product.name,image:product.image,smallImage:product.smallImage,width:product.width,height:product.height,
    ingredients:serverT(language,product.ingredientsKey,{butter:serverT(language,'landing.lineup.butter')}),photoAlt:serverT(language,'landing.lineup.photo',{name:product.name})}));
  const shops=stores.map(store=>({key:store.key,name:store.name,address:store.address,orderUrl:store.orderUrl,orderLabel:serverT(language,'landing.order',{shop:store.orderLabel})}));
  return <FighterSelect fighters={fighters} shops={shops} spin={spinMedia} sprites={{idle:spriteMedia.p1Idle,jump:spriteMedia.p1Jump,selected:spriteMedia.selected}}
    labels={{order:serverT(language,'landing.lineup.order'),sheetTitle:serverT(language,'landing.lineup.sheet-title'),close:serverT(language,'landing.lineup.close'),auto:serverT(language,'landing.lineup.auto'),
      p1:serverT(language,'landing.lineup.p1'),spin:serverT(language,'landing.lineup.spin'),spinValue:serverT(language,'landing.lineup.spin-value'),browse:serverT(language,'landing.lineup.browse')}}/>;
}
