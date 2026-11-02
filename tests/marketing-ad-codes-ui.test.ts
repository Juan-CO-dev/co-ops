// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdCodesClient } from '@/app/admin/marketing/ad-codes/AdCodesClient';
import { adCodeCopy } from '@/lib/marketing/ad-code-copy';

const mocks = vi.hoisted(() => ({ prompt: vi.fn(), post: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/components/admin/StepUpProvider', () => ({ useStepUp: () => ({ requestStepUp: mocks.prompt }) }));
vi.mock('@/components/admin/useStepUpPost', () => ({ useStepUpPost: () => mocks.post }));
beforeEach(() => { vi.clearAllMocks(); mocks.prompt.mockResolvedValue('ok'); mocks.post.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

it('creates only after Tier A confirmation and refreshes successful writes', async () => {
  render(createElement(AdCodesClient, { rows: [], language: 'en' }));
  expect(screen.queryByLabelText('Ad code')).toBeNull();
  fireEvent.click(screen.getByText('Create ad code'));
  fireEvent.change(screen.getByLabelText('Ad code'), { target: { value: 'new-code' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/admin/marketing/ad-codes', { code: 'new-code' }));
  expect(mocks.prompt).toHaveBeenCalledWith('A');
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
});
it('retirement discloses permanence, prompts Tier B, and translates refusal', async () => {
  mocks.post.mockResolvedValue({ ok: false, code: 'code_not_found' });
  render(createElement(AdCodesClient, { rows: [{ code: 'new-code', active: true, slot: 2 }], language: 'es' }));
  fireEvent.click(screen.getByText(adCodeCopy.es.retire));
  expect(screen.getByText(adCodeCopy.es.confirm)).toBeTruthy();
  fireEvent.click(screen.getAllByText(adCodeCopy.es.retire)[1]!);
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/admin/marketing/ad-codes/new-code/retire', {}));
  expect(mocks.prompt).toHaveBeenCalledWith('B');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(adCodeCopy.es.code_not_found));
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('cancelled password confirmation never writes', async () => {
  mocks.prompt.mockResolvedValue('cancelled');
  render(createElement(AdCodesClient, { rows: [], language: 'en' }));
  fireEvent.click(screen.getByText('Create ad code'));
  fireEvent.change(screen.getByLabelText('Ad code'), { target: { value: 'new-code' } });
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(mocks.prompt).toHaveBeenCalledOnce());
  expect(mocks.post).not.toHaveBeenCalled();
});
