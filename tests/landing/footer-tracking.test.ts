import { isValidElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { Footer } from '@/components/landing/Footer';
import { OrderLink } from '@/components/landing/OrderLink';
import { loadLandingConfig } from '@/lib/landing/config';
import { NearbyShop } from '@/components/landing/NearbyShop';
import { projectLandingStores } from '@/lib/landing/stores';
const {dispatch} = vi.hoisted(() => ({dispatch:vi.fn()}));
vi.mock('@/components/landing/TrackingProvider', () => ({useLandingTracking:()=>({dispatch})}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),useState:(initial:unknown)=>[typeof initial==='function'?initial():initial,vi.fn()],useEffect:()=>{}}));
it('DoorDash invokes the tracked footer link while Uber Eats is scoped to Dupont', () => {
  const config = {...loadLandingConfig(), footerLinks:[{key:'uber-eats' as const,url:'https://example.test/uber'},{key:'doordash' as const,url:'https://example.test/dash'}]};
  const links: ReturnType<typeof OrderLink>[] = [];
  function walk(node:ReactNode) {
    if (Array.isArray(node)) {node.forEach(walk);return;}
    if (!isValidElement<{children?:ReactNode}>(node)) return;
    if (node.type === OrderLink) links.push(OrderLink(node.props as Parameters<typeof OrderLink>[0]));
    else walk(node.props.children);
  }
  walk(Footer({config,stores:[],language:'en'}));
  expect(links).toHaveLength(1);
  // A tapped link also gets the decorative P1 hop (a data attribute on the element itself).
  const tap=()=>({currentTarget:{dataset:{},offsetWidth:0}});
  for (const link of links) link.props.onClick(tap());
  expect(dispatch.mock.calls).toEqual([
    ['OrderClick',{store:undefined,placement:'footer',vendor:'doordash'}],
  ]);
  const stores=projectLandingStores([{code:'MEP',name:'',address:null,phone:null},{code:'EM',name:'',address:null,phone:null}],config);
  walk(NearbyShop({stores,language:'en',labels:{nearest:'Nearest',locating:'Locating',unavailable:'Unavailable',straightLine:'Straight line',distance:'{distance} miles',offer:'Offer',call:{},order:{},uberEats:'Uber Eats (Dupont)'}}));
  const uber=links.filter(link=>link.props.href==='https://example.test/uber');
  expect(uber).toHaveLength(1);
  uber[0]!.props.onClick(tap());
  expect(dispatch).toHaveBeenLastCalledWith('OrderClick',{store:'dupont',placement:'shops',vendor:'ubereats'});
});
