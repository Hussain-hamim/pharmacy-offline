import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Save } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context';
import { useDraft } from '../hooks/useDraft';
import { money, today } from '../format';
import {
  PageHeader,
  Field,
  Selector,
  DateField,
  Tabs,
  Spinner,
  ErrorState,
  Empty,
  Input,
} from '../components/ui';
import { InvoiceModal } from './Print';
import type { Data } from '../types';
export default function ReturnEditor({ existing }: { existing?: Data }) {
  const { t, language, notify, can, special } = useApp();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [form, setForm] = useState<Data>(
    () =>
      existing?.payload || {
        kind: 'customer_return',
        source_id: null,
        source_number: '',
        date: today(),
        settlement: 'refund',
        method: 'Cash',
        note: '',
        lines: [],
      },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState<number | null>(null);
  const draft = useDraft(form.kind, form.source_number || t('New return'), form, existing);
  const query = useQuery({
    queryKey: ['detail', 'document', form.source_id],
    queryFn: () => api('detail', { entity: 'document', id: form.source_id }),
    enabled: !!form.source_id,
  });
  const source = query.data;
  function updateLine(id: number, value: Data) {
    setForm((f) => {
      const found = f.lines.find((l: Data) => l.source_line_id === id);
      return {
        ...f,
        lines: found
          ? f.lines.map((l: Data) => (l.source_line_id === id ? { ...l, ...value } : l))
          : [...f.lines, { source_line_id: id, quantity: 0, disposition: 'quarantine', ...value }],
      };
    });
  }
  const total = (source?.lines || []).reduce((sum: number, line: Data) => {
    const q = form.lines.find((l: Data) => l.source_line_id === line.id)?.quantity || 0;
    return (
      sum +
      Math.floor((line.total_minor * (line.returned_quantity + q)) / line.quantity) -
      Math.floor((line.total_minor * line.returned_quantity) / line.quantity)
    );
  }, 0);
  async function post() {
    setBusy(true);
    setError('');
    try {
      await draft.stop();
      const result = await api('post_return', {
        ...form,
        lines: form.lines.filter((l: Data) => l.quantity > 0),
        request_id: `${draft.id}:post`,
        draft_id: draft.id,
      });
      await client.invalidateQueries();
      notify('Return posted');
      setPosted(result.id);
    } catch (e) {
      draft.resume();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!can('returns', true) || !special('reversals'))
    return <ErrorState error={new Error(t('Access denied'))} />;
  return (
    <div className="enter">
      <PageHeader
        title="New return"
        actions={
          <button className="button secondary" onClick={() => navigate('/returns')}>
            <ArrowLeft size={16} />
            {t('Back')}
          </button>
        }
      />
      <section className="panel return-editor">
        <Tabs
          value={form.kind}
          onChange={(kind) =>
            setForm((f) => ({ ...f, kind, source_id: null, source_number: '', lines: [] }))
          }
          items={[
            { key: 'customer_return', label: 'Customer return' },
            { key: 'supplier_return', label: 'Supplier return' },
          ]}
        />
        <div className="form-grid">
          <Field label="Source invoice" required>
            <Selector
              entity={form.kind === 'customer_return' ? 'sales' : 'purchases'}
              value={form.source_id}
              label={form.source_number}
              onChange={(r) =>
                setForm((f) => ({
                  ...f,
                  source_id: r?.id || null,
                  source_number: r?.number || '',
                  lines: [],
                }))
              }
            />
          </Field>
          <DateField value={form.date} onChange={(v) => setForm((f) => ({ ...f, date: v }))} />
        </div>
        {error || draft.error ? (
          <div className="inline-error">{t(error || draft.error)}</div>
        ) : null}
        {query.isFetching ? (
          <Spinner />
        ) : query.error ? (
          <ErrorState error={query.error} />
        ) : !source ? (
          <Empty title="Source invoice" description="Select an original invoice to begin." />
        ) : (
          <>
            <div className="return-source-summary">
              <span>{source.party_name}</span>
              <strong>
                {t('Total')}: {money(source.total_minor, language)} {t('AFN')}
              </strong>
              <span>
                {t('Outstanding')}: {money(source.outstanding_minor, language)}
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table return-lines">
                <thead>
                  <tr>
                    <th>{t('Product')}</th>
                    <th>{t('Unit')}</th>
                    <th>{t('Remaining')}</th>
                    <th>{t('Return quantity')}</th>
                    {form.kind === 'customer_return' ? <th>{t('Disposition')}</th> : null}
                    <th>{t('Total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {source.lines.map((line: Data) => {
                    const selected = form.lines.find((l: Data) => l.source_line_id === line.id);
                    const q = selected?.quantity || 0;
                    return (
                      <tr key={line.id}>
                        <td>
                          <strong>{line.name}</strong>
                        </td>
                        <td>{line.unit}</td>
                        <td>{line.quantity - line.returned_quantity}</td>
                        <td>
                          <Input
                            aria-label={`${t('Return quantity')} ${line.name}`}
                            type="number"
                            min="0"
                            max={line.quantity - line.returned_quantity}
                            step="1"
                            value={q}
                            onChange={(e) =>
                              updateLine(line.id, { quantity: Number(e.target.value) })
                            }
                          />
                        </td>
                        {form.kind === 'customer_return' ? (
                          <td>
                            <select
                              className="input"
                              value={selected?.disposition || 'quarantine'}
                              onChange={(e) => updateLine(line.id, { disposition: e.target.value })}
                            >
                              <option value="quarantine">{t('Quarantine')}</option>
                              <option value="sellable">{t('Sellable')}</option>
                            </select>
                          </td>
                        ) : null}
                        <td>
                          {money(
                            Math.floor(
                              (line.total_minor * (line.returned_quantity + q)) / line.quantity,
                            ) -
                              Math.floor(
                                (line.total_minor * line.returned_quantity) / line.quantity,
                              ),
                            language,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="form-grid return-settlement">
          <Field label="Settlement">
            <select
              className="input"
              value={form.settlement}
              onChange={(e) => setForm((f) => ({ ...f, settlement: e.target.value }))}
            >
              <option value="refund">{t('Refund')}</option>
              <option value="credit" disabled={source?.party_id === null}>
                {t('Account credit')}
              </option>
            </select>
          </Field>
          <Field label="Payment method">
            <select
              className="input"
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
            >
              {['Cash', 'Bank transfer', 'Card', 'Other'].map((v) => (
                <option key={v} value={v}>
                  {t(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <Input
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </Field>
        </div>
        <div className="return-footer">
          <span className="draft-status">{t(draft.status)}</span>
          <div>
            <span>{t('Return total')}</span>
            <strong>
              {money(total, language)} {t('AFN')}
            </strong>
          </div>
          <button
            className="button secondary"
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
            className="button primary"
            disabled={busy || !!posted || !form.lines.some((l: Data) => l.quantity > 0)}
            onClick={() => void post()}
          >
            {busy ? <Spinner /> : <RotateCcw size={16} />} {t('Post return')}
          </button>
        </div>
      </section>
      {posted ? <InvoiceModal id={posted} onClose={() => navigate('/returns')} /> : null}
    </div>
  );
}
