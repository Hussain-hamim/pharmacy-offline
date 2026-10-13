import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setToken, ApiError, desktop } from './api';
import { flushDrafts } from './hooks/useDraft';
import { translate } from './i18n';
import type { Language, User, Pharmacy } from './types';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
interface AppContextValue {
  user: User | null;
  setSession: (token: string, user: User) => void;
  logout: () => void;
  language: Language;
  setLanguage: (l: Language) => void;
  calendar: 'persian' | 'gregory';
  setCalendar: (c: 'persian' | 'gregory') => void;
  t: (s: string) => string;
  settings: Pharmacy | undefined;
  notify: (message: string, error?: boolean) => void;
  can: (module: string, write?: boolean) => boolean;
  special: (key: string) => boolean;
}
const Context = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [language, setLanguageState] = useState<Language>(
    () => (localStorage.getItem('pharmacy.language') as Language) || 'en',
  );
  const [calendar, setCalendarState] = useState<'persian' | 'gregory'>(
    () => (localStorage.getItem('pharmacy.calendar') as 'persian' | 'gregory') || 'persian',
  );
  const [toasts, setToasts] = useState<{ id: number; message: string; error: boolean }[]>([]);
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Pharmacy>('settings'),
    enabled: !!user,
    staleTime: Infinity,
  });
  const setLanguage = (l: Language) => {
    setLanguageState(l);
    localStorage.setItem('pharmacy.language', l);
  };
  const setCalendar = (c: 'persian' | 'gregory') => {
    setCalendarState(c);
    localStorage.setItem('pharmacy.calendar', c);
  };
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
  }, [language]);
  const notify = (message: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items.slice(-3), { id, message, error }]);
    setTimeout(() => setToasts((items) => items.filter((x) => x.id !== id)), 6000);
  };
  const logout = () => {
    void flushDrafts()
      .then(async () => {
        await api('logout');
        setToken(null);
        setUser(null);
        client.clear();
      })
      .catch((error: Error) => notify(error.message, true));
  };
  useEffect(() => {
    if (!desktop) return;
    let stop: (() => void) | undefined;
    let disposed = false;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const unlisten = await window.onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await flushDrafts();
          await window.destroy();
        } catch (error) {
          notify((error as Error).message, true);
        }
      });
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'error') {
          const e = event.query.state.error;
          if (e instanceof ApiError && e.code === 'AUTH') {
            setToken(null);
            setUser(null);
          }
        }
      }),
    [client],
  );
  const value: AppContextValue = {
    user,
    setSession: (token, user) => {
      setToken(token);
      setUser(user);
      client.clear();
    },
    logout,
    language,
    setLanguage,
    calendar,
    setCalendar,
    t: (s) => translate(s, language),
    settings: settingsQuery.data,
    notify,
    can: (module, write = false) =>
      !!user &&
      (user.role === 'Administrator' ||
        user.permissions[module] === 'write' ||
        (!write && user.permissions[module] === 'read')),
    special: (key) => !!user && (user.role === 'Administrator' || user.permissions[key] === true),
  };
  return (
    <Context.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div className={`toast ${item.error ? 'error' : ''}`} key={item.id}>
            {item.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{translate(item.message, language)}</span>
            <button
              className="icon-button"
              aria-label={translate('Close', language)}
              onClick={() => setToasts((items) => items.filter((x) => x.id !== item.id))}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
export function useApp() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('AppProvider missing');
  return ctx;
}
