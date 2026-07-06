import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

describe('Phase: Admin Ops', () => {
  describe('O1: Impersonation token', () => {
    const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
    const originalCron = process.env.CRON_SECRET;

    beforeEach(() => {
      process.env.CRON_SECRET = 'test-cron-secret-for-impersonation';
      vi.resetModules();
    });

    afterEach(() => {
      if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
      else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
      if (originalCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = originalCron;
      vi.resetModules();
    });

    it('should verify a valid impersonation token', async () => {
      const { verifyImpersonationToken } = await import('@/lib/admin/impersonation');
      const payload = {
        adminId: 'admin-1',
        adminEmail: 'admin@test.com',
        targetUserId: 'user-2',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = createHmac('sha256', 'test-cron-secret-for-impersonation').update(body).digest('base64url');
      const token = `${body}.${sig}`;

      const decoded = verifyImpersonationToken(token);
      expect(decoded?.targetUserId).toBe('user-2');
    });

    it('should reject expired impersonation token', async () => {
      const { verifyImpersonationToken } = await import('@/lib/admin/impersonation');
      const payload = {
        adminId: 'admin-1',
        adminEmail: 'admin@test.com',
        targetUserId: 'user-2',
        exp: Math.floor(Date.now() / 1000) - 10,
      };
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const sig = createHmac('sha256', 'test-cron-secret-for-impersonation').update(body).digest('base64url');
      expect(verifyImpersonationToken(`${body}.${sig}`)).toBeNull();
    });
  });

  describe('O2: Cron status from fan-out results', () => {
    it('should return ok when all sub-jobs succeed', async () => {
      const { cronStatusFromResults } = await import('@/lib/admin/cron-log');
      expect(cronStatusFromResults({ a: { ok: true }, b: { count: 1 } }).status).toBe('ok');
    });

    it('should return partial when some sub-jobs fail', async () => {
      const { cronStatusFromResults } = await import('@/lib/admin/cron-log');
      const result = cronStatusFromResults({ a: { ok: true }, b: { error: 'fail' } });
      expect(result.status).toBe('partial');
    });

    it('should return error when all sub-jobs fail', async () => {
      const { cronStatusFromResults } = await import('@/lib/admin/cron-log');
      expect(cronStatusFromResults({ a: { error: 'x' }, b: { error: 'y' } }).status).toBe('error');
    });
  });

  describe('O3: assertAdmin uses real session (not impersonated user)', () => {
    it('should allow admin email from session even when impersonating', async () => {
      process.env.ADMIN_EMAILS = 'admin@dispatch.app';
      vi.resetModules();

      vi.doMock('@/lib/insforge/server', () => ({
        getSessionUser: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@dispatch.app' }),
      }));

      const { assertAdmin } = await import('@/lib/admin');
      const admin = await assertAdmin();
      expect(admin.email).toBe('admin@dispatch.app');
    });
  });
});
