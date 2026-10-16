import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ToastLinkChoices } from '@/lib/catalog/jobs-shared';
// A bounded hook harness runs the real handlers without a browser dependency.
const h = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown>, post: vi.fn(), step: vi.fn(), fetch: vi.fn() }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(), useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots))
        h.slots[i] = initial; return [h.slots[i], (v: unknown) => { h.slots[i] = v; }]; }, useRef: (initial: unknown) => { const i = h.cursor++; if (!(i in h.slots))
        h.slots[i] = { current: initial }; return h.slots[i]; }, useCallback: (fn: unknown) => fn, useEffect: (fn: () => unknown) => { h.effects.push(fn); } }));
vi.mock('@/lib/i18n/provider', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/admin/StepUpProvider', () => ({ useStepUp: () => ({ requestStepUp: h.step }) }));
vi.mock('@/components/admin/useStepUpPost', () => ({ useStepUpPost: () => h.post }));
import { ToastLinkSection } from '@/components/catalog/ToastLinkSection';
type Node = {
    type: unknown;
    props: Record<string, any>;
};
const initial: ToastLinkChoices = { menuItemId: 'menu', shopId: 'shop', status: 'suggested', choices: [{ guid: 'guid', name: 'Sandwich', price: 12 }], suggestion: { guid: 'guid', name: 'Sandwich', price: 12 }, linked: [] };
function render(shopId = 'shop') { h.cursor = 0; h.effects = []; const wrapper = ToastLinkSection({ menuItemId: 'menu', shopId, initial: { ...initial, shopId } }); return (wrapper.type as Function)(wrapper.props) as Node; }
function find(node: unknown, predicate: (n: Node) => boolean): Node | undefined { if (!node || typeof node !== 'object')
    return; if (Array.isArray(node)) {
    for (const child of node) {
        const found = find(child, predicate);
        if (found)
            return found;
    }
    return;
} const n = node as Node; if (predicate(n))
    return n; return find(n.props?.children, predicate); }
const confirm = (n: Node) => n.type === 'button' && n.props.children === 'catalog.jobs.toast.confirm';
async function flush() { for (let i = 0; i < 12; i++)
    await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.cursor = 0; h.effects = []; vi.clearAllMocks(); h.step.mockResolvedValue('ok'); h.post.mockResolvedValue({ ok: true }); h.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...initial, status: 'linked', choices: [], suggestion: null, linked: initial.choices }) }); vi.stubGlobal('fetch', h.fetch); });
afterEach(() => vi.unstubAllGlobals());
it('requires checkbox, requests Tier A, posts explicit selected pair and refreshes', async () => { let tree = render(); expect(find(tree, confirm)?.props.disabled).toBe(true); find(tree, n => n.type === 'input' && n.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); tree = render(); expect(find(tree, confirm)?.props.disabled).toBe(false); find(tree, confirm)!.props.onClick(); await flush(); expect(h.step).toHaveBeenCalledWith('A'); expect(h.post).toHaveBeenCalledWith('/api/admin/catalog/menu-item/menu/toast', { locationId: 'shop', toastItemGuid: 'guid', confirmed: true }); expect(h.fetch).toHaveBeenCalledWith('/api/admin/catalog/menu-item/menu/toast?location=shop', { cache: 'no-store' }); tree = render(); expect(find(tree, confirm)).toBeUndefined(); });
it('discarding old keyed scope prevents a delayed write result refreshing the new shop', async () => { let resolve!: (value: unknown) => void; h.post.mockReturnValue(new Promise(r => resolve = r)); let tree = render(); const cleanup = h.effects[0]!() as () => void; find(tree, n => n.type === 'input' && n.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); tree = render(); find(tree, confirm)!.props.onClick(); await flush(); expect(h.post).toHaveBeenCalledOnce(); cleanup(); h.slots = []; render('other'); h.effects[0]!(); resolve({ ok: true }); await flush(); expect(h.fetch).not.toHaveBeenCalled(); expect(find(render('other'), confirm)?.props.disabled).toBe(true); });
it('cancelled step-up preserves selection and does not write', async () => { h.step.mockResolvedValue('cancelled'); let tree = render(); find(tree, n => n.type === 'input' && n.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); tree = render(); find(tree, confirm)!.props.onClick(); await flush(); expect(h.post).not.toHaveBeenCalled(); expect(find(render(), n => n.type === 'select')?.props.value).toBe('guid'); });
it('search editing clears the reviewed confirmation', async () => { let tree = render(); find(tree, n => n.type === 'input' && n.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); tree = render(); find(tree, n => n.type === 'input' && n.props.type === 'search')!.props.onChange({ target: { value: 'different' } }); expect(find(render(), confirm)?.props.disabled).toBe(true); });
it('a refused confirmation shows write feedback rather than a read failure', async () => { h.post.mockResolvedValue({ ok: false, code: 'generic' }); let tree = render(); find(tree, n => n.type === 'input' && n.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); tree = render(); find(tree, confirm)!.props.onClick(); await flush(); expect(find(render(), n => n.props?.role === 'alert')?.props.children).toBe('catalog.jobs.toast.save_error'); expect(h.fetch).not.toHaveBeenCalled(); });
