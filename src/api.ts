import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Action, Data } from './types';
let token: string | null = null;
export function setToken(value: string | null) {
  token = value;
}
export const desktop = isTauri();
export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
const previewUnavailable =
  'The local preview server is unavailable. Start the backend and try again.';
export async function api<T = Data>(action: Action, payload: Data = {}): Promise<T> {
  try {
    if (desktop) return await invoke<T>('request', { action, payload, token });
    if (import.meta.env.DEV) {
      const response = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload, token }),
      }).catch(() => {
        throw new ApiError('CONNECTION', previewUnavailable);
      });
      const result = await response.json().catch(() => {
        throw new ApiError(
          'CONNECTION',
          response.ok
            ? 'The local preview server returned an invalid response. Restart it and try again.'
            : previewUnavailable,
        );
      });
      if (!response.ok) {
        throw new ApiError(
          typeof result?.code === 'string' ? result.code : 'CONNECTION',
          typeof result?.message === 'string' ? result.message : previewUnavailable,
        );
      }
      return result as T;
    }
    throw new ApiError('DESKTOP', 'Open the installed desktop application');
  } catch (error) {
    const e = error as { code?: string; message?: string };
    throw new ApiError(e.code || 'CONNECTION', e.message || String(error));
  }
}
export async function chooseFile(
  mode: 'open' | 'save',
  extension: string,
  defaultName?: string,
): Promise<string | null> {
  if (desktop) {
    const dialog = await import('@tauri-apps/plugin-dialog');
    const filters = [{ name: extension.toUpperCase(), extensions: [extension] }];
    if (mode === 'open') {
      const result = await dialog.open({ multiple: false, directory: false, filters });
      return typeof result === 'string' ? result : null;
    }
    return dialog.save({ filters, defaultPath: defaultName });
  }
  return window.prompt(
    `Development preview: absolute ${mode === 'open' ? 'source' : 'destination'} path`,
    defaultName ? `/tmp/${defaultName}` : '/tmp/backup.pharmbackup',
  );
}
export const requestId = () => crypto.randomUUID();

export async function printPage() {
  if (desktop && /Mac/.test(navigator.platform)) await invoke('print_page', { token });
  else window.print();
}
