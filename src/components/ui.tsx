import {
  useState,
  useEffect,
  useRef,
  useId,
  type ReactNode,
  type InputHTMLAttributes,
} from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useReactTable, getCoreRowModel, flexRender, type ColumnDef } from '@tanstack/react-table';
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Inbox,
  LoaderCircle,
  CalendarDays,
  Check,
  ArrowUpRight,
} from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context';
import { dateParts, fromDateParts, fromMonthParts } from '../format';
import type { Data, Page } from '../types';
export function Spinner() {
  return <LoaderCircle size={18} className="spin" />;
}
export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useApp();
  return (
    <div className="error-state" role="alert">
      <strong>{t('Error')}</strong>
      <p>{t((error as Error)?.message || String(error))}</p>
      {retry ? (
        <button className="button secondary" onClick={retry}>
          {t('Retry')}
        </button>
      ) : null}
    </div>
  );
}
export function Empty({
  title = 'No records yet',
  description = 'Records will appear here as you work.',
  children,
}: {
  title?: string;
  description?: string;
  children?: ReactNode;
}) {
  const { t } = useApp();
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={26} />
      </span>
      <h3>{t(title)}</h3>
      <p>{t(description)}</p>
      {children}
    </div>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue';
}) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  const { t } = useApp();
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{t(eyebrow)}</div> : null}
        <h1>{t(title)}</h1>
        {subtitle ? <p>{t(subtitle)}</p> : null}
      </div>
      <div className="header-actions">{actions}</div>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  const { t } = useApp();
  return (
    <label className="field">
      <span>
        {t(label)}
        {required ? <b className="required"> *</b> : null}
      </span>
      {children}
      {hint ? <small>{t(hint)}</small> : null}
    </label>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ''}`} />;
}
export function SearchBox({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { t } = useApp();
  return (
    <div className="search-box">
      <Search size={16} />
      <input
        aria-label={t(placeholder)}
        placeholder={t(placeholder)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button className="icon-button" onClick={() => onChange('')} aria-label={t('Clear')}>
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
export function useDebounce<T>(value: T, delay = 200) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setResult(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return result;
}
export function usePaged(entity: string, filters: Data = {}, enabled = true) {
  const signature = JSON.stringify([entity, filters]);
  const [navigation, setNavigation] = useState<{
    signature: string;
    cursor?: string;
    direction?: string;
    page: number;
  }>({ signature, page: 1 });
  const cursor = navigation.signature === signature ? navigation.cursor : undefined;
  const direction = navigation.signature === signature ? navigation.direction : undefined;
  const page = navigation.signature === signature ? navigation.page : 1;
  const query = useQuery({
    queryKey: ['list', entity, filters, cursor, direction],
    queryFn: () => api<Page>('list', { entity, ...filters, cursor, direction }),
    enabled,
    placeholderData: keepPreviousData,
  });
  return {
    ...query,
    page,
    next: () =>
      setNavigation({ signature, cursor: query.data?.next_cursor || undefined, page: page + 1 }),
    previous: () =>
      setNavigation({
        signature,
        cursor: query.data?.previous_cursor || undefined,
        direction: 'previous',
        page: Math.max(1, page - 1),
      }),
  };
}
export function Pagination({
  next,
  previous,
  page,
  hasNext,
  hasPrevious,
  limit,
  onLimit,
  busy,
}: {
  next: () => void;
  previous: () => void;
  page: number;
  hasNext: boolean;
  hasPrevious: boolean;
  limit: number;
  onLimit: (v: number) => void;
  busy?: boolean;
}) {
  const { t } = useApp();
  return (
    <div className="pagination">
      <label>
        {t('Rows per page')}
        <select
          aria-label={t('Rows per page')}
          value={limit}
          onChange={(e) => onLimit(Number(e.target.value))}
        >
          {[25, 50, 100].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <div>
        <span>
          {t('Page')} {page}
        </span>
        <button
          className="icon-button"
          disabled={!hasPrevious || busy}
          aria-label={t('Previous')}
          onClick={previous}
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-button"
          disabled={!hasNext || busy}
          aria-label={t('Next')}
          onClick={next}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
export function DataTable({
  data,
  columns,
  onRow,
  loading,
}: {
  data: Data[];
  columns: ColumnDef<Data>[];
  onRow?: (row: Data) => void;
  loading?: boolean;
}) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });
  const { t } = useApp();
  return (
    <div className={`table-scroll ${loading ? 'refreshing' : ''}`}>
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => (
                <th key={h.id}>
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
              {onRow ? <th aria-label={t('View')} /> : null}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
              {onRow ? (
                <td className="row-action">
                  <button
                    onClick={() => onRow(row.original)}
                    className="icon-button"
                    aria-label={`${t('View')} ${row.original.name || row.original.number || ''}`}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 ? <Empty /> : null}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  footer,
  onClose,
  wide = false,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useApp();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''} ${compact ? 'compact' : ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={id}
    >
      <div className="modal-header">
        <div>
          <h2 id={id}>{t(title)}</h2>
          {subtitle ? <p>{t(subtitle)}</p> : null}
        </div>
        <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-footer">{footer}</div> : null}
    </dialog>
  );
}
export function Confirm({
  title,
  description,
  onClose,
  onConfirm,
  busy = false,
  danger = false,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onConfirm: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const { t } = useApp();
  return (
    <Modal
      compact
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className={`button ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? <Spinner /> : null}
            {t('Continue')}
          </button>
        </>
      }
    >
      <p>{t(description)}</p>
    </Modal>
  );
}
export function DateField({
  value,
  onChange,
  expiry = false,
  label = 'Date',
}: {
  value: string;
  onChange: (v: string) => void;
  expiry?: boolean;
  label?: string;
}) {
  const { calendar, t } = useApp();
  const [cal, setCal] = useState<string>(expiry ? 'gregory' : calendar);
  const [monthOnly, setMonthOnly] = useState(false);
  const parts = dateParts(value, cal);
  const [draft, setDraft] = useState(parts);
  useEffect(() => setDraft(dateParts(value, cal)), [value, cal]);
  function update(key: 'year' | 'month' | 'day', v: string) {
    setDraft((current) => ({ ...current, [key]: v }));
  }
  return (
    <div className="field date-field">
      <span>{t(label)}</span>
      <div
        className="date-inputs"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            onChange(
              monthOnly
                ? fromMonthParts(draft.year, draft.month, cal)
                : fromDateParts(draft.year, draft.month, draft.day, cal),
            );
          }
        }}
      >
        <CalendarDays size={15} />
        {
          <div className="date-parts" dir="ltr">
            <input
              inputMode="numeric"
              aria-label={t('Year')}
              placeholder="YYYY"
              value={draft.year}
              onChange={(e) => update('year', e.target.value)}
            />
            <span>/</span>
            <input
              inputMode="numeric"
              aria-label={t('Month')}
              placeholder="MM"
              value={draft.month}
              onChange={(e) => update('month', e.target.value)}
            />
            {!monthOnly ? (
              <>
                <span>/</span>
                <input
                  inputMode="numeric"
                  aria-label={t('Day')}
                  placeholder="DD"
                  value={draft.day}
                  onChange={(e) => update('day', e.target.value)}
                />
              </>
            ) : null}
          </div>
        }
        <select
          aria-label={t('Calendar')}
          value={cal}
          onChange={(e) => {
            setCal(e.target.value);
            setMonthOnly(false);
          }}
        >
          <option value="persian">{t('Solar Hijri')}</option>
          <option value="gregory">{t('Gregorian')}</option>
        </select>
      </div>
      {expiry ? (
        <label className="check-label">
          <input
            type="checkbox"
            checked={monthOnly}
            onChange={(e) => {
              setMonthOnly(e.target.checked);
              if (e.target.checked) onChange(fromMonthParts(draft.year, draft.month, cal));
            }}
          />
          {t('Month / year expiry')}
        </label>
      ) : null}
    </div>
  );
}
export function Selector({
  entity,
  value,
  label,
  onChange,
  filters = {},
  placeholder = 'Select…',
  renderExtra,
}: {
  entity: string;
  value: number | null;
  label?: string;
  onChange: (row: Data | null) => void;
  filters?: Data;
  placeholder?: string;
  renderExtra?: (row: Data) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounce(search);
  const { t } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const result = usePaged(entity, { ...filters, active: true, search: q, limit: 10 }, open);
  useEffect(() => {
    if (!open) return;
    const listener = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', listener);
    return () => document.removeEventListener('pointerdown', listener);
  }, [open]);
  return (
    <div className="selector" ref={ref}>
      <button
        type="button"
        className={`select-trigger ${value ? 'selected' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{value ? label || `#${value}` : t(placeholder)}</span>
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div className="select-popover">
          <SearchBox value={search} onChange={setSearch} />
          {result.isLoading ? (
            <div className="select-loading">
              <Spinner />
            </div>
          ) : result.error ? (
            <ErrorState error={result.error} />
          ) : (
            <div className="select-results">
              {value ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  {t('Clear')}
                </button>
              ) : null}
              {result.data?.items.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  onClick={() => {
                    onChange(row);
                    setOpen(false);
                    setSearch('');
                  }}
                >
                  <span>
                    <strong>{row.name || row.number}</strong>
                    <small>
                      {renderExtra
                        ? renderExtra(row)
                        : row.generic || row.party_name || row.phone || ''}
                    </small>
                  </span>
                  {value === row.id ? <Check size={16} /> : null}
                </button>
              ))}
              {result.data?.items.length === 0 ? (
                <p className="muted small">{t('No matching records')}</p>
              ) : null}
            </div>
          )}
          <div className="select-paging">
            <button
              type="button"
              className="icon-button"
              onClick={result.previous}
              aria-label={t('Previous')}
              disabled={!result.data?.previous_cursor}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {t('Page')} {result.page}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={result.next}
              aria-label={t('Next')}
              disabled={!result.data?.next_cursor}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { key: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useApp();
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          role="tab"
          aria-selected={value === item.key}
          key={item.key}
          className={value === item.key ? 'active' : ''}
          onClick={() => onChange(item.key)}
        >
          {t(item.label)}
          {item.count !== undefined ? <span>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
