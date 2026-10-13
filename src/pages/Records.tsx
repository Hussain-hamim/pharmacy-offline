import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  SlidersHorizontal,
  Package,
  ArrowDownLeft,
  ArrowUpRight,
  FileClock,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { api, requestId } from '../api';
import { useApp } from '../context';
import { money, dateLabel, number } from '../format';
import {
  PageHeader,
  Tabs,
  SearchBox,
  DataTable,
  Pagination,
  usePaged,
  useDebounce,
  Badge,
  ErrorState,
  Modal,
  Spinner,
  Confirm,
} from '../components/ui';
import { RecordEditor, CategoryManager } from './Forms';
import { InvoiceModal } from './Print';
import type { Data, Language } from '../types';
const config: Record<string, { title: string; add?: string; kind?: string; module: string }> = {
  products: { title: 'Products', add: 'Add product', kind: 'product', module: 'products' },
  stock: { title: 'Stock management', add: 'Adjust stock', kind: 'adjustment', module: 'stock' },
  customers: { title: 'Customers', add: 'Add customer', kind: 'customer', module: 'customers' },
  suppliers: { title: 'Suppliers', add: 'Add supplier', kind: 'supplier', module: 'suppliers' },
  sales: { title: 'Sales', add: 'New sale', module: 'sales' },
  purchases: { title: 'Purchases', add: 'New purchase', module: 'purchases' },
  payments: { title: 'Payments', add: 'Record payment', kind: 'payment', module: 'payments' },
  returns: { title: 'Returns', add: 'New return', module: 'returns' },
  expenses: { title: 'Expenses', add: 'Add expense', kind: 'expense', module: 'expenses' },
  users: { title: 'Users', add: 'Add user', kind: 'user', module: 'users' },
  audit: { title: 'Audit history', module: 'audit' },
  drafts: { title: 'Drafts', module: '' },
};
export function columnsFor(
  entity: string,
  t: (s: string) => string,
  language: Language,
  calendar: string,
): ColumnDef<Data>[] {
  const txt = (key: string, label: string): ColumnDef<Data> => ({
    accessorKey: key,
    header: t(label),
    cell: (i) =>
      i.getValue() === null || i.getValue() === undefined ? '—' : t(String(i.getValue())),
  });
  const cash = (key: string, label: string): ColumnDef<Data> => ({
    accessorKey: key,
    header: `${t(label)} · ${t('AFN')}`,
    cell: (i) => <span className="tabular strong">{money(Number(i.getValue()), language)}</span>,
  });
  const date = (key = 'date', label = 'Date'): ColumnDef<Data> => ({
    accessorKey: key,
    header: t(label),
    cell: (i) => dateLabel(String(i.getValue()), language, calendar),
  });
  switch (entity) {
    case 'products':
      return [
        {
          accessorKey: 'name',
          header: t('Product'),
          cell: ({ row }) => (
            <div className="product-cell">
              <span className="product-icon">
                <Package size={18} />
              </span>
              <div>
                <strong>{row.original.name}</strong>
                <small>
                  {row.original.generic || row.original.strength || row.original.barcode || '—'}
                </small>
              </div>
            </div>
          ),
        },
        txt('category', 'Category'),
        {
          accessorKey: 'on_hand',
          header: t('Stock'),
          cell: (i) => (
            <span className="tabular">
              {number(Number(i.getValue()), language)}{' '}
              <span className="muted">{i.row.original.base_unit}</span>
            </span>
          ),
        },
        cash('price_minor', 'Selling price'),
        txt('shelf', 'Shelf location'),
        {
          id: 'status',
          header: t('Status'),
          cell: ({ row }) => (
            <Badge
              tone={
                !row.original.active
                  ? 'neutral'
                  : row.original.on_hand === 0
                    ? 'red'
                    : row.original.on_hand <= row.original.reorder_level
                      ? 'amber'
                      : 'green'
              }
            >
              {t(
                !row.original.active
                  ? 'Inactive'
                  : row.original.on_hand === 0
                    ? 'Out of stock'
                    : row.original.on_hand <= row.original.reorder_level
                      ? 'Low stock'
                      : 'In stock',
              )}
            </Badge>
          ),
        },
      ];
    case 'customers':
    case 'suppliers':
      return [
        {
          accessorKey: 'name',
          header: t('Name'),
          cell: ({ row }) => (
            <div className="person-cell">
              <span className={`avatar ${entity === 'suppliers' ? 'supplier-avatar' : ''}`}>
                {row.original.name.slice(0, 2).toUpperCase()}
              </span>
              <strong>{row.original.name}</strong>
            </div>
          ),
        },
        txt('phone', 'Phone'),
        ...(entity === 'suppliers' ? [txt('type_name', 'Type')] : []),
        txt('address', 'Address'),
        cash('balance_minor', 'Balance'),
        {
          accessorKey: 'active',
          header: t('Status'),
          cell: (i) => (
            <Badge tone={i.getValue() ? 'green' : 'neutral'}>
              {t(i.getValue() ? 'Active' : 'Inactive')}
            </Badge>
          ),
        },
      ];
    case 'sales':
    case 'purchases':
    case 'returns':
      return [
        {
          accessorKey: 'number',
          header: t('Invoice number'),
          cell: (i) => <span className="mono strong">{String(i.getValue())}</span>,
        },
        date(),
        txt('party_name', entity === 'purchases' ? 'Supplier' : 'Account'),
        ...(entity === 'returns'
          ? ([
              {
                accessorKey: 'kind',
                header: t('Type'),
                cell: (i: any) =>
                  t(i.getValue() === 'customer_return' ? 'Customer return' : 'Supplier return'),
              },
            ] as ColumnDef<Data>[])
          : []),
        cash('discount_minor', 'Discount'),
        cash('total_minor', 'Total'),
        cash('paid_minor', 'Paid'),
        cash('outstanding_minor', 'Outstanding'),
        {
          id: 'status',
          header: t('Status'),
          cell: ({ row }) => (
            <Badge tone={row.original.outstanding_minor > 0 ? 'amber' : 'green'}>
              {t(row.original.outstanding_minor > 0 ? 'Outstanding' : 'Paid')}
            </Badge>
          ),
        },
      ];
    case 'profit':
      return [
        date(),
        cash('sales_minor', 'Total sales'),
        cash('returns_minor', 'Returns'),
        cash('cost_minor', 'Total cost'),
        cash('gross_profit_minor', 'Gross profit'),
        cash('expenses_minor', 'Expenses'),
        cash('operating_profit_minor', 'Operating profit'),
      ];
    case 'batches':
    case 'alerts':
      return [
        txt('product_name', 'Product'),
        txt('number', 'Batch number'),
        date('expiry', 'Expiry'),
        {
          accessorKey: 'quantity',
          header: t('Quantity'),
          cell: (i) => (
            <span className="tabular">
              {number(Number(i.getValue()), language)} {i.row.original.base_unit}
            </span>
          ),
        },
        cash('cost_minor', 'Total cost'),
        {
          accessorKey: 'status',
          header: t('Status'),
          cell: (i) => (
            <Badge tone={i.getValue() === 'quarantine' ? 'amber' : 'green'}>
              {t(i.getValue() === 'quarantine' ? 'Quarantine' : 'Sellable')}
            </Badge>
          ),
        },
      ];
    case 'movements':
      return [
        date('created_at'),
        txt('product_name', 'Product'),
        txt('batch_number', 'Batch'),
        {
          accessorKey: 'quantity',
          header: t('Quantity'),
          cell: (i) => (
            <span className={Number(i.getValue()) >= 0 ? 'positive' : 'negative'}>
              {Number(i.getValue()) >= 0 ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}{' '}
              {String(i.getValue())}
            </span>
          ),
        },
        txt('reason', 'Reason'),
        txt('user_name', 'User'),
      ];
    case 'payments':
      return [
        date(),
        txt('party_name', 'Account'),
        txt('kind', 'Type'),
        cash('amount_minor', 'Amount'),
        txt('method', 'Payment method'),
        txt('document_number', 'Invoice'),
        txt('note', 'Notes'),
      ];
    case 'expenses':
      return [
        date(),
        txt('category_name', 'Category'),
        cash('amount_minor', 'Amount'),
        txt('method', 'Payment method'),
        txt('note', 'Notes'),
        txt('user_name', 'User'),
      ];
    case 'users':
      return [
        txt('name', 'Full name'),
        txt('username', 'Username'),
        txt('role', 'Role'),
        {
          accessorKey: 'active',
          header: t('Status'),
          cell: (i) => (
            <Badge tone={i.getValue() ? 'green' : 'neutral'}>
              {t(i.getValue() ? 'Active' : 'Inactive')}
            </Badge>
          ),
        },
      ];
    case 'drafts':
      return [
        {
          accessorKey: 'title',
          header: t('Drafts'),
          cell: (i) => (
            <div className="person-cell">
              <span className="product-icon">
                <FileClock size={18} />
              </span>
              <strong>{t(String(i.getValue()))}</strong>
            </div>
          ),
        },
        txt('kind', 'Type'),
        date('updated_at', 'Updated'),
      ];
    case 'ledger':
      return [
        date('created_at'),
        txt('reason', 'Reason'),
        txt('document_number', 'Document'),
        cash('amount_minor', 'Amount'),
      ];
    case 'audit':
      return [
        date('created_at'),
        txt('user_name', 'User'),
        txt('action', 'Action'),
        txt('entity', 'Entity'),
        txt('entity_id', 'Record'),
      ];
    case 'backups':
      return [
        date('created_at'),
        txt('destination', 'Destination'),
        {
          accessorKey: 'automatic',
          header: t('Type'),
          cell: (i) => t(i.getValue() ? 'Automatic' : 'Manual'),
        },
        {
          accessorKey: 'status',
          header: t('Status'),
          cell: (i) => (
            <Badge tone={i.getValue() === 'success' ? 'green' : 'red'}>
              {t(i.getValue() === 'success' ? 'Successful' : 'Failed')}
            </Badge>
          ),
        },
        txt('error', 'Details'),
      ];
    default:
      return [];
  }
}
export default function Records({ entity }: { entity: string }) {
  const { t, language, calendar, can, special, notify } = useApp();
  const cfg = config[entity];
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'batches');
  useEffect(() => {
    if (params.get('tab')) setTab(params.get('tab')!);
  }, [params]);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState('newest');
  const [low, setLow] = useState(params.get('low') === '1');
  const [editor, setEditor] = useState<{ kind: string; id?: number } | null>(null);
  const [detail, setDetail] = useState<Data | null>(null);
  const [category, setCategory] = useState(false);
  const [discard, setDiscard] = useState<Data | null>(null);
  const debounced = useDebounce(search);
  const listEntity = entity === 'stock' ? tab : entity;
  const query = usePaged(
    listEntity,
    { search: debounced, limit, sort, ...(entity === 'products' && low ? { low: true } : {}) },
    !cfg.module || can(cfg.module),
  );
  if (cfg.module && !can(cfg.module)) return <ErrorState error={new Error(t('Access denied'))} />;
  const columns = columnsFor(listEntity, t, language, calendar).filter(
    (c) => !('accessorKey' in c && c.accessorKey === 'cost_minor') || special('costs'),
  );
  function add() {
    if (cfg.kind) setEditor({ kind: cfg.kind });
    else navigate(`/${entity}/new`);
  }
  function rowAction(row: Data) {
    if (entity === 'drafts') {
      navigate(`/drafts/${row.id}`);
      return;
    }
    if (
      ['sales', 'purchases', 'returns'].includes(entity) ||
      entity === 'customers' ||
      entity === 'suppliers' ||
      entity === 'audit' ||
      entity === 'payments' ||
      entity === 'expenses' ||
      entity === 'stock'
    ) {
      setDetail(row);
      return;
    }
    if (cfg.kind && can(cfg.module, true)) setEditor({ kind: cfg.kind, id: row.id });
    else setDetail(row);
  }
  return (
    <div className="enter">
      <PageHeader
        title={cfg.title}
        subtitle={entity === 'products' ? 'Start with a purchase or opening stock.' : undefined}
        actions={
          <>
            {['suppliers', 'expenses'].includes(entity) && can(cfg.module, true) ? (
              <button className="button secondary" onClick={() => setCategory(true)}>
                <SlidersHorizontal size={15} />
                {t(entity === 'suppliers' ? 'Supplier types' : 'Categories')}
              </button>
            ) : null}
            {cfg.add && can(cfg.module, true) ? (
              <button className="button primary" onClick={add}>
                <Plus size={16} />
                {t(cfg.add)}
              </button>
            ) : null}
          </>
        }
      />
      <section className="panel records-panel">
        {entity === 'stock' ? (
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'batches', label: 'All batches' },
              { key: 'movements', label: 'Stock movements' },
              { key: 'alerts', label: 'Expiring soon' },
            ]}
          />
        ) : null}
        <div className="table-toolbar">
          <div className="toolbar-left">
            <SearchBox value={search} onChange={setSearch} />
            {entity === 'products' ? (
              <button
                className={`filter-chip ${low ? 'selected' : ''}`}
                onClick={() => setLow((v) => !v)}
              >
                {t('Low stock')}
              </button>
            ) : null}
          </div>
          <div className="toolbar-right">
            <span className="table-title">
              {t(entity === 'products' ? 'All products' : cfg.title)}
            </span>
            <select
              className="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort"
            >
              <option value="newest">{t('Newest first')}</option>
              <option value="oldest">{t('Oldest first')}</option>
            </select>
          </div>
        </div>
        {query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <div className="page-loading">
            <Spinner />
          </div>
        ) : (
          <DataTable
            data={query.data?.items || []}
            columns={columns}
            onRow={rowAction}
            loading={query.isFetching}
          />
        )}
        <Pagination
          page={query.page}
          next={query.next}
          previous={query.previous}
          hasNext={!!query.data?.next_cursor}
          hasPrevious={!!query.data?.previous_cursor}
          limit={limit}
          onLimit={setLimit}
          busy={query.isFetching}
        />
      </section>
      {editor ? (
        <RecordEditor kind={editor.kind} id={editor.id} onClose={() => setEditor(null)} />
      ) : null}
      {category ? (
        <CategoryManager
          kind={entity === 'suppliers' ? 'supplier_type' : 'expense'}
          onClose={() => setCategory(false)}
        />
      ) : null}
      {detail && ['sales', 'purchases', 'returns'].includes(entity) ? (
        <InvoiceModal id={detail.id} onClose={() => setDetail(null)} />
      ) : detail && ['customers', 'suppliers'].includes(entity) ? (
        <PartyDetail
          row={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor({ kind: cfg.kind!, id: detail.id });
            setDetail(null);
          }}
        />
      ) : detail ? (
        <Modal title="Details" onClose={() => setDetail(null)}>
          <dl className="detail-list">
            {Object.entries(detail)
              .filter(([k]) => !k.startsWith('_'))
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{t(k.replaceAll('_', ' '))}</dt>
                  <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}</dd>
                </div>
              ))}
          </dl>
        </Modal>
      ) : null}
      {discard ? (
        <Confirm
          title="Discard this draft?"
          description="This cannot be undone."
          onClose={() => setDiscard(null)}
          danger
          onConfirm={() =>
            void api('delete_draft', { id: discard.id, request_id: requestId() }).then(() => {
              setDiscard(null);
              void client.invalidateQueries();
              notify('Saved');
            })
          }
        />
      ) : null}
    </div>
  );
}
function PartyDetail({
  row,
  onClose,
  onEdit,
}: {
  row: Data;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { t, language, calendar, can } = useApp();
  const [tab, setTab] = useState('ledger');
  const [limit, setLimit] = useState(50);
  const detail = useQuery({
    queryKey: ['detail', 'party', row.id],
    queryFn: () => api('detail', { entity: 'party', id: row.id }),
  });
  const query = usePaged(tab, { party_id: row.id, limit });
  const entity = row.kind === 'customer' ? 'sales' : 'purchases';
  return (
    <Modal
      wide
      title={row.name}
      onClose={onClose}
      footer={
        can(row.kind === 'customer' ? 'customers' : 'suppliers', true) ? (
          <button className="button primary" onClick={onEdit}>
            {t('Edit')}
          </button>
        ) : undefined
      }
    >
      <div className="account-heading">
        <div>
          <span>{row.phone || '—'}</span>
          <p>{row.address}</p>
        </div>
        <div>
          <span>{t('Balance')}</span>
          <strong>
            {money(detail.data?.balance_minor ?? row.balance_minor, language)} {t('AFN')}
          </strong>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'ledger', label: 'Account statement' },
          { key: entity, label: row.kind === 'customer' ? 'Sales' : 'Purchases' },
          { key: 'payments', label: 'Payment history' },
        ]}
      />
      {query.error ? (
        <ErrorState error={query.error} />
      ) : (
        <DataTable
          data={query.data?.items || []}
          columns={columnsFor(tab, t, language, calendar)}
        />
      )}
      <Pagination
        next={query.next}
        previous={query.previous}
        page={query.page}
        limit={limit}
        onLimit={setLimit}
        hasNext={!!query.data?.next_cursor}
        hasPrevious={!!query.data?.previous_cursor}
      />
    </Modal>
  );
}
