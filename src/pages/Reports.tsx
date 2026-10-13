import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer, TrendingUp, Wallet, Package, Coins, X } from 'lucide-react';
import { api, chooseFile, desktop, requestId, printPage } from '../api';
import { useApp } from '../context';
import { money, today, dateLabel } from '../format';
import {
  PageHeader,
  Field,
  DateField,
  DataTable,
  Pagination,
  usePaged,
  Spinner,
  ErrorState,
} from '../components/ui';
import { columnsFor } from './Records';
import type { Data } from '../types';
const reports = [
  ['sales', 'Sales report'],
  ['purchases', 'Purchase report'],
  ['customers', 'Customer balances'],
  ['suppliers', 'Supplier balances'],
  ['payments', 'Payment history'],
  ['receipts', 'Collections'],
  ['supplier_payments', 'Supplier payments'],
  ['discounts', 'Discount report'],
  ['profit', 'Profit report'],
  ['batches', 'Stock valuation'],
  ['movements', 'Stock movements'],
  ['alerts', 'Expiring soon'],
  ['returns', 'Returns'],
  ['expenses', 'Expenses'],
];
export default function Reports() {
  const { t, language, calendar, can, special, notify, settings } = useApp();
  const [reportKey, setReportKey] = useState('sales');
  const entity =
    (
      { receipts: 'payments', supplier_payments: 'payments', discounts: 'sales' } as Record<
        string,
        string
      >
    )[reportKey] || reportKey;
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(today());
  const [limit, setLimit] = useState(50);
  const [job, setJob] = useState<string | null>(null);
  const [rows, setRows] = useState(0);
  const filters = {
    report: true,
    from,
    to,
    limit,
    ...(reportKey === 'discounts' ? { discounted: true } : {}),
    ...(reportKey === 'receipts'
      ? { payment_kind: 'receipt' }
      : reportKey === 'supplier_payments'
        ? { payment_kind: 'supplier_payment' }
        : {}),
  };
  const query = usePaged(entity, filters, can('reports'));
  const summary = useQuery({
    queryKey: ['dashboard', 'report', from, to],
    queryFn: () => api('dashboard', { report: true, from, to }),
    enabled: can('reports') && !!from && !!to,
  });
  useEffect(() => {
    if (!desktop) return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen<Data>('operation-progress', (e) => {
        if (e.payload.stage === 'export') setRows(e.payload.rows);
      });
      if (disposed) stop();
      else cleanup = stop;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  async function exportCSV() {
    const path = await chooseFile('save', 'csv', `${entity}-${from}-${to}.csv`);
    if (!path) return;
    const id = requestId();
    setJob(id);
    setRows(0);
    try {
      const result = await api('export', { query: { entity, ...filters }, path, job_id: id });
      notify(`${t('Export complete')} · ${result.rows} ${t('Rows exported')}`);
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setJob(null);
    }
  }
  function print() {
    const table = document.querySelector('.report-results')?.cloneNode(true) as
      HTMLElement | undefined;
    if (!table) return;
    const host = document.createElement('div');
    host.className = 'print-host report-print';
    const heading = document.createElement('h1');
    heading.textContent = `${settings?.name || ''} · ${t(reports.find((r) => r[0] === reportKey)?.[1] || 'Reports')}`;
    const range = document.createElement('p');
    range.textContent = `${dateLabel(from, language, calendar)} — ${dateLabel(to, language, calendar)} · ${t('Page')} ${query.page}`;
    host.append(heading, range, table);
    document.body.appendChild(host);
    window.addEventListener('afterprint', () => host.remove(), { once: true });
    void printPage().catch((error: Error) => notify(error.message, true));
  }
  if (!can('reports')) return <ErrorState error={new Error(t('Access denied'))} />;
  const totals = summary.data?.totals || {};
  return (
    <div className="enter">
      <PageHeader
        title="Reports"
        actions={
          <>
            <button className="button secondary" disabled={!query.data} onClick={print}>
              <Printer size={16} />
              {t('Print page')}
            </button>
            <button className="button primary" disabled={!!job} onClick={() => void exportCSV()}>
              {job ? <Spinner /> : <Download size={16} />} {t('Export CSV')}
            </button>
          </>
        }
      />
      <section className="panel report-controls">
        <Field label="Reports">
          <select
            className="input"
            value={reportKey}
            onChange={(e) => setReportKey(e.target.value)}
          >
            {reports.map(([id, label]) => (
              <option key={id} value={id}>
                {t(label)}
              </option>
            ))}
          </select>
        </Field>
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
      </section>
      {job ? (
        <div className="operation-progress">
          <Spinner />
          {t('Exporting…')}
          <span>
            {rows} {t('Rows exported')}
          </span>
          <button
            className="button secondary"
            onClick={() => void api('cancel_export', { job_id: job })}
          >
            <X size={15} />
            {t('Cancel export')}
          </button>
        </div>
      ) : null}
      <div className="stats-grid report-stats">
        {[
          { key: 'sales_minor', label: 'Total sales', icon: TrendingUp, color: 'mint' },
          { key: 'gross_profit_minor', label: 'Gross profit', icon: Wallet, color: 'blue' },
          { key: 'expenses_minor', label: 'Expenses', icon: Coins, color: 'amber' },
          {
            key: 'operating_profit_minor',
            label: 'Operating profit',
            icon: Package,
            color: 'purple',
          },
        ]
          .filter((c) => !c.key.includes('profit') || special('costs'))
          .map(({ key, label, icon: Icon, color }) => (
            <div className="stat-card" key={key}>
              <div className="stat-top">
                <span>{t(label)}</span>
                <span className={`stat-icon ${color}`}>
                  <Icon size={17} />
                </span>
              </div>
              <strong className="report-stat-number">
                {money(totals[key], language)} <small>{t('AFN')}</small>
              </strong>
            </div>
          ))}
      </div>
      {summary.error ? <ErrorState error={summary.error} /> : null}
      <section className="panel">
        <div className="panel-header">
          <h2>{t(reports.find((r) => r[0] === reportKey)?.[1] || 'Reports')}</h2>
          <span className="muted small">
            {t('Report period')} · {dateLabel(from, language, calendar)} —{' '}
            {dateLabel(to, language, calendar)}
          </span>
        </div>
        <div className="report-results">
          {query.error ? (
            <ErrorState error={query.error} />
          ) : query.isLoading ? (
            <div className="page-loading">
              <Spinner />
            </div>
          ) : (
            <DataTable
              columns={columnsFor(entity, t, language, calendar).filter(
                (c) => !('accessorKey' in c && c.accessorKey === 'cost_minor') || special('costs'),
              )}
              data={query.data?.items || []}
            />
          )}
        </div>
        <Pagination
          next={query.next}
          previous={query.previous}
          page={query.page}
          limit={limit}
          onLimit={setLimit}
          hasNext={!!query.data?.next_cursor}
          hasPrevious={!!query.data?.previous_cursor}
        />
      </section>
      <div className="report-footnotes">
        <span>
          {t('Returns')}: <strong>{money(totals.returns_minor, language)}</strong>
        </span>
        <span>
          {t('Discounts')}: <strong>{money(totals.discounts_minor, language)}</strong>
        </span>
        {special('costs') ? (
          <span>
            {t('Cost of goods')}: <strong>{money(totals.cost_minor, language)}</strong>
          </span>
        ) : null}
        <span>
          {t('Collections')}: <strong>{money(totals.receipts_minor, language)}</strong>
        </span>
      </div>
    </div>
  );
}
