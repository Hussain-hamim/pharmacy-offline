import { useEffect, useRef, useState } from 'react';
import { api, requestId } from '../api';
import type { Data } from '../types';
const pending = new Set<() => Promise<unknown>>();
export async function flushDrafts() {
  await Promise.all(Array.from(pending, (save) => save()));
}
export function useDraft(
  kind: string,
  title: string,
  payload: Data,
  existing?: Data,
  enabled = true,
) {
  const id = useRef(existing?.id || requestId());
  const revision = useRef(existing?.revision || 0);
  const initial = useRef(JSON.stringify(payload));
  const latest = useRef(payload);
  latest.current = payload;
  const lastSaved = useRef(initial.current);
  const stopped = useRef(false);
  const mounted = useRef(true);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const config = useRef({ kind, title });
  config.current = { kind, title };
  const serialized = JSON.stringify(payload);
  async function save() {
    if (stopped.current || !enabled) return;
    const data = JSON.stringify(latest.current);
    if (data === lastSaved.current) return;
    const operation = queue.current
      .catch(() => {})
      .then(async () => {
        if (stopped.current || data === lastSaved.current) return;
        if (mounted.current) setStatus('Saving…');
        try {
          const r = await api('save_draft', {
            id: id.current,
            kind: config.current.kind,
            title: config.current.title,
            payload: JSON.parse(data),
            revision: revision.current,
          });
          revision.current = r.revision;
          lastSaved.current = data;
          if (mounted.current) {
            setStatus('Saved locally');
            setError('');
          }
        } catch (e) {
          if (mounted.current) {
            setStatus('Unsaved changes');
            setError((e as Error).message);
          }
          throw e;
        }
      });
    queue.current = operation;
    return operation;
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!enabled || serialized === lastSaved.current) return;
    setStatus('Unsaved changes');
    const timer = setTimeout(() => void saveRef.current().catch(() => {}), 1000);
    return () => clearTimeout(timer);
  }, [serialized, enabled]);
  useEffect(() => {
    mounted.current = true;
    const flush = () => saveRef.current();
    pending.add(flush);
    return () => {
      pending.delete(flush);
      mounted.current = false;
      void saveRef.current().catch(() => {});
    };
  }, []);
  return {
    id: id.current,
    status,
    error,
    flush: () => saveRef.current(),
    stop: async () => {
      stopped.current = true;
      await queue.current.catch(() => {});
    },
    commit: () => {
      revision.current = 0;
      id.current = requestId();
      lastSaved.current = JSON.stringify(latest.current);
      stopped.current = false;
      setStatus('Saved locally');
    },
    resume: () => {
      stopped.current = false;
    },
    discard: async () => {
      stopped.current = true;
      await queue.current.catch(() => {});
      await api('delete_draft', { id: id.current });
    },
  };
}
