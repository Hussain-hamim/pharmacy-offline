import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ReceiptText,
  Save,
  Printer,
  Check,
  Package,
  ScanBarcode,
} from 'lucide-react';
import { useApp } from '../context';
import { api, requestId } from '../api';
import { amount, discount, minor, money, today } from '../format';
import { useDraft } from '../hooks/useDraft';
import {
  PageHeader,
  Field,
  Input,
  DateField,
  Selector,
  Spinner,
  Empty,
  ErrorState,
} from '../components/ui';
import { usePrint, InvoiceModal } from './Print';
import type { Bill, BillLine, Product, Data } from '../types';
export default function BillEditor({
  kind,
  existing,
}: {
  kind: 'sale' | 'purchase';
  existing?: Data;
}) {
  return <BillBody key={existing?.id || kind} kind={kind} existing={existing} />;
}
function BillBody({ kind, existing }: { kind: 'sale' | 'purchase'; existing?: Data }) {
  const { t, language, can, notify } = useApp();
  const navigate = useNavigate();
  const client = useQueryClient();
  const purchase = kind === 'purchase';
  const [bill, setBill] = useState<Bill>(
    () =>
      existing?.payload || {
        kind,
        party_id: null,
        party_name: '',
        date: today(),
        lines: [],
        discount: { kind: 'amount', value: '0' },
        paid: '0',
        method: 'Cash',
        note: '',
      },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [posted, setPosted] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draft = useDraft(
    kind,
    bill.party_name || t(purchase ? 'Supplier bill' : 'Customer invoice'),
    bill,
    existing,
  );
  const virtualizer = useVirtualizer({
    count: bill.lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (purchase ? 116 : 72),
    overscan: 5,
  });
  const printer = usePrint();
  const subtotal = bill.lines.reduce((sum, l) => sum + minor(l.price) * l.quantity, 0);
  const lineDiscounts = bill.lines.reduce(
    (sum, l) => sum + discount(minor(l.price) * l.quantity, l.discount),
    0,
  );
  const invoiceDiscount = discount(subtotal - lineDiscounts, bill.discount);
  const total = subtotal - lineDiscounts - invoiceDiscount;
  const paid = minor(bill.paid || '0');
  const credit = Math.min(total, Math.max(0, -(bill.party_balance_minor || 0)));
  const due = Math.max(0, total - credit - paid);
  const update = (key: keyof Bill, value: unknown) => setBill((b) => ({ ...b, [key]: value }));
  function updateLine(index: number, values: Partial<BillLine>) {
    setBill((b) => ({
      ...b,
      lines: b.lines.map((l, i) => (i === index ? { ...l, ...values } : l)),
    }));
  }
  async function addProduct(row: Data | null) {
    if (!row) return;
    setAdding(true);
    try {
      const product = await api<Product>('detail', { entity: 'product', id: row.id });
      const u = product.units[0];
      if (!u) throw new Error('Product has no active unit');
      setBill((b) => ({
        ...b,
        lines: [
          ...b.lines,
          {
            key: requestId(),
            product_id: product.id,
            unit_id: u.id,
            name: product.name,
            units: product.units,
            quantity: 1,
            price: purchase ? '0.00' : amount(u.price_minor),
            discount: { kind: 'amount', value: '0' },
            batch_number: '',
            expiry: '',
          },
        ],
      }));
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setAdding(false);
    }
  }
  async function post(print = false) {
    setBusy(true);
    setError('');
    try {
      await draft.stop();
      const result = await api('post_bill', {
        ...bill,
        request_id: `${draft.id}:post`,
        draft_id: draft.id,
      });
      await client.invalidateQueries();
      notify('Invoice posted');
      setPosted(result.id);
      if (print) {
        const doc = await api('detail', { entity: 'document', id: result.id });
        printer.print(doc);
      }
    } catch (e) {
      draft.resume();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!can(purchase ? 'purchases' : 'sales', true))
    return <ErrorState error={new Error(t('Access denied'))} />;
  return (
    <div className="bill-workspace enter">
      <PageHeader
        title={purchase ? 'Supplier bill' : 'Customer invoice'}
        eyebrow={purchase ? 'Purchases' : 'Point of sale'}
        actions={
          <>
            <span className="draft-status">{draft.status ? t(draft.status) : t('New')}</span>
            <button
              className="button secondary"
              onClick={() => navigate(purchase ? '/purchases' : '/sales')}
            >
              <ArrowLeft size={15} />
              {t('Back')}
            </button>
          </>
        }
      />
      <div className="bill-surface">
        <div className="bill-meta">
          <Field label={purchase ? 'Supplier' : 'Customer'} required={purchase}>
            <Selector
              entity={purchase ? 'suppliers' : 'customers'}
              value={bill.party_id}
              label={bill.party_name}
              placeholder={purchase ? 'Select supplier' : 'Walk-in customer'}
              onChange={(r) =>
                setBill((b) => ({
                  ...b,
                  party_id: r?.id || null,
                  party_name: r?.name || '',
                  party_balance_minor: r?.balance_minor || 0,
                }))
              }
            />
          </Field>
          <DateField value={bill.date} onChange={(v) => update('date', v)} />
          <div className="bill-number">
            <span className="field-label">{t('Invoice number')}</span>
            <strong>
              {t('Drafts')} <span className="mono">#{draft.id.slice(0, 8).toUpperCase()}</span>
            </strong>
          </div>
        </div>
        <div className="bill-product-search">
          <span className="barcode-icon">
            <ScanBarcode size={24} />
          </span>
          <Selector
            entity="products"
            value={null}
            placeholder="Search products, generic names or barcode…"
            onChange={(r) => void addProduct(r)}
            renderExtra={(r) => `${r.generic || ''} · ${r.on_hand} ${r.base_unit}`}
          />
          {adding ? (
            <Spinner />
          ) : (
            <span className="search-hint">
              <Plus size={13} />
              {t('Add line')}
            </span>
          )}
        </div>
        {error || draft.error ? (
          <div className="inline-error" role="alert">
            {t(error || draft.error)}
          </div>
        ) : null}
        <div className={`bill-grid-head ${purchase ? 'purchase-grid' : ''}`}>
          <span>#</span>
          <span>{t('Product')}</span>
          <span>{t('Unit')}</span>
          <span>{t('Quantity')}</span>
          <span>
            {t('Price')} · {t('AFN')}
          </span>
          <span>{t('Discount')}</span>
          <span>{t('Total')}</span>
          <span />
        </div>
        <div className="bill-lines-scroll" ref={scrollRef}>
          {bill.lines.length === 0 ? (
            <Empty
              title="No product lines"
              description="Search a medicine above to add it to this invoice."
            />
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((v) => {
                const line = bill.lines[v.index];
                return (
                  <div
                    key={line.key}
                    data-index={v.index}
                    ref={virtualizer.measureElement}
                    className={`bill-line ${purchase ? 'purchase-line' : ''}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${v.start}px)`,
                    }}
                  >
                    <div className={`bill-grid-row ${purchase ? 'purchase-grid' : ''}`}>
                      <span className="line-number">{v.index + 1}</span>
                      <div className="bill-product-name">
                        <span className="product-mini">
                          <Package size={16} />
                        </span>
                        <div>
                          <strong>{line.name}</strong>
                          <small>{purchase ? t('Purchases') : t('Earliest expiry first')}</small>
                        </div>
                      </div>
                      <select
                        aria-label={`${t('Unit')} ${v.index + 1}`}
                        className="input"
                        value={line.unit_id}
                        onChange={(e) => {
                          const unit = line.units.find((u) => u.id === Number(e.target.value))!;
                          updateLine(v.index, {
                            unit_id: unit.id,
                            ...(!purchase ? { price: amount(unit.price_minor) } : {}),
                          });
                        }}
                      >
                        {line.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        aria-label={`${t('Quantity')} ${v.index + 1}`}
                        type="number"
                        min="1"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(v.index, { quantity: Number(e.target.value) })}
                      />
                      <Input
                        aria-label={`${t('Price')} ${v.index + 1}`}
                        inputMode="decimal"
                        value={line.price}
                        onChange={(e) => updateLine(v.index, { price: e.target.value })}
                      />
                      <div className="discount-input">
                        <input
                          aria-label={`${t('Discount')} ${v.index + 1}`}
                          value={line.discount.value}
                          inputMode="decimal"
                          onChange={(e) =>
                            updateLine(v.index, {
                              discount: { ...line.discount, value: e.target.value },
                            })
                          }
                        />
                        <select
                          aria-label={t('Type')}
                          value={line.discount.kind}
                          onChange={(e) =>
                            updateLine(v.index, {
                              discount: {
                                ...line.discount,
                                kind: e.target.value as 'amount' | 'percent',
                              },
                            })
                          }
                        >
                          <option value="amount">AFN</option>
                          <option value="percent">%</option>
                        </select>
                      </div>
                      <strong className="line-total tabular">
                        {money(
                          minor(line.price) * line.quantity -
                            discount(minor(line.price) * line.quantity, line.discount),
                          language,
                        )}
                      </strong>
                      <button
                        className="icon-button danger-text"
                        aria-label={`${t('Delete')} ${line.name}`}
                        onClick={() =>
                          setBill((b) => ({
                            ...b,
                            lines: b.lines.filter((l) => l.key !== line.key),
                          }))
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {purchase ? (
                      <div className="purchase-batch-fields">
                        <label>
                          {t('Batch number')}
                          <Input
                            value={line.batch_number}
                            onChange={(e) => updateLine(v.index, { batch_number: e.target.value })}
                          />
                        </label>
                        <label>
                          {t('Expiry date')}
                          <Input
                            type="date"
                            value={line.expiry}
                            onChange={(e) => updateLine(v.index, { expiry: e.target.value })}
                          />
                        </label>
                        <label>
                          {t('Month / year expiry')}
                          <Input
                            type="month"
                            value={line.expiry.slice(0, 7)}
                            onChange={(e) => {
                              if (e.target.value) {
                                const [y, m] = e.target.value.split('-').map(Number);
                                updateLine(v.index, {
                                  expiry: `${e.target.value}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`,
                                });
                              }
                            }}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="bill-bottom">
          <div className="bill-notes">
            <Field label="Notes">
              <textarea
                className="input"
                rows={2}
                value={bill.note}
                onChange={(e) => update('note', e.target.value)}
              />
            </Field>
            <div className="bill-payment-fields">
              <Field label="Payment method">
                <select
                  className="input"
                  value={bill.method}
                  onChange={(e) => update('method', e.target.value)}
                >
                  {['Cash', 'Bank transfer', 'Card', 'Other'].map((v) => (
                    <option key={v} value={v}>
                      {t(v)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount paid">
                <div className="input-action">
                  <Input
                    value={bill.paid}
                    inputMode="decimal"
                    onChange={(e) => update('paid', e.target.value)}
                  />
                  <button
                    aria-label={t('Paid')}
                    onClick={() => update('paid', amount(total - credit))}
                  >
                    <Check size={16} />
                  </button>
                </div>
              </Field>
            </div>
            <span className="bill-note">
              <Check size={13} />
              {t('Automatic stock allocation')} · {t('No tax')}
            </span>
          </div>
          <div className="bill-totals">
            <div>
              <span>{t('Subtotal')}</span>
              <strong>{money(subtotal, language)}</strong>
            </div>
            <div>
              <span>{t('Discounts')}</span>
              <strong>− {money(lineDiscounts, language)}</strong>
            </div>
            <div>
              <span>{t('Invoice discount')}</span>
              <div className="discount-input">
                <input
                  aria-label={t('Invoice discount')}
                  value={bill.discount.value}
                  inputMode="decimal"
                  onChange={(e) => update('discount', { ...bill.discount, value: e.target.value })}
                />
                <select
                  value={bill.discount.kind}
                  aria-label={t('Type')}
                  onChange={(e) => update('discount', { ...bill.discount, kind: e.target.value })}
                >
                  <option value="amount">AFN</option>
                  <option value="percent">%</option>
                </select>
              </div>
            </div>
            {credit > 0 ? (
              <div>
                <span>{t('Account credit')}</span>
                <strong>− {money(credit, language)}</strong>
              </div>
            ) : null}
            <div className="grand-total">
              <span>
                {t('Total')} <small>{t('AFN')}</small>
              </span>
              <strong>{money(total, language)}</strong>
            </div>
            <div className={due ? 'due-row' : 'paid-row'}>
              <span>{t(paid > total - credit ? 'Change' : 'Amount due')}</span>
              <strong>
                {money(paid > total - credit ? paid - total + credit : due, language)}
              </strong>
            </div>
          </div>
        </div>
        <div className="bill-actions">
          <div className="bill-line-count">
            <ReceiptText size={16} />
            {bill.lines.length} {t('Products')}
          </div>
          <button
            className="button secondary"
            disabled={busy || !!posted}
            onClick={() =>
              void draft
                .flush()
                .then(() => notify('Draft saved'))
                .catch((e) => notify(e.message, true))
            }
          >
            <Save size={16} />
            {t('Save draft')}
          </button>
          <button
            className="button secondary"
            disabled={busy || !!posted || !bill.lines.length}
            onClick={() => void post()}
          >
            {busy ? <Spinner /> : <Check size={16} />} {t('Post invoice')}
          </button>
          <button
            className="button primary"
            disabled={busy || !!posted || !bill.lines.length}
            onClick={() => void post(true)}
          >
            <Printer size={16} />
            {t('Post & print')}
          </button>
        </div>
      </div>
      {posted ? (
        <InvoiceModal id={posted} onClose={() => navigate(purchase ? '/purchases' : '/sales')} />
      ) : null}
      {printer.host}
    </div>
  );
}
