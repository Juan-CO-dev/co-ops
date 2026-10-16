import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import NotFound from '@/app/not-found';
import { landingPathDecision } from '@/lib/landing/host-shared';

it('renders not-found chrome using assets allowed on the landing host', () => {
  const html = renderToStaticMarkup(createElement(NotFound));
  expect(html).toContain('Page not found');
  const images = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)];
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) expect(landingPathDecision(image[1]!, new URLSearchParams())).toBe('allow');
});
