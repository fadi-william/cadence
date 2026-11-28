import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';
import type { AuditService } from '../audit/audit.service';
import type { MailerService } from '../mail/mailer.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Prisma } from '../generated/prisma/client';

const admin: AuthenticatedUser = { id: 'admin', email: 'a@cadence.local', role: 'ADMIN' };
const lead: AuthenticatedUser = { id: 'tl1', email: 'tl@cadence.local', role: 'TRIBE_LEAD' };
const em: AuthenticatedUser = { id: 'em1', email: 'em@cadence.local', role: 'ENGINEERING_MANAGER' };

const u = (id: string, role: string, over: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@cadence.local`,
  name: id.toUpperCase(),
  role,
  reportsToId: null,
  tribeName: null,
  _count: { reports: 0, members: 0 },
  ...over,
});

describe('UsersService', () => {
  const prisma = {
    user: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    refreshToken: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const auth = { hashPassword: vi.fn(), createResetLink: vi.fn() };
  const audit = { record: vi.fn() };
  const mailer = { send: vi.fn(), configured: false };
  const svc = new UsersService(
    prisma as unknown as PrismaService,
    auth as unknown as AuthService,
    audit as unknown as AuditService,
    mailer as unknown as MailerService,
  );
  /** Users visible to the current list() call. */
  let visible: ReturnType<typeof u>[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    mailer.configured = false;
    visible = [];
    prisma.user.findMany.mockImplementation(async () => visible);
    auth.hashPassword.mockResolvedValue('hashed');
    prisma.user.create.mockImplementation(async ({ data }) => ({ id: 'new', ...data }));
    prisma.user.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  });

  describe('list scoping', () => {
    it('admins see all non-admins by default, or a role filter', async () => {
      await svc.list(admin);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ role: { not: 'ADMIN' } });
      await svc.list(admin, 'TRIBE_LEAD');
      expect(prisma.user.findMany.mock.calls[1][0].where).toEqual({ role: 'TRIBE_LEAD' });
    });

    it('tribe leads see themselves and their reports', async () => {
      await svc.list(lead);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
        role: { not: 'ADMIN' },
        OR: [{ id: 'tl1' }, { reportsToId: 'tl1' }],
      });
    });

    it('engineering managers see only themselves', async () => {
      await svc.list(em);
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ role: { not: 'ADMIN' }, id: 'em1' });
    });
  });

  it('get 404s for users outside the visible set', async () => {
    visible = [u('em1', 'ENGINEERING_MANAGER')];
    await expect(svc.get(em, 'em1')).resolves.toMatchObject({ id: 'em1' });
    await expect(svc.get(em, 'em2')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('create', () => {
    const body = { email: 'New@Cadence.local', name: 'New', password: 'p'.repeat(12) };

    it('admins create tribe leads who report to them, keeping the tribe name', async () => {
      const out = await svc.create(admin, { ...body, role: 'TRIBE_LEAD', tribeName: 'Payments' });
      expect(prisma.user.create.mock.calls[0][0].data).toEqual({
        email: 'new@cadence.local',
        name: 'New',
        role: 'TRIBE_LEAD',
        tribeName: 'Payments',
        reportsToId: 'admin',
        passwordHash: 'hashed',
      });
      expect(out.id).toBe('new');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.created',
          metadata: { email: 'new@cadence.local', role: 'TRIBE_LEAD' },
        }),
      );
    });

    it('only admins create tribe leads', async () => {
      await expect(svc.create(lead, { ...body, role: 'TRIBE_LEAD' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.create(em, { ...body, role: 'TRIBE_LEAD' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('tribe leads create EMs under themselves and drop the tribe name', async () => {
      await svc.create(lead, { ...body, role: 'ENGINEERING_MANAGER', tribeName: 'ignored' });
      expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ reportsToId: 'tl1', tribeName: null });
      await svc.create(lead, { ...body, role: 'ENGINEERING_MANAGER', reportsToId: 'tl1' });
      await expect(
        svc.create(lead, { ...body, role: 'ENGINEERING_MANAGER', reportsToId: 'tl2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('engineering managers cannot create users', async () => {
      await expect(svc.create(em, { ...body, role: 'ENGINEERING_MANAGER' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('admins must name an existing tribe lead for a new EM', async () => {
      await expect(svc.create(admin, { ...body, role: 'ENGINEERING_MANAGER' })).rejects.toThrow(
        'reportsToId (a tribe lead) is required',
      );
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(
        svc.create(admin, { ...body, role: 'ENGINEERING_MANAGER', reportsToId: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      prisma.user.findUnique.mockResolvedValueOnce(u('em2', 'ENGINEERING_MANAGER'));
      await expect(svc.create(admin, { ...body, role: 'ENGINEERING_MANAGER', reportsToId: 'em2' })).rejects.toThrow(
        'reportsToId must be a tribe lead',
      );

      prisma.user.findUnique.mockResolvedValueOnce(u('tl1', 'TRIBE_LEAD'));
      await svc.create(admin, { ...body, role: 'ENGINEERING_MANAGER', reportsToId: 'tl1' });
      expect(prisma.user.create.mock.calls[0][0].data.reportsToId).toBe('tl1');
    });

    it('maps a duplicate email to 409 and rethrows other errors', async () => {
      prisma.user.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(svc.create(admin, { ...body, role: 'TRIBE_LEAD' })).rejects.toBeInstanceOf(ConflictException);
      prisma.user.create.mockRejectedValueOnce(new Error('db down'));
      await expect(svc.create(admin, { ...body, role: 'TRIBE_LEAD' })).rejects.toThrow('db down');
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('a tribe lead cannot edit another tribe lead, but can edit themselves', async () => {
      visible = [u('tl1', 'TRIBE_LEAD'), u('tl2', 'TRIBE_LEAD')];
      await expect(svc.update(lead, 'tl2', { name: 'X' })).rejects.toBeInstanceOf(ForbiddenException);
      await svc.update(lead, 'tl1', { name: 'Me', tribeName: 'Core' });
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ name: 'Me', tribeName: 'Core' });
    });

    it('ignores tribeName for EMs and lowercases email', async () => {
      visible = [u('em1', 'ENGINEERING_MANAGER')];
      await svc.update(admin, 'em1', { email: 'EM@Cadence.local', tribeName: 'nope' });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({
        name: undefined,
        email: 'em@cadence.local',
        tribeName: undefined,
      });
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('hashes a new password, revokes sessions and redacts it in the audit log', async () => {
      visible = [u('em1', 'ENGINEERING_MANAGER')];
      await svc.update(lead, 'em1', { password: 'p'.repeat(12) });
      expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
        passwordHash: 'hashed',
        passwordChangedAt: expect.any(Date),
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'em1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { fields: ['password(changed)'] } }),
      );
    });

    it('changes the password and revokes sessions in one transaction', async () => {
      visible = [u('em1', 'ENGINEERING_MANAGER')];
      const update = Promise.resolve({ id: 'em1' });
      const revoke = Promise.resolve({ count: 2 });
      prisma.user.update.mockReturnValue(update);
      prisma.refreshToken.updateMany.mockReturnValue(revoke);
      await expect(svc.update(lead, 'em1', { password: 'p'.repeat(12) })).resolves.toEqual({ id: 'em1' });
      expect(prisma.$transaction).toHaveBeenCalledWith([update, revoke]);
    });

    it('does not open a transaction when the password is unchanged', async () => {
      visible = [u('em1', 'ENGINEERING_MANAGER')];
      await svc.update(lead, 'em1', { name: 'Renamed' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('re-parents an EM only via the reportsTo rules', async () => {
      visible = [u('em1', 'ENGINEERING_MANAGER')];
      prisma.user.findUnique.mockResolvedValue(u('tl2', 'TRIBE_LEAD'));
      await svc.update(admin, 'em1', { reportsToId: 'tl2' });
      expect(prisma.user.update.mock.calls[0][0].data.reportsToId).toBe('tl2');

      await expect(svc.update(lead, 'em1', { reportsToId: 'tl2' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.update(em, 'em1', { reportsToId: 'tl2' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ignores reportsToId for tribe leads', async () => {
      visible = [u('tl1', 'TRIBE_LEAD')];
      await svc.update(admin, 'tl1', { reportsToId: 'someone' });
      expect(prisma.user.update.mock.calls[0][0].data).not.toHaveProperty('reportsToId');
    });
  });

  describe('resetLink', () => {
    const expiresAt = new Date('2026-12-01T00:00:00Z');
    beforeEach(() => {
      visible = [u('tl1', 'TRIBE_LEAD'), u('em1', 'ENGINEERING_MANAGER')];
      auth.createResetLink.mockResolvedValue({ url: 'https://app/reset?token=t', expiresAt });
    });

    it('refuses the actor’s own account', async () => {
      await expect(svc.resetLink(lead, 'tl1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns the link without mailing when mail is not configured', async () => {
      const out = await svc.resetLink(lead, 'em1');
      expect(auth.createResetLink).toHaveBeenCalledWith('em1', 72, 'tl1');
      expect(mailer.send).not.toHaveBeenCalled();
      expect(out).toEqual({ url: 'https://app/reset?token=t', expiresAt: expiresAt.toISOString(), emailed: false });
    });

    it('mails the link when configured and reports delivery', async () => {
      mailer.configured = true;
      mailer.send.mockResolvedValue(true);
      const out = await svc.resetLink(lead, 'em1');
      expect(mailer.send).toHaveBeenCalledWith(
        'em1@cadence.local',
        expect.any(String),
        expect.stringContaining('https://app/reset?token=t'),
      );
      expect(out.emailed).toBe(true);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { emailed: true } }));
    });
  });

  describe('remove', () => {
    it('refuses self-deletion and users with reports or members', async () => {
      visible = [
        u('tl1', 'TRIBE_LEAD', { _count: { reports: 2, members: 0 } }),
        u('em1', 'ENGINEERING_MANAGER', { _count: { reports: 0, members: 3 } }),
      ];
      await expect(svc.remove(lead, 'tl1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.remove(admin, 'tl1')).rejects.toBeInstanceOf(ConflictException);
      await expect(svc.remove(admin, 'em1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('deletes an empty user and audits', async () => {
      visible = [u('em1', 'ENGINEERING_MANAGER')];
      await svc.remove(lead, 'em1');
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'em1' } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.deleted', metadata: { email: 'em1@cadence.local' } }),
      );
    });

    it('404s for users outside scope', async () => {
      await expect(svc.remove(em, 'em2')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
