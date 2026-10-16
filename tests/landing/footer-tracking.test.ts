import { isValidElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { Footer } from '@/components/landing/Footer';
import { OrderLink } from '@/components/landing/OrderLink';
import { loadLandingConfig } from '@/lib/landing/config';
const {dispatch} = vi.hoisted(() => ({dispatch:vi.fn()}));
vi.mock('@/components/landing/TrackingProvider', () => ({useLandingTracking:()=>({dispatch})}));
it('delivery links invoke the tracked footer OrderLink with the canonical vendor and no invented store', () => {
  const config = {...loadLandingConfig(), footerLinks:[{key:'uber-eats' as const,url:'https://example.test/uber'},{key:'doordash' as const,url:'https://example.test/dash'}]};
  const links: ReturnType<typeof OrderLink>[] = [];
  function walk(node:ReactNode) {
    if (Array.isArray(node)) {node.forEach(walk);return;}
    if (!isValidElement<{children?:ReactNode}>(node)) return;
    if (node.type === OrderLink) links.push(OrderLink(node.props as Parameters<typeof OrderLink>[0]));
    else walk(node.props.children);
  }
  walk(Footer({config,stores:[],language:'en'}));
  expect(links).toHaveLength(2);
  for (const link of links) link.props.onClick();
  expect(dispatch.mock.calls).toEqual([
    ['OrderClick',{store:undefined,placement:'footer',vendor:'ubereats'}],
    ['OrderClick',{store:undefined,placement:'footer',vendor:'doordash'}],
  ]);
});
