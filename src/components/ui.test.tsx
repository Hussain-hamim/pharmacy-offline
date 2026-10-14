// @vitest-environment jsdom
import type { ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { ErrorState, usePaged } from './ui';
import type { Page } from '../types';

vi.mock('../api', () => ({ api: vi.fn() }));
vi.mock('../context', () => ({ useApp: () => ({ t: (value: string) => value }) }));

let client: QueryClient;
beforeEach(() => {
  vi.mocked(api).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const salePage: Page = {
  items: [{ id: 1, number: 'INV-1', total_minor: 4000 }],
  next_cursor: 'page-2',
  previous_cursor: null,
  limit: 50,
};

it('retries an error without submitting its surrounding form', () => {
  const retry = vi.fn();
  const submit = vi.fn((event) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <ErrorState error={new Error('Connection unavailable')} retry={retry} />
    </form>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

describe('paginated module navigation', () => {
  it('does not expose sale rows to customer columns while customers load', async () => {
    let complete!: (page: Page) => void;
    vi.mocked(api)
      .mockResolvedValueOnce(salePage)
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
    const { result, rerender } = renderHook(({ entity }) => usePaged(entity), {
      initialProps: { entity: 'sales' },
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(salePage));
    rerender({ entity: 'customers' });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    const customers: Page = {
      ...salePage,
      items: [{ id: 2, name: 'Customer' }],
      next_cursor: null,
    };
    await act(async () => {
      complete(customers);
    });
    await waitFor(() => expect(result.current.data).toEqual(customers));
  });

  it('retains rows within a module and resets the cursor on module changes', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(salePage)
      .mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ entity }) => usePaged(entity), {
      initialProps: { entity: 'sales' },
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(salePage));
    act(() => result.current.next());
    expect(result.current.page).toBe(2);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual(salePage);
    rerender({ entity: 'customers' });
    expect(result.current.page).toBe(1);
    expect(result.current.data).toBeUndefined();
    expect(api).toHaveBeenLastCalledWith(
      'list',
      expect.objectContaining({ entity: 'customers', cursor: undefined }),
    );
  });
});
