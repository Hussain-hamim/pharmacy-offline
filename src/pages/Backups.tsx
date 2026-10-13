import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HardDrive,
  Download,
  Upload,
  Clock3,
  ShieldCheck,
  FolderArchive,
  RefreshCw,
  Usb,
} from 'lucide-react';
import { api, chooseFile, desktop } from '../api';
import { useApp } from '../context';
import { dateLabel } from '../format';
import {
  PageHeader,
  DataTable,
  Pagination,
  usePaged,
  Spinner,
  ErrorState,
  Modal,
  Badge,
} from '../components/ui';
import { columnsFor } from './Records';
import type { Data } from '../types';
export default function Backups() {
  const { t, language, calendar, can, special, notify, logout } = useApp();
  const client = useQueryClient();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<Data | null>(null);
  const [restore, setRestore] = useState<{ path: string; manifest: Data } | null>(null);
  const [limit, setLimit] = useState(50);
  const query = useQuery({
    queryKey: ['backup_status'],
    queryFn: () => api('backup_status'),
    enabled: can('backups'),
    refetchInterval: 60000,
  });
  const history = usePaged('backups', { limit }, can('backups'));
  useEffect(() => {
    if (!desktop) return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen<Data>('operation-progress', (e) => {
        if (e.payload.stage !== 'export') setProgress(e.payload);
        if (e.payload.stage === 'complete') void client.invalidateQueries();
      });
      if (disposed) stop();
      else cleanup = stop;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [client]);
  async function create() {
    const path = await chooseFile(
      'save',
      'pharmbackup',
      `pharmacy-${new Date().toISOString().slice(0, 10)}.pharmbackup`,
    );
    if (!path) return;
    setBusy('Backing up…');
    setError('');
    try {
      const result = await api('backup', { path });
      await client.invalidateQueries();
      const failures = result.destinations.filter((d: Data) => d.status === 'failed');
      notify(
        failures.length
          ? `${t('Backup complete')} · ${failures.length} ${t('Failed')}`
          : 'Backup complete',
        !!failures.length,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      setProgress(null);
    }
  }
  async function selectRestore() {
    const path = await chooseFile('open', 'pharmbackup');
    if (!path) return;
    setError('');
    try {
      setRestore({ path, manifest: await api('inspect_backup', { path }) });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function confirmRestore() {
    if (!restore) return;
    setBusy('Restoring…');
    setError('');
    try {
      await api('restore', { path: restore.path });
      setRestore(null);
      notify('Saved');
      logout();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
      setProgress(null);
    }
  }
  if (!can('backups')) return <ErrorState error={new Error(t('Access denied'))} />;
  return (
    <div className="enter">
      <PageHeader
        title="Backup & restore"
        actions={
          <>
            {special('restore') && can('backups', true) ? (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => void selectRestore()}
              >
                <Upload size={16} />
                {t('Restore from file')}
              </button>
            ) : null}
            {can('backups', true) ? (
              <button className="button primary" disabled={!!busy} onClick={() => void create()}>
                {busy ? <Spinner /> : <Download size={16} />} {t('Backup now')}
              </button>
            ) : null}
          </>
        }
      />
      {error ? <div className="inline-error">{t(error)}</div> : null}
      {busy ? (
        <div className="operation-progress">
          <Spinner />
          <strong>{t(busy)}</strong>
          <span>{progress?.destination}</span>
          <progress max="100" value={progress?.percent} />
        </div>
      ) : null}
      <div className="backup-summary">
        <section className="backup-hero">
          <span className="backup-hero-icon">
            <FolderArchive size={30} />
          </span>
          <div>
            <span className="eyebrow">{t('Automatic backup')}</span>
            <h2>{t('Every 24 hours while open')}</h2>
            <p>{t('30 automatic backups per drive. Manual backups are kept.')}</p>
          </div>
          <ShieldCheck size={38} strokeWidth={1.2} />
        </section>
        <section className="panel last-backup">
          <Clock3 size={21} />
          <span>{t('Last successful backup')}</span>
          <strong>
            {query.data?.last_auto_backup
              ? dateLabel(query.data.last_auto_backup, language, calendar)
              : t('Not yet backed up')}
          </strong>
          <Badge tone={query.data?.due ? 'amber' : 'green'}>
            {t(query.data?.due ? 'Needs attention' : 'Successful')}
          </Badge>
        </section>
      </div>
      <section className="panel destinations-panel">
        <div className="panel-header">
          <h2>{t('Backup destinations')}</h2>
          <button
            className="icon-button"
            onClick={() => void query.refetch()}
            aria-label={t('Retry')}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        {query.error ? (
          <ErrorState error={query.error} />
        ) : (
          <div className="destination-grid">
            {query.data?.destinations.map((d: Data, i: number) => (
              <div className="destination" key={i}>
                <span className="drive-icon">
                  {d.removable ? <Usb size={23} /> : <HardDrive size={23} />}
                </span>
                <div>
                  <strong>{t(d.name)}</strong>
                  <span title={d.path}>{d.path}</span>
                  <small>
                    {d.physical_disk
                      ? `${t('Physical disk')}: ${d.physical_disk}`
                      : t('Physical independence not verified')}
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="backup-note">
          {t('Backups are unencrypted. Store them in a trusted location.')}
        </p>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>{t('Backup history')}</h2>
        </div>
        {history.error ? (
          <ErrorState error={history.error} />
        ) : (
          <DataTable
            columns={columnsFor('backups', t, language, calendar)}
            data={history.data?.items || []}
          />
        )}
        <Pagination
          next={history.next}
          previous={history.previous}
          page={history.page}
          limit={limit}
          onLimit={setLimit}
          hasNext={!!history.data?.next_cursor}
          hasPrevious={!!history.data?.previous_cursor}
        />
      </section>
      {restore ? (
        <Modal
          compact
          title="Restore this backup?"
          onClose={() => {
            if (!busy) setRestore(null);
          }}
          footer={
            <>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => setRestore(null)}
              >
                {t('Cancel')}
              </button>
              <button
                className="button danger"
                disabled={!!busy}
                onClick={() => void confirmRestore()}
              >
                {busy ? <Spinner /> : null}
                {t('Confirm restore')}
              </button>
            </>
          }
        >
          <div className="restore-info">
            <strong>{restore.manifest.pharmacy}</strong>
            <span>{dateLabel(restore.manifest.created_at, language, calendar)}</span>
            <span>v{restore.manifest.app_version}</span>
          </div>
          <p>
            {t(
              'Your current data will be backed up before replacement. You will need to sign in again.',
            )}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
