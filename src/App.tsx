import { lazy, Suspense, useState, useEffect, type FormEvent } from 'react';
import { NavLink, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  FilePlus2,
  ReceiptText,
  Truck,
  Package,
  Layers3,
  Users,
  Building2,
  Wallet,
  RotateCcw,
  Coins,
  ChartNoAxesCombined,
  FileClock,
  Settings2,
  HardDrive,
  ShieldCheck,
  History,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  ChevronRight,
  ArrowUpRight,
  Plus,
  ArrowRight,
  Stethoscope,
  Check,
  Globe2,
  CalendarDays,
  Database,
  Activity,
} from 'lucide-react';
import { useApp } from './context';
import { api, desktop } from './api';
import { languages } from './i18n';
import { dateLabel, money, number, today } from './format';
import {
  Field,
  Input,
  Spinner,
  ErrorState,
  PageHeader,
  Badge,
  Empty,
  DataTable,
} from './components/ui';
import type { User, Data } from './types';
const Records = lazy(() => import('./pages/Records'));
const BillEditor = lazy(() => import('./pages/BillEditor'));
const ReturnEditor = lazy(() => import('./pages/ReturnEditor'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Backups = lazy(() => import('./pages/Backups'));
const Reports = lazy(() => import('./pages/Reports'));
const DraftResume = lazy(() => import('./pages/DraftResume'));
const groups: { label: string; items: [string, string, typeof LayoutDashboard, string][] }[] = [
  {
    label: 'Workspace',
    items: [
      ['/', 'Overview', LayoutDashboard, 'dashboard'],
      ['/sales/new', 'Point of sale', FilePlus2, 'sales'],
      ['/sales', 'Sales', ReceiptText, 'sales'],
      ['/purchases', 'Purchases', Truck, 'purchases'],
    ],
  },
  {
    label: 'Management',
    items: [
      ['/products', 'Products', Package, 'products'],
      ['/stock', 'Stock management', Layers3, 'stock'],
      ['/customers', 'Customers', Users, 'customers'],
      ['/suppliers', 'Suppliers', Building2, 'suppliers'],
      ['/payments', 'Payments', Wallet, 'payments'],
      ['/returns', 'Returns', RotateCcw, 'returns'],
      ['/expenses', 'Expenses', Coins, 'expenses'],
      ['/reports', 'Reports', ChartNoAxesCombined, 'reports'],
      ['/drafts', 'Drafts', FileClock, ''],
    ],
  },
  {
    label: 'Administration',
    items: [
      ['/users', 'Users', ShieldCheck, 'users'],
      ['/settings', 'Settings', Settings2, 'settings'],
      ['/backups', 'Backup & restore', HardDrive, 'backups'],
      ['/audit', 'Audit history', History, 'audit'],
    ],
  },
];
export default function App() {
  const { user } = useApp();
  return user ? <Shell /> : <Auth />;
}
function Auth() {
  const { t, language, setLanguage, setSession, notify } = useApp();
  const status = useQuery({ queryKey: ['bootstrap'], queryFn: () => api('bootstrap') });
  const setup = status.data?.needs_setup;
  const [form, setForm] = useState({ username: '', password: '', name: '', pharmacy_name: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ token: string; user: User }>(setup ? 'setup' : 'login', {
        ...form,
        role: 'Administrator',
        active: true,
      });
      setSession(data.token, data.user);
      notify('Welcome back');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen">
      <div className="auth-story">
        <Brand />
        <div className="auth-copy">
          <span className="eyebrow">RADEfy · PHARMACY</span>
          <h1>{t('Everything your pharmacy needs. Right here.')}</h1>
          <p>{t('Offline by design. Built for your everyday.')}</p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="medicine-card">
              <div className="medicine-cross">+</div>
              <div>
                <span>PHARMACY</span>
                <strong>Care, simplified.</strong>
              </div>
              <i>Rx</i>
            </div>
            <div className="floating-chip">
              <Check size={17} />
              <span>{t('Saved locally')}</span>
            </div>
            <div className="pill pill-one" />
            <div className="pill pill-two" />
            <div className="auth-grid" />
          </div>
        </div>
        <span className="auth-foot">
          <ShieldCheck size={16} />
          {t('Offline & secure')} · SQLite
        </span>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-language">
          <Globe2 size={16} />
          <select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <span className="auth-symbol">
            <Stethoscope size={30} />
          </span>
          <h2>{t(setup ? 'Set up your pharmacy' : 'Welcome back')}</h2>
          <p>{t(setup ? 'Create administrator' : 'Sign in to your pharmacy')}</p>
          {status.isLoading ? (
            <Spinner />
          ) : status.error ? (
            <ErrorState error={status.error} retry={() => void status.refetch()} />
          ) : (
            <>
              {setup ? (
                <>
                  <Field label="Pharmacy name" required>
                    <Input
                      value={form.pharmacy_name}
                      onChange={(e) => update('pharmacy_name', e.target.value)}
                      required
                      autoFocus
                    />
                  </Field>
                  <Field label="Full name" required>
                    <Input
                      value={form.name}
                      onChange={(e) => update('name', e.target.value)}
                      required
                    />
                  </Field>
                </>
              ) : null}
              <Field label="Username" required>
                <Input
                  autoComplete="username"
                  value={form.username}
                  onChange={(e) => update('username', e.target.value)}
                  required
                  autoFocus={!setup}
                />
              </Field>
              <Field label="Password" required hint={setup ? 'At least 8 characters' : undefined}>
                <Input
                  type="password"
                  autoComplete={setup ? 'new-password' : 'current-password'}
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  minLength={setup ? 8 : undefined}
                  required
                />
              </Field>
              {error ? (
                <div className="inline-error" role="alert">
                  {t(error)}
                </div>
              ) : null}
              <button className="button primary large" disabled={busy}>
                {busy ? <Spinner /> : null}
                {t(setup ? 'Create administrator' : 'Sign in')}
                <ArrowRight size={17} />
              </button>
            </>
          )}
          <p className="auth-local">
            <Database size={14} />
            {t('Local database')} · {t('AFN')}
          </p>
        </form>
      </div>
    </div>
  );
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <span />
      </span>
      {!small ? (
        <div>
          <strong>
            Radefy<span>Pharmacy</span>
          </strong>
          <small>CARE, WELL MANAGED</small>
        </div>
      ) : null}
    </div>
  );
}
function Shell() {
  const { user, logout, t, language, setLanguage, calendar, settings, can, notify } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const active = groups.flatMap((g) => g.items).find(([path]) => path === location.pathname);
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        if (can('sales', true)) navigate('/sales/new');
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [navigate, can]);
  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const unlisten = await listen<{ message: string }>('backup-error', (e) =>
        notify(e.payload.message, true),
      );
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [notify]);
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand small={collapsed} />
          <button
            className="icon-button collapse-button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        {!collapsed ? (
          <div className="workspace-label">
            <span className="workspace-dot" />
            <span>{settings?.name || 'Radefy Pharmacy'}</span>
            <ChevronRight size={13} />
          </div>
        ) : null}
        <nav>
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              {!collapsed ? <div className="nav-label">{t(group.label)}</div> : null}
              {group.items
                .filter((i) => !i[3] || can(i[3]))
                .map(([path, label, Icon]) => (
                  <NavLink
                    key={path}
                    to={path}
                    end
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    title={collapsed ? t(label) : undefined}
                  >
                    <Icon size={18} />
                    {!collapsed ? <span>{t(label)}</span> : null}
                    {!collapsed && label === 'Point of sale' ? <kbd>⌘ N</kbd> : null}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-card">
            <span className="avatar">{user?.name.slice(0, 2).toUpperCase()}</span>
            {!collapsed ? (
              <div>
                <strong>{user?.name}</strong>
                <small>{t(user?.role || '')}</small>
              </div>
            ) : null}
            <button
              className="icon-button"
              onClick={logout}
              title={t('Sign out')}
              aria-label={t('Sign out')}
            >
              <LogOut size={16} />
            </button>
          </div>
          {!collapsed ? (
            <div className="offline-status">
              <i />
              {t('Offline & secure')}
              <span>v0.1</span>
            </div>
          ) : null}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{settings?.name || 'Radefy Pharmacy'}</span>
            <ChevronRight size={13} />
            <strong>{t(active?.[1] || 'Invoice')}</strong>
          </div>
          <div className="topbar-actions">
            <span className="topbar-date">
              <CalendarDays size={14} />
              {dateLabel(today(), language, calendar)}
            </span>
            <div className="topbar-divider" />
            <select
              className="language-select"
              aria-label={t('Language')}
              value={language}
              onChange={(e) => setLanguage(e.target.value as typeof language)}
            >
              {languages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            {can('stock') ? (
              <button
                className="icon-button notification-button"
                title={t('Notifications')}
                aria-label={t('Notifications')}
                onClick={() => navigate('/stock?tab=alerts')}
              >
                <Bell size={18} />
                <i />
              </button>
            ) : null}
          </div>
        </header>
        <main className="main-content">
          <Suspense
            fallback={
              <div className="page-loading">
                <Spinner />
              </div>
            }
          >
            <Routes>
              <Route
                path="/"
                element={
                  can('dashboard') ? (
                    <Dashboard />
                  ) : (
                    <Navigate
                      to={
                        groups.flatMap((g) => g.items).find((i) => i[3] && can(i[3]))?.[0] ||
                        '/drafts'
                      }
                    />
                  )
                }
              />
              {[
                'products',
                'stock',
                'customers',
                'suppliers',
                'sales',
                'purchases',
                'payments',
                'returns',
                'expenses',
                'users',
                'audit',
                'drafts',
              ].map((entity) => (
                <Route key={entity} path={`/${entity}`} element={<Records entity={entity} />} />
              ))}
              <Route path="/sales/new" element={<BillEditor kind="sale" />} />
              <Route path="/purchases/new" element={<BillEditor kind="purchase" />} />
              <Route path="/returns/new" element={<ReturnEditor />} />
              <Route path="/drafts/:id" element={<DraftResume />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/backups" element={<Backups />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="status-bar">
          <span>
            <span className="status-dot" />
            {t('Local database')}
            {!desktop ? ' · Development preview' : ''}
          </span>
          <span>
            {t('AFN')}
            <span className="status-separator">/</span>
            {t(calendar === 'persian' ? 'Solar Hijri' : 'Gregorian')}
          </span>
        </footer>
      </div>
    </div>
  );
}
function Dashboard() {
  const { t, language, calendar, can } = useApp();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api('dashboard') });
  if (query.isLoading)
    return (
      <div className="page-loading">
        <Spinner />
      </div>
    );
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data!;
  const totals = data.totals;
  const trend: Data[] = data.trend;
  const max = Math.max(1, ...trend.map((v) => v.sales_minor));
  const cards = [
    {
      title: 'Total sales',
      value: totals.sales_minor,
      Icon: ReceiptText,
      color: 'mint',
      foot: `${number(totals.sale_count, language)} ${t('Sales')}`,
    },
    {
      title: 'Collections',
      value: totals.receipts_minor,
      Icon: Wallet,
      color: 'blue',
      foot: t('Last 30 days'),
    },
    {
      title: 'Receivables',
      value: totals.receivables_minor,
      Icon: Users,
      color: 'amber',
      foot: t('Customer balances'),
    },
    {
      title: 'Payables',
      value: totals.payables_minor,
      Icon: Building2,
      color: 'purple',
      foot: t('Supplier balances'),
    },
  ];
  return (
    <div className="dashboard enter">
      <PageHeader
        title="Overview"
        subtitle="Your pharmacy at a glance."
        eyebrow="Dashboard"
        actions={
          <>
            {can('purchases', true) ? (
              <button className="button secondary" onClick={() => navigate('/purchases/new')}>
                <Truck size={16} />
                {t('New purchase')}
              </button>
            ) : null}
            {can('sales', true) ? (
              <button className="button primary" onClick={() => navigate('/sales/new')}>
                <Plus size={17} />
                {t('New sale')}
              </button>
            ) : null}
          </>
        }
      />
      <div className="stats-grid">
        {cards.map(({ title, value, Icon, color, foot }) => (
          <section className="stat-card" key={title}>
            <div className="stat-top">
              <span>{t(title)}</span>
              <span className={`stat-icon ${color}`}>
                <Icon size={18} />
              </span>
            </div>
            <div className="stat-value">
              {money(value, language)}
              <small>{t('AFN')}</small>
            </div>
            <div className="stat-foot">
              <span className={`tiny-dot ${color}`} />
              {foot}
            </div>
          </section>
        ))}
      </div>
      <div className="dashboard-main">
        <section className="panel sales-chart">
          <div className="panel-header">
            <div>
              <h2>{t('Sales overview')}</h2>
              <p>{t('A clear view of your daily operations.')}</p>
            </div>
            <span className="date-chip">
              <CalendarDays size={13} />
              {t('Last 30 days')}
            </span>
          </div>
          <div className="chart-summary">
            <strong>
              {money(totals.sales_minor - totals.returns_minor, language)} <small>{t('AFN')}</small>
            </strong>
            <span>
              <i className="legend-dot" />
              {t('Sales')}
            </span>
          </div>
          {trend.some((v) => v.sales_minor > 0) ? (
            <div className="chart-area">
              <div className="chart-y">
                {[1, 0.75, 0.5, 0.25, 0].map((n) => (
                  <span key={n}>{number(Math.round((max * n) / 100), language)}</span>
                ))}
              </div>
              <div className="bars">
                {trend.map((day, i) => (
                  <div className="bar-column" key={day.date}>
                    <div
                      className={`bar ${i === trend.length - 1 ? 'highlight' : ''}`}
                      style={{ height: `${Math.max(2, (day.sales_minor / max) * 100)}%` }}
                      title={`${dateLabel(day.date, language, calendar)}: ${money(day.sales_minor, language)} AFN`}
                    />
                    <span>
                      {i % Math.max(1, Math.ceil(trend.length / 7)) === 0 || i === trend.length - 1
                        ? dateLabel(day.date, language, calendar).split(' ').slice(0, 2).join(' ')
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="chart-empty">
              <Activity size={38} strokeWidth={1} />
              <strong>{t('No sales in this period')}</strong>
              <span>{t('Create your first sale to see the trend.')}</span>
              <div className="empty-chart-lines" />
            </div>
          )}
        </section>
        <section className="inventory-glance">
          <div className="glance-top">
            <span className="eyebrow">{t('Inventory')}</span>
            <span className="glance-icon">
              <Package size={23} />
            </span>
          </div>
          <h2>{t('Available units')}</h2>
          <strong className="glance-value">{number(totals.stock_units, language)}</strong>
          <div className="inventory-art" aria-hidden="true">
            <div className="medicine-box">
              <span>Rx</span>
              <b>PHARMACY</b>
              <i />
              <small>Care essentials</small>
            </div>
            <div className="pill-bottle">
              <div />
              <span>+</span>
            </div>
            <div className="pill mini-pill" />
          </div>
          <div className="glance-bottom">
            {totals.stock_value_minor !== undefined ? (
              <div>
                <span>{t('Stock value')}</span>
                <strong>
                  {money(totals.stock_value_minor, language)} {t('AFN')}
                </strong>
              </div>
            ) : (
              <span>{t('Start with a purchase or opening stock.')}</span>
            )}
            {can('stock') ? (
              <button
                className="round-button"
                onClick={() => navigate('/stock')}
                aria-label={t('Inventory')}
              >
                <ArrowUpRight size={20} />
              </button>
            ) : null}
          </div>
        </section>
      </div>
      <div className="dashboard-lower">
        <section className="panel">
          <div className="panel-header">
            <div className="section-title">
              <h2>{t('Recent invoices')}</h2>
              <span className="count-chip">{data.recent.length}</span>
            </div>
            {can('sales') ? (
              <button className="text-button" onClick={() => navigate('/sales')}>
                {t('View all')}
                <ArrowUpRight size={14} />
              </button>
            ) : null}
          </div>
          <DataTable
            data={data.recent}
            columns={[
              {
                accessorKey: 'number',
                header: t('Invoice'),
                cell: (i) => <span className="mono strong">{String(i.getValue())}</span>,
              },
              {
                accessorKey: 'party_name',
                header: t('Customer'),
                cell: (i) => t(String(i.getValue())),
              },
              {
                accessorKey: 'date',
                header: t('Date'),
                cell: (i) => dateLabel(String(i.getValue()), language, calendar),
              },
              {
                accessorKey: 'total_minor',
                header: t('Total'),
                cell: (i) => (
                  <strong className="tabular">{money(Number(i.getValue()), language)}</strong>
                ),
              },
              {
                accessorKey: 'outstanding_minor',
                header: t('Status'),
                cell: (i) => (
                  <Badge tone={Number(i.getValue()) > 0 ? 'amber' : 'green'}>
                    {t(Number(i.getValue()) > 0 ? 'Outstanding' : 'Paid')}
                  </Badge>
                ),
              },
            ]}
          />
        </section>
        <section className="panel attention-panel">
          <div className="panel-header">
            <h2>{t('Needs attention')}</h2>
            <span className="attention-count">{totals.low_stock_count + totals.expiry_count}</span>
          </div>
          <div className="attention-summary">
            <button onClick={() => navigate('/products?low=1')} disabled={!can('products')}>
              <span className="attention-icon amber">
                <Package size={17} />
              </span>
              <span>
                {t('Low stock')}
                <b>{totals.low_stock_count}</b>
              </span>
              <ChevronRight size={15} />
            </button>
            <button onClick={() => navigate('/stock?tab=alerts')} disabled={!can('stock')}>
              <span className="attention-icon red">
                <CalendarDays size={17} />
              </span>
              <span>
                {t('Expiring soon')}
                <b>{totals.expiry_count}</b>
              </span>
              <ChevronRight size={15} />
            </button>
          </div>
          {data.low_stock.length ? (
            <div className="low-stock-list">
              {data.low_stock.map((p: Data) => (
                <div key={p.id}>
                  <span className="product-mini">
                    <Package size={18} />
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.on_hand} {p.base_unit}
                    </small>
                  </div>
                  <Badge tone={p.on_hand === 0 ? 'red' : 'amber'}>
                    {t(p.on_hand === 0 ? 'Out of stock' : 'Low stock')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="All caught up" description="Your stock is looking healthy." />
          )}
        </section>
      </div>
      <div className="dashboard-foot">
        <ShieldCheck size={14} />
        {t('Built for better pharmacy days')}
        <span>Radefy Pharmacy</span>
      </div>
    </div>
  );
}
