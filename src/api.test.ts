import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setToken } from './api';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setToken(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('browser preview API', () => {
  it.each(['', '<html>Bad gateway</html>'])(
    'explains unavailable backend responses (%j)',
    async (body) => {
      fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
      await expect(api('bootstrap')).rejects.toMatchObject({
        code: 'CONNECTION',
        message: 'The local preview server is unavailable. Start the backend and try again.',
      });
    },
  );

  it('explains network failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('bootstrap')).rejects.toMatchObject({
      code: 'CONNECTION',
      message: 'The local preview server is unavailable. Start the backend and try again.',
    });
  });

  it('explains invalid successful responses without exposing JSON parser errors', async () => {
    fetchMock.mockResolvedValue(new Response(''));
    await expect(api('bootstrap')).rejects.toMatchObject({
      code: 'CONNECTION',
      message: 'The local preview server returned an invalid response. Restart it and try again.',
    });
  });

  it('preserves backend authentication and validation errors', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: 'AUTH', message: 'Username or password is incorrect' },
        { status: 400 },
      ),
    );
    await expect(api('login')).rejects.toMatchObject({
      code: 'AUTH',
      message: 'Username or password is incorrect',
    });
  });

  it('can retry successfully after a backend outage', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(Response.json({ setup_required: false }));
    await expect(api('bootstrap')).rejects.toMatchObject({ code: 'CONNECTION' });
    await expect(api('bootstrap')).resolves.toEqual({ setup_required: false });
  });
});
