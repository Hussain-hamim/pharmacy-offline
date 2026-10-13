// @vitest-environment jsdom
import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { useDraft } from './useDraft';
import { api } from '../api';
vi.mock('../api', () => ({ api: vi.fn(), requestId: () => 'test-draft' }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('durable draft lifecycle', () => {
  it('debounces edits and flushes navigation before the timer', async () => {
    vi.mocked(api).mockResolvedValue({ id: 'test-draft', revision: 1 });
    const { rerender, unmount } = renderHook(
      ({ name }) => useDraft('customer', 'Customer', { name }),
      { initialProps: { name: '' } },
    );
    rerender({ name: 'First' });
    rerender({ name: 'Final' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(api).not.toHaveBeenCalled();
    await act(async () => {
      unmount();
      await Promise.resolve();
    });
    expect(api).toHaveBeenCalledWith(
      'save_draft',
      expect.objectContaining({ payload: { name: 'Final' }, revision: 0 }),
    );
  });
  it('does not recreate a posted draft when a queued autosave remains', async () => {
    let resolve!: (v: any) => void;
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { result, rerender } = renderHook(({ name }) => useDraft('sale', 'Sale', { name }), {
      initialProps: { name: '' },
    });
    rerender({ name: 'first' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    rerender({ name: 'second' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      const stop = result.current.stop();
      resolve({ revision: 1 });
      await stop;
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(api).toHaveBeenCalledTimes(1);
  });
});
