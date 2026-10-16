import {resolveOffer,type LandingOffer} from '@/lib/landing/offers';
export function OfferCode({ad,store,label,offers,now}:{ad:string;store:string;label:string;offers?:readonly LandingOffer[];now?:number}) {
  const offer=resolveOffer(ad,store,offers,now);
  if(!offer)return null;
  return <aside><p>{label.replace('{code}',offer.code)}</p><p>{offer.terms}</p></aside>;
}
