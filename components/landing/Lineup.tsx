import { products } from '@/lib/landing/products';
import { serverT } from '@/lib/i18n/server';
import type { Language } from '@/lib/i18n/types';
import { LineupPhoto } from './LineupPhoto';

export function Lineup({language}: {language: Language}) {
  return <ul data-lineup tabIndex={0} aria-label={serverT(language,'landing.lineup.browse')}
    className="mt-6 flex max-w-full snap-x snap-mandatory gap-5 overflow-x-auto rounded-xl pb-5 focus-visible:outline-2 focus-visible:outline-offset-4">
    {products.map(product => <li key={product.id} className="w-[280px] shrink-0 snap-start overflow-hidden rounded-xl border border-co-border bg-co-surface">
      <LineupPhoto src={product.image} small={product.smallImage} width={product.width} height={product.height} alt={serverT(language,'landing.lineup.photo',{name:product.name})}/>
      <h3 className="p-5 text-xl font-bold">{product.name}</h3>
      <p data-ingredients className="px-5 pb-5">{serverT(language,product.ingredientsKey,{butter:serverT(language,'landing.lineup.butter')})}</p>
    </li>)}
  </ul>;
}
