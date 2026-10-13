import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import type { Data } from '../types';
import { api } from '../api';
import { useApp } from '../context';
import { PageHeader, Spinner, ErrorState, Confirm } from '../components/ui';
import BillEditor from './BillEditor';
import ReturnEditor from './ReturnEditor';
import { SettingsBody } from './Settings';
import { RecordEditor } from './Forms';
export default function DraftResume() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, notify } = useApp();
  const client = useQueryClient();
  const [discard, setDiscard] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, Data>>({});
  const query = useQuery({
    queryKey: ['detail', 'draft', id],
    queryFn: () => api('detail', { entity: 'draft', id }),
  });
  useEffect(() => {
    if (query.data && id) setLoaded((old) => ({ ...old, [id]: query.data! }));
  }, [query.data, id]);
  const data = loaded[id || ''] || query.data;
  if (!data && query.isLoading) return <Spinner />;
  if (!data) return <ErrorState error={query.error || new Error('Draft not found')} />;
  return (
    <>
      <div className="draft-resume-bar">
        <span>
          {t('Resume draft')}: {data.title}
        </span>
        <button className="text-button danger-text" onClick={() => setDiscard(true)}>
          <Trash2 size={14} />
          {t('Discard draft')}
        </button>
      </div>
      {data.kind === 'settings' ? (
        <SettingsBody initial={data.payload} existing={data} />
      ) : ['sale', 'purchase'].includes(data.kind) ? (
        <BillEditor kind={data.kind} existing={data} />
      ) : data.kind.endsWith('_return') ? (
        <ReturnEditor existing={data} />
      ) : (
        <>
          <PageHeader title="Resume draft" />
          <RecordEditor kind={data.kind} existing={data} onClose={() => navigate('/drafts')} />
        </>
      )}
      {discard ? (
        <Confirm
          title="Discard this draft?"
          description="This cannot be undone."
          danger
          onClose={() => setDiscard(false)}
          onConfirm={() =>
            void api('delete_draft', { id })
              .then(() => {
                void client.invalidateQueries();
                notify('Saved');
                navigate('/drafts');
              })
              .catch((e) => notify(e.message, true))
          }
        />
      ) : null}
    </>
  );
}
