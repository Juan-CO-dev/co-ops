import { expect, it, vi } from 'vitest';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { TranslationProvider } from '@/lib/i18n/provider';
import type { ToastLinkChoices } from '@/lib/catalog/jobs-shared';
vi.mock('@/components/admin/StepUpProvider', () => ({ useStepUp: () => ({ requestStepUp: vi.fn() }) }));
vi.mock('@/components/admin/useStepUpPost', () => ({ useStepUpPost: () => vi.fn() }));
import { ToastLinkSection } from '@/components/catalog/ToastLinkSection';
const base: ToastLinkChoices = { menuItemId: 'menu', shopId: 'shop', status: 'suggested', choices: [{ guid: 'guid', name: 'Sandwich', price: 12 }], suggestion: { guid: 'guid', name: 'Sandwich', price: 12 }, linked: [] };
for (const language of ['en', 'es'] as const)
    it(`renders translated explicit confirmation and 44px controls (${language})`, () => { const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: language, children: jsx(ToastLinkSection, { menuItemId: 'menu', shopId: 'shop', initial: base }) })); expect(html).toContain('Sandwich'); expect(html).toContain('type="checkbox"'); expect(html).toContain('disabled=""'); expect(html).not.toContain('catalog.jobs.toast'); expect(html).not.toMatch(/<button(?![^>]*min-h-\[44px\])[^>]*>/); });
it('unconfigured still explains saved sandwich and has no write control', () => { const html = renderToStaticMarkup(jsx(TranslationProvider, { initialLanguage: 'en', children: jsx(ToastLinkSection, { menuItemId: 'menu', shopId: 'shop', initial: { ...base, status: 'unavailable', choices: [], suggestion: null } }) })); expect(html).not.toContain('type="checkbox"'); expect(html).toContain('saved'); });
