import { serverT } from '@/lib/i18n/server';
import type { Language } from '@/lib/i18n/types';
import type { LandingStore } from '@/lib/landing/stores';
import { products } from '@/lib/landing/products';
import { spinMedia } from '@/lib/landing/media';
import { orderDetailsByStore, type OrderDetails } from '@/lib/landing/order-details';
import { OrderSheet } from './OrderSheet';

/** "Order the Crunchy Boi" outside the select screen (end of the crunch story, the Field
 * Guide's six-of-six): the same two-shop sheet, its own placement, item "crunchy-boi". */
export function CrunchyOrder({language,stores,placement,label,now,details}:{language:Language;stores:readonly LandingStore[];placement:'crave'|'guide';label:string;now?:Date;details?:OrderDetails}) {
  const crunchy=products.find(product=>product.id==='crunchy-boi');
  if(!crunchy||!stores.length)return null;
  const lines=details??orderDetailsByStore(stores,language,now);
  const shops=stores.map(store=>({key:store.key,orderUrl:store.orderUrl,label:serverT(language,'landing.order',{shop:store.orderLabel}),detail:lines[store.key]?.line??store.street}));
  return <OrderSheet shops={shops} placement={placement} item="crunchy-boi" triggerLabel={label} title={serverT(language,'landing.lineup.sheet-title',{name:crunchy.name})}
    closeLabel={serverT(language,'landing.lineup.close')} eager={placement==='guide'} spin={{...spinMedia,alt:serverT(language,'landing.lineup.photo',{name:crunchy.name})}}/>;
}
