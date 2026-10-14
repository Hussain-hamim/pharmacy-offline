// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import BillEditor from './BillEditor';
import { RecordEditor } from './Forms';
import type { Data } from '../types';

const { can } = vi.hoisted(() => ({ can: vi.fn(() => true) }));
vi.mock('../api', () => ({ api: vi.fn(), requestId: () => crypto.randomUUID() }));
vi.mock('../context', () => ({
  useApp: () => ({
    t: (s: string) => s,
    language: 'en',
    calendar: 'gregory',
    notify: vi.fn(),
    can,
  }),
}));
vi.mock('../hooks/useDraft', () => ({
  useDraft: () => ({ id: 'test-draft', stop: vi.fn(), resume: vi.fn(), flush: vi.fn() }),
}));
vi.mock('./Print', () => ({ usePrint: () => ({ print: vi.fn() }), InvoiceModal: () => null }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 72,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, start: index * 72 })),
    measureElement: vi.fn(),
  }),
}));

let client: QueryClient;
const product = {
  id: 1,
  name: 'Medicine',
  base_unit: 'tablet',
  on_hand: 100,
  units: [{ id: 2, name: 'tablet', multiplier: 1, price_minor: 2000 }],
};
beforeEach(() => {
  can.mockReturnValue(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (action, payload: Data = {}) => {
      if (action === 'list')
        return {
          items:
            payload.entity === 'products'
              ? [product]
              : payload.search
                ? []
                : [{ id: 3, name: 'Existing customer', balance_minor: -1000 }],
          next_cursor: null,
          previous_cursor: null,
        } as any;
      if (action === 'detail') return product as any;
      if (action === 'save_party')
        return {
          id: 99,
          name: payload.name.trim(),
          balance_minor: Math.round(Number(payload.opening) * 100),
        } as any;
      return { id: 99 } as any;
    });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function show(ui = <BillEditor kind="sale" />) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
async function addProduct() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Search products, generic names or barcode…' }),
  );
  fireEvent.click(await screen.findByRole('button', { name: /Medicine/ }));
  await screen.findByLabelText('Quantity 1');
}
function payment() {
  return screen.getByLabelText('Amount paid') as HTMLInputElement;
}

describe('POS customer and payment flow', () => {
  it('defaults to walk-in and posts the full discounted total as the cart changes', async () => {
    show();
    expect(screen.getByRole('button', { name: 'Customer' }).className).toContain('selected');
    await addProduct();
    expect(payment().value).toBe('20.00');
    fireEvent.change(screen.getByLabelText('Quantity 1'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Invoice discount'), { target: { value: '5' } });
    expect(payment().value).toBe('55.00');
    fireEvent.click(screen.getByRole('button', { name: 'Post invoice' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        'post_bill',
        expect.objectContaining({
          party_id: null,
          paid: '55.00',
          lines: [expect.objectContaining({ quantity: 3 })],
        }),
      ),
    );
  });

  it('can return from a saved customer to walk-in, removes account credit, and accepts cash tendered', async () => {
    show();
    await addProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Existing customer' }));
    expect(payment().value).toBe('0');
    expect(screen.getByText('Account credit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Walk-in customer' }));
    expect(payment().value).toBe('20.00');
    expect(screen.queryByText('Account credit')).toBeNull();
    fireEvent.change(payment(), { target: { value: '30' } });
    expect(screen.getByText('Change')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Post invoice' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        'post_bill',
        expect.objectContaining({ party_id: null, paid: '30' }),
      ),
    );
  });

  it('creates a missing customer from search and selects them without losing the cart', async () => {
    show();
    await addProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search…' }), {
      target: { value: 'New patient' },
    });
    await screen.findByText('No matching records');
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    const dialog = screen.getByRole('dialog', { name: 'Add customer' });
    expect((within(dialog).getByLabelText(/Name/) as HTMLInputElement).value).toBe('New patient');
    fireEvent.change(within(dialog).getByLabelText(/Opening balance/), {
      target: { value: '-10' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Customer' }).textContent).toBe('New patient'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Quantity 1')).toBeTruthy();
    expect(screen.getByText('Account credit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Post invoice' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        'post_bill',
        expect.objectContaining({
          party_id: 99,
          party_name: 'New patient',
          party_balance_minor: -1000,
          paid: '0',
          lines: [expect.objectContaining({ product_id: 1 })],
        }),
      ),
    );
  });

  it('preserves the sale when customer creation is cancelled', async () => {
    show();
    await addProduct();
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add customer' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0],
    );
    expect(screen.getByRole('button', { name: 'Customer' })).toBeTruthy();
    expect(payment().value).toBe('20.00');
    expect(screen.getByLabelText('Quantity 1')).toBeTruthy();
  });

  it('does not offer customer creation without customer write permission', () => {
    can.mockImplementation((...args: unknown[]) => args[0] !== 'customers');
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    expect(screen.queryByRole('button', { name: 'Add customer' })).toBeNull();
  });
});

describe('product opening stock', () => {
  it('sends quantity, batch, expiry and total cost with the new product', async () => {
    show(<RecordEditor kind="product" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'New medicine' } });
    fireEvent.change(screen.getByLabelText(/^Opening stock/), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/Batch number/), { target: { value: 'OPEN-1' } });
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2030' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '31' } });
    fireEvent.blur(screen.getByLabelText('Day'));
    fireEvent.change(screen.getByLabelText(/Total cost/), { target: { value: '250.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        'save_product',
        expect.objectContaining({
          name: 'New medicine',
          opening_stock: {
            quantity: 50,
            batch_number: 'OPEN-1',
            expiry: '2030-12-31',
            total_cost: '250.00',
          },
        }),
      ),
    );
  });

  it('does not offer opening stock when editing an existing product', async () => {
    show(<RecordEditor kind="product" id={1} onClose={vi.fn()} />);
    await screen.findByRole('dialog', { name: 'Edit' });
    expect(screen.queryByLabelText(/^Opening stock/)).toBeNull();
  });
});
