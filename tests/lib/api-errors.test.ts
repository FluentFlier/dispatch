import { describe, it, expect, vi } from 'vitest';
import { errorResponse, serverError } from '@/lib/api-errors';

describe('errorResponse', () => {
  it('returns the given status and only the generic message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse('Could not save post.', 400);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Could not save post.' });
    spy.mockRestore();
  });

  it('logs the cause server-side but never leaks it to the client', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const dbError = new Error('column "secret_token" violates constraint xyz');
    const res = errorResponse('Could not load analytics.', 500, dbError);
    const body = await res.json();
    expect(body).toEqual({ error: 'Could not load analytics.' });
    expect(JSON.stringify(body)).not.toContain('constraint');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('serverError defaults to status 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = serverError();
    expect(res.status).toBe(500);
    spy.mockRestore();
  });
});
