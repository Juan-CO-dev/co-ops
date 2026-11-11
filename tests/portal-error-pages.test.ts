import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import NotFound from '@/app/order/not-found';
import OrderError from '@/app/order/error';
import { portalPathDecision } from '@/lib/landing/host-shared';

it('portal error and not-found chrome offer bilingual recovery within the portal', () => {
  for (const html of [
    renderToStaticMarkup(createElement(NotFound)),
    renderToStaticMarkup(createElement(OrderError, {error:new Error('private'),reset:() => {}})),
  ]) {
    expect(html).toContain('href="/order"');
    expect(html).not.toContain('/dashboard');
    expect(html).not.toContain('private');
    expect(html).toMatch(/P\u00e1gina no encontrada|Algo sali\u00f3 mal/);
    const images = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) expect(portalPathDecision(img[1]!)).toBe('allow');
  }
});
