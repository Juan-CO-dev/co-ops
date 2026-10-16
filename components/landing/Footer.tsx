import type { LandingConfig } from '@/lib/landing/config';
import type { LandingStore } from '@/lib/landing/stores';
import type { Language } from '@/lib/i18n/types';
import { serverT } from '@/lib/i18n/server';

export function Footer({config,stores,language}:{config:LandingConfig;stores:readonly LandingStore[];language:Language}) {
  const delivery=(key:string)=>key==='uber-eats'||key==='doordash';
  const links=[...config.footerLinks].sort((a,b)=>Number(delivery(a.key))-Number(delivery(b.key)));
  return <footer className="mt-6">
    <div className="flex flex-wrap gap-x-10 gap-y-4">{stores.filter(store=>store.address).map(store=><address key={store.key} className="not-italic"><span className="font-bold">{store.name}</span><br/>{store.address}</address>)}</div>
    <a href={`/privacy?lang=${language}`} className="mt-4 inline-flex min-h-11 items-center underline">{serverT(language,'landing.privacy.link')}</a>
    {links.length>0 && <nav aria-label={serverT(language,'landing.footer.links')} className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">{links.map(link=><a key={link.key} href={link.url} rel="noopener" referrerPolicy="origin" className={`inline-flex min-h-11 min-w-11 items-center underline ${delivery(link.key)?'text-sm':''}`}>{serverT(language,`landing.footer.${link.key}`)}</a>)}</nav>}
  </footer>;
}
