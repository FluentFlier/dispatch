import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Phase: Admin Dashboard', () => {
  describe('A1: Admin email allowlist', () => {
    const original = process.env.ADMIN_EMAILS;

    afterEach(() => {
      if (original === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = original;
      vi.resetModules();
    });

    it('should deny all when ADMIN_EMAILS is empty', async () => {
      delete process.env.ADMIN_EMAILS;
      vi.resetModules();
      const { isAdminEmail } = await import('@/lib/admin');
      expect(isAdminEmail('ops@dispatch.app')).toBe(false);
    });

    it('should allow listed emails case-insensitively', async () => {
      process.env.ADMIN_EMAILS = 'Ops@Dispatch.app, admin@example.com';
      vi.resetModules();
      const { isAdminEmail, getAdminEmails } = await import('@/lib/admin');
      expect(getAdminEmails()).toEqual(['ops@dispatch.app', 'admin@example.com']);
      expect(isAdminEmail('OPS@dispatch.app')).toBe(true);
      expect(isAdminEmail('other@example.com')).toBe(false);
    });
  });

  describe('A2: assertAdmin rejects non-admins', () => {
    it('should throw 403 when authenticated but not on allowlist', async () => {
      process.env.ADMIN_EMAILS = 'admin@dispatch.app';
      vi.resetModules();

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: 'u1', email: 'user@test.com' }),
      }));

      const { assertAdmin, AdminError } = await import('@/lib/admin');
      await expect(assertAdmin()).rejects.toThrow(AdminError);
      await expect(assertAdmin()).rejects.toMatchObject({ status: 403 });
    });

    it('should throw 401 when not authenticated', async () => {
      process.env.ADMIN_EMAILS = 'admin@dispatch.app';
      vi.resetModules();

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue(null),
      }));

      const { assertAdmin } = await import('@/lib/admin');
      await expect(assertAdmin()).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('A3: Admin API route auth', () => {
    it('PATCH /api/admin/flags should return 401 without admin session', async () => {
      vi.doMock('@/lib/admin', async () => {
        const actual = await vi.importActual<typeof import('@/lib/admin')>('@/lib/admin');
        return {
          ...actual,
          assertAdmin: vi.fn().mockRejectedValue(new actual.AdminError('Unauthenticated', 401)),
        };
      });

      const { PATCH } = await import('@/app/api/admin/flags/[name]/route');
      const req = new Request('http://localhost/api/admin/flags/signals_engine', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      const res = await PATCH(req as never, { params: { name: 'signals_engine' } });
      expect(res.status).toBe(401);
    });
  });

  describe('A4: System health', () => {
    it('should report adminEmailsConfigured from env', async () => {
      process.env.ADMIN_EMAILS = 'a@b.com';
      vi.resetModules();
      const { getAdminSystemHealth } = await import('@/lib/admin-data');
      const health = getAdminSystemHealth();
      expect(health.adminEmailsConfigured).toBe(true);
      expect(health.checks).toHaveProperty('insforge');
    });
  });
});
