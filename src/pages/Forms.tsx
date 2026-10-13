import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context';
import { useDraft } from '../hooks/useDraft';
import { today, amount, money } from '../format';
import {
  Modal,
  Field,
  Input,
  DateField,
  Selector,
  Tabs,
  Spinner,
  ErrorState,
} from '../components/ui';
import type { Data, Action, Page } from '../types';

export function RecordEditor({
  kind,
  id,
  existing,
  onClose,
  onSaved,
}: {
  kind: string;
  id?: number;
  existing?: Data;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const entity =
    kind === 'product'
      ? 'product'
      : kind === 'customer' || kind === 'supplier'
        ? 'party'
        : kind === 'user'
          ? 'user'
          : undefined;
  const query = useQuery({
    queryKey: ['detail', entity, id],
    queryFn: () => api('detail', { entity, id }),
    enabled: !!id && !!entity,
  });
  if (id && entity && !query.data)
    return (
      <Modal title="Loading…" onClose={onClose}>
        {query.error ? <ErrorState error={query.error} /> : <Spinner />}
      </Modal>
    );
  return (
    <EditorBody
      key={existing?.id || id || kind}
      kind={kind}
      initial={existing?.payload || query.data}
      existing={existing}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
function defaults(kind: string): Data {
  switch (kind) {
    case 'customer':
    case 'supplier':
      return {
        kind,
        name: '',
        phone: '',
        address: '',
        type_id: null,
        type_name: '',
        opening: '0',
        active: true,
      };
    case 'product':
      return {
        name: '',
        generic: '',
        strength: '',
        form: 'Tablet',
        category: '',
        manufacturer: '',
        barcode: '',
        shelf: '',
        base_unit: 'tablet',
        reorder_level: 10,
        active: true,
        units: [{ name: 'tablet', multiplier: 1, price: '0.00' }],
      };
    case 'payment':
      return {
        party_kind: 'customer',
        party_id: null,
        party_name: '',
        document_id: null,
        document_number: '',
        amount: '',
        date: today(),
        method: 'Cash',
        note: '',
      };
    case 'expense':
      return {
        category_id: null,
        category_name: '',
        amount: '',
        date: today(),
        method: 'Cash',
        note: '',
      };
    case 'adjustment':
      return {
        mode: 'opening',
        product_id: null,
        product_name: '',
        batch_id: null,
        batch_number: '',
        expiry: '',
        quantity: 0,
        total_cost: '0.00',
        quarantine: false,
        reason: '',
      };
    case 'user':
      return {
        username: '',
        name: '',
        password: '',
        role: 'Cashier',
        permissions: null,
        active: true,
      };
    default:
      return { kind: kind === 'supplier_type' ? 'supplier_type' : 'expense', name: '' };
  }
}
const titles: Record<string, string> = {
  product: 'Add product',
  customer: 'Add customer',
  supplier: 'Add supplier',
  payment: 'Record payment',
  expense: 'Add expense',
  adjustment: 'Adjust stock',
  user: 'Add user',
  supplier_type: 'New supplier type',
  expense_category: 'New category',
};
function EditorBody({
  kind,
  initial,
  existing,
  onClose,
  onSaved,
}: {
  kind: string;
  initial?: Data;
  existing?: Data;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t, notify, language } = useApp();
  const client = useQueryClient();
  const [form, setForm] = useState<Data>(() => {
    const value = { ...defaults(kind), ...initial };
    if (initial?.units && !existing)
      value.units = initial.units.map((u: Data) => ({ ...u, price: amount(u.price_minor) }));
    if (initial?.active !== undefined) value.active = !!initial.active;
    return value;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  const draft = useDraft(kind, form.name || titles[kind] || kind, form, existing, kind !== 'user');
  const presets = useQuery({
    queryKey: ['presets'],
    queryFn: () => api('presets'),
    enabled: kind === 'user',
  });
  const rolePermissions = form.permissions || presets.data?.[form.role];
  const [tab, setTab] = useState('details');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await draft.stop();
      const action: Action =
        kind === 'product'
          ? 'save_product'
          : kind === 'customer' || kind === 'supplier'
            ? 'save_party'
            : kind === 'payment'
              ? 'post_payment'
              : kind === 'expense'
                ? 'post_expense'
                : kind === 'adjustment'
                  ? 'adjust_stock'
                  : kind === 'user'
                    ? 'save_user'
                    : 'save_category';
      await api(action, {
        ...form,
        permissions: kind === 'user' ? rolePermissions : undefined,
        request_id: `${draft.id}:submit`,
        draft_id: kind === 'user' ? undefined : draft.id,
      });
      await client.invalidateQueries();
      notify(
        kind === 'payment'
          ? 'Payment recorded'
          : kind === 'expense'
            ? 'Expense recorded'
            : kind === 'adjustment'
              ? 'Stock updated'
              : 'Saved',
      );
      onSaved?.();
      onClose();
    } catch (e) {
      draft.resume();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const simple = (
    label: string,
    key: string,
    opts: { required?: boolean; type?: string; hint?: string } = {},
  ) => (
    <Field label={label} required={opts.required} hint={opts.hint}>
      <Input
        type={opts.type || 'text'}
        value={form[key] ?? ''}
        required={opts.required}
        onChange={(e) =>
          set(key, e.target.type === 'number' ? Number(e.target.value) : e.target.value)
        }
        min={opts.type === 'number' ? 0 : undefined}
      />
    </Field>
  );
  const method = (
    <Field label="Payment method">
      <select className="input" value={form.method} onChange={(e) => set('method', e.target.value)}>
        {['Cash', 'Bank transfer', 'Card', 'Other'].map((v) => (
          <option key={v} value={v}>
            {t(v)}
          </option>
        ))}
      </select>
    </Field>
  );
  return (
    <Modal
      title={initial?.id ? 'Edit' : titles[kind] || 'New'}
      subtitle={kind === 'product' ? 'Products' : kind === 'payment' ? 'Payments' : undefined}
      onClose={onClose}
      wide={kind === 'product' || kind === 'user'}
      footer={
        <>
          <div className="draft-status">{draft.status ? t(draft.status) : null}</div>
          <button className="button secondary" onClick={onClose}>
            {t('Close')}
          </button>
          <button className="button primary" type="submit" form="record-form" disabled={busy}>
            {busy ? <Spinner /> : <Save size={16} />}{' '}
            {t(kind === 'adjustment' ? 'Apply adjustment' : 'Save')}
          </button>
        </>
      }
    >
      <form id="record-form" onSubmit={submit} className="record-form">
        {error || draft.error ? (
          <div className="inline-error" role="alert">
            {t(error || draft.error)}
          </div>
        ) : null}
        {kind === 'customer' || kind === 'supplier' ? (
          <>
            <div className="form-section-title">
              {t(kind === 'customer' ? 'Customer' : 'Supplier')}
            </div>
            <div className="form-grid">
              {simple('Name', 'name', { required: true })}
              {simple('Phone', 'phone')}
              {kind === 'supplier' ? (
                <Field label="Type">
                  <Selector
                    entity="categories"
                    filters={{ kind: 'supplier_type' }}
                    value={form.type_id}
                    label={form.type_name}
                    onChange={(r) =>
                      setForm((f) => ({ ...f, type_id: r?.id || null, type_name: r?.name || '' }))
                    }
                  />
                </Field>
              ) : null}
              {!initial?.id ? simple('Opening balance', 'opening', { hint: 'AFN' }) : null}
            </div>
            {simple('Address', 'address')}
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
              />
              {t('Active')}
            </label>
          </>
        ) : null}
        {kind === 'product' ? (
          <>
            <div className="form-section-title">{t('Product')}</div>
            <div className="form-grid three">
              {simple('Name', 'name', { required: true })}
              {simple('Generic name', 'generic')}
              {simple('Strength', 'strength')}
              {simple('Dosage form', 'form')}
              {simple('Category', 'category')}
              {simple('Manufacturer', 'manufacturer')}
              {simple('Barcode', 'barcode')}
              {simple('Shelf location', 'shelf')}
              {simple('Reorder level', 'reorder_level', { type: 'number', required: true })}
            </div>
            <div className="form-divider" />
            <div className="form-section-title">
              {t('Pack conversions')}
              <button
                className="button secondary small-button"
                type="button"
                onClick={() =>
                  set('units', [...form.units, { name: '', multiplier: 1, price: '0.00' }])
                }
              >
                <Plus size={14} />
                {t('Add unit')}
              </button>
            </div>
            <Field label="Base unit" required>
              <Input
                value={form.base_unit}
                required
                onChange={(e) => {
                  set('base_unit', e.target.value);
                  set(
                    'units',
                    form.units.map((u: Data, i: number) =>
                      i === 0 ? { ...u, name: e.target.value, multiplier: 1 } : u,
                    ),
                  );
                }}
              />
            </Field>
            <div className="unit-grid unit-head">
              <span>{t('Unit')}</span>
              <span>{t('Multiplier')}</span>
              <span>
                {t('Selling price')} · {t('AFN')}
              </span>
              <span />
            </div>
            {form.units.map((u: Data, i: number) => (
              <div className="unit-grid" key={i}>
                <Input
                  aria-label={t('Unit')}
                  value={u.name}
                  required
                  onChange={(e) =>
                    set(
                      'units',
                      form.units.map((v: Data, j: number) =>
                        i === j ? { ...v, name: e.target.value } : v,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={t('Multiplier')}
                  type="number"
                  min="1"
                  step="1"
                  value={u.multiplier}
                  readOnly={i === 0}
                  onChange={(e) =>
                    set(
                      'units',
                      form.units.map((v: Data, j: number) =>
                        i === j ? { ...v, multiplier: Number(e.target.value) } : v,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={t('Selling price')}
                  inputMode="decimal"
                  value={u.price}
                  required
                  onChange={(e) =>
                    set(
                      'units',
                      form.units.map((v: Data, j: number) =>
                        i === j ? { ...v, price: e.target.value } : v,
                      ),
                    )
                  }
                />
                <button
                  className="icon-button danger-text"
                  aria-label={t('Delete')}
                  type="button"
                  disabled={i === 0}
                  onClick={() =>
                    set(
                      'units',
                      form.units.filter((_: Data, j: number) => j !== i),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
              />
              {t('Active')}
            </label>
          </>
        ) : null}
        {kind === 'payment' ? (
          <>
            <Tabs
              value={form.party_kind}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  party_kind: v,
                  party_id: null,
                  party_name: '',
                  document_id: null,
                  document_number: '',
                }))
              }
              items={[
                { key: 'customer', label: 'Customer' },
                { key: 'supplier', label: 'Supplier' },
              ]}
            />
            <Field label="Account" required>
              <Selector
                entity={form.party_kind === 'customer' ? 'customers' : 'suppliers'}
                value={form.party_id}
                label={form.party_name}
                placeholder="Choose account"
                onChange={(r) =>
                  setForm((f) => ({
                    ...f,
                    party_id: r?.id || null,
                    party_name: r?.name || '',
                    balance_minor: r?.balance_minor,
                    document_id: null,
                    document_number: '',
                  }))
                }
              />
            </Field>
            {form.party_id ? (
              <>
                <div className="balance-preview">
                  <span>{t('Balance')}</span>
                  <strong>
                    {money(form.balance_minor, language)} {t('AFN')}
                  </strong>
                </div>
                <Field
                  label="Allocate to invoice (optional)"
                  hint="Oldest outstanding invoices first"
                >
                  <Selector
                    entity={form.party_kind === 'customer' ? 'sales' : 'purchases'}
                    filters={{ party_id: form.party_id, unpaid: true }}
                    value={form.document_id}
                    label={form.document_number}
                    onChange={(r) =>
                      setForm((f) => ({
                        ...f,
                        document_id: r?.id || null,
                        document_number: r?.number || '',
                      }))
                    }
                  />
                </Field>
              </>
            ) : null}
            <div className="form-grid">
              {simple('Amount', 'amount', { required: true, hint: 'AFN' })}
              <DateField value={form.date} onChange={(v) => set('date', v)} />
              {method}
            </div>
            {simple('Notes', 'note')}
          </>
        ) : null}
        {kind === 'expense' ? (
          <>
            <Field label="Category" required>
              <Selector
                entity="categories"
                filters={{ kind: 'expense' }}
                value={form.category_id}
                label={form.category_name}
                onChange={(r) =>
                  setForm((f) => ({
                    ...f,
                    category_id: r?.id || null,
                    category_name: r?.name || '',
                  }))
                }
              />
            </Field>
            <div className="form-grid">
              {simple('Amount', 'amount', { required: true, hint: 'AFN' })}
              <DateField value={form.date} onChange={(v) => set('date', v)} />
              {method}
            </div>
            {simple('Notes', 'note')}
          </>
        ) : null}
        {kind === 'adjustment' ? (
          <>
            <Field label="Type">
              <select
                className="input"
                value={form.mode}
                onChange={(e) => set('mode', e.target.value)}
              >
                <option value="opening">{t('Opening stock')}</option>
                <option value="count">{t('Stock count / damage')}</option>
                <option value="release">{t('Release quarantine')}</option>
                <option value="quarantine">{t('Quarantine')}</option>
              </select>
            </Field>
            <Field label="Product" required>
              <Selector
                entity="products"
                value={form.product_id}
                label={form.product_name}
                onChange={(r) =>
                  setForm((f) => ({
                    ...f,
                    product_id: r?.id || null,
                    product_name: r?.name || '',
                    batch_id: null,
                  }))
                }
              />
            </Field>
            {form.mode === 'opening' ? (
              <>
                <div className="form-grid">
                  {simple('Batch number', 'batch_number', { required: true })}
                  <DateField
                    label="Expiry date"
                    expiry
                    value={form.expiry}
                    onChange={(v) => set('expiry', v)}
                  />
                  {simple('Quantity', 'quantity', {
                    type: 'number',
                    required: true,
                    hint: 'Base unit',
                  })}
                  {simple('Total cost', 'total_cost', { required: true, hint: 'AFN' })}
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.quarantine}
                    onChange={(e) => set('quarantine', e.target.checked)}
                  />
                  {t('Quarantine')}
                </label>
              </>
            ) : (
              <>
                <Field label="Batch">
                  <Selector
                    entity="batches"
                    filters={{ product_id: form.product_id }}
                    value={form.batch_id}
                    label={form.batch_number}
                    onChange={(r) =>
                      setForm((f) => ({
                        ...f,
                        batch_id: r?.id || null,
                        batch_number: r?.number || '',
                        quantity: r?.quantity || 0,
                      }))
                    }
                    renderExtra={(r) =>
                      `${r.quantity} · ${r.expiry} · ${t(r.status === 'quarantine' ? 'Quarantine' : 'Sellable')}`
                    }
                  />
                </Field>
                {form.mode === 'count'
                  ? simple('Counted quantity', 'quantity', { type: 'number', required: true })
                  : null}
              </>
            )}
            {simple('Reason', 'reason', { required: true })}
          </>
        ) : null}
        {kind === 'user' ? (
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: 'details', label: 'User' },
                { key: 'permissions', label: 'Permissions' },
              ]}
            />
            {tab === 'details' ? (
              <>
                <div className="form-grid">
                  {simple('Full name', 'name', { required: true })}
                  {simple('Username', 'username', { required: true })}
                  {simple(initial?.id ? 'New password' : 'Password', 'password', {
                    required: !initial?.id,
                    type: 'password',
                    hint: initial?.id ? 'Keep blank to retain password' : 'At least 8 characters',
                  })}
                  <Field label="Role">
                    <select
                      className="input"
                      value={form.role}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          role: e.target.value,
                          permissions: presets.data?.[e.target.value] || presets.data?.Cashier,
                        }))
                      }
                    >
                      {['Administrator', 'Cashier', 'Inventory', 'Accountant', 'Custom'].map(
                        (r) => (
                          <option key={r} value={r}>
                            {t(r === 'Inventory' ? 'Inventory role' : r)}
                          </option>
                        ),
                      )}
                    </select>
                  </Field>
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => set('active', e.target.checked)}
                  />
                  {t('Active')}
                </label>
                <div className="info-note">
                  <ShieldCheck size={18} />
                  {t('Permissions')}
                </div>
              </>
            ) : (
              <div className="permissions-list">
                {rolePermissions ? (
                  Object.entries(rolePermissions).map(([key, value]) => (
                    <div key={key}>
                      <span>
                        {t(
                          (
                            {
                              dashboard: 'Dashboard',
                              products: 'Products',
                              stock: 'Stock management',
                              customers: 'Customers',
                              suppliers: 'Suppliers',
                              purchases: 'Purchases',
                              sales: 'Sales',
                              payments: 'Payments',
                              returns: 'Returns',
                              expenses: 'Expenses',
                              reports: 'Reports',
                              users: 'Users',
                              settings: 'Settings',
                              backups: 'Backup & restore',
                              audit: 'Audit history',
                              costs: 'View costs & profit',
                              reversals: 'Post returns / reversals',
                              restore: 'Restore backups',
                            } as Data
                          )[key] || key,
                        )}
                      </span>
                      {typeof value === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={value}
                          disabled={form.role === 'Administrator'}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              role: 'Custom',
                              permissions: { ...rolePermissions, [key]: e.target.checked },
                            }))
                          }
                        />
                      ) : (
                        <select
                          className="input"
                          value={String(value)}
                          disabled={form.role === 'Administrator'}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              role: 'Custom',
                              permissions: { ...rolePermissions, [key]: e.target.value },
                            }))
                          }
                        >
                          {[
                            ['none', 'No access'],
                            ['read', 'Read only'],
                            ['write', 'Read & write'],
                          ].map(([v, l]) => (
                            <option key={v} value={v}>
                              {t(l)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))
                ) : (
                  <Spinner />
                )}
              </div>
            )}
          </>
        ) : null}
        {kind === 'supplier_type' || kind === 'expense_category'
          ? simple('Name', 'name', { required: true })
          : null}
      </form>
    </Modal>
  );
}

export function CategoryManager({
  kind,
  onClose,
}: {
  kind: 'supplier_type' | 'expense';
  onClose: () => void;
}) {
  const { t } = useApp();
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [editor, setEditor] = useState(false);
  const query = useQuery({
    queryKey: ['list', 'categories', kind, cursor],
    queryFn: () => api<Page>('list', { entity: 'categories', kind, cursor, limit: 50 }),
  });
  return (
    <Modal
      title={kind === 'supplier_type' ? 'Supplier types' : 'Categories'}
      onClose={onClose}
      footer={
        <button className="button primary" onClick={() => setEditor(true)}>
          <Plus size={16} />
          {t(kind === 'supplier_type' ? 'New supplier type' : 'New category')}
        </button>
      }
    >
      {query.error ? (
        <ErrorState error={query.error} />
      ) : (
        query.data?.items.map((row) => (
          <div key={row.id} className="category-row">
            {t(row.name)}
          </div>
        ))
      )}
      <div className="select-paging">
        <button
          className="button secondary"
          disabled={!previous.length}
          onClick={() => {
            setCursor(previous.at(-1));
            setPrevious((p) => p.slice(0, -1));
          }}
        >
          {t('Previous')}
        </button>
        <button
          className="button secondary"
          disabled={!query.data?.next_cursor}
          onClick={() => {
            setPrevious((p) => [...p, cursor]);
            setCursor(query.data?.next_cursor || undefined);
          }}
        >
          {t('Next')}
        </button>
      </div>
      {editor ? (
        <RecordEditor
          kind={kind === 'supplier_type' ? 'supplier_type' : 'expense_category'}
          onClose={() => setEditor(false)}
        />
      ) : null}
    </Modal>
  );
}
