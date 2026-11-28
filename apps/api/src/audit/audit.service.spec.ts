import { Logger } from '@nestjs/common';
import { AuditService } from './audit.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import { requestContext } from '../common/context/request-context';

describe('AuditService', () => {
  const prisma = { auditLog: { create: vi.fn(), findMany: vi.fn() } };
  const svc = new AuditService(prisma as unknown as PrismaService);
  const ctxUser = { id: 'u1', email: 'u1@cadence.local', role: 'ADMIN' as const };

  beforeEach(() => vi.resetAllMocks());

  describe('record', () => {
    it('defaults the actor and IP to the request context', async () => {
      await requestContext.run({ ip: '10.0.0.1', user: ctxUser }, () =>
        svc.record({ action: 'member.created', entityType: 'member', entityId: 'm1', metadata: { a: 1 } }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: 'member.created',
          entityType: 'member',
          entityId: 'm1',
          metadata: { a: 1 },
          actorId: 'u1',
          actorEmail: 'u1@cadence.local',
          ip: '10.0.0.1',
        },
      });
    });

    it('uses an explicit actor, and null means anonymous even inside a request', async () => {
      await requestContext.run({ user: ctxUser }, async () => {
        await svc.record({ action: 'a', entityType: 'user', actor: { id: 'u2', email: 'u2@cadence.local' } });
        await svc.record({ action: 'b', entityType: 'user', actor: null });
      });
      expect(prisma.auditLog.create.mock.calls[0][0].data).toMatchObject({
        actorId: 'u2',
        actorEmail: 'u2@cadence.local',
      });
      expect(prisma.auditLog.create.mock.calls[1][0].data).toMatchObject({ actorId: null, actorEmail: null });
    });

    it('nulls missing fields outside a request', async () => {
      await svc.record({ action: 'a', entityType: 'user' });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          action: 'a',
          entityType: 'user',
          entityId: null,
          metadata: undefined,
          actorId: null,
          actorEmail: null,
          ip: null,
        },
      });
    });

    it('never throws when the write fails', async () => {
      const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      await expect(svc.record({ action: 'x.y', entityType: 'user' })).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('x.y: db down'));
      log.mockRestore();
    });
  });

  describe('list', () => {
    const row = (id: string) => ({ id, metadata: null, createdAt: new Date('2026-11-01T10:00:00Z') });

    it('pages with a cursor and reports the next cursor when there is more', async () => {
      prisma.auditLog.findMany.mockResolvedValue([row('a'), row('b'), row('c')]);
      const page = await svc.list({ limit: 2, cursor: 'z', entityType: 'user', action: 'auth.' });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { entityType: 'user', action: { startsWith: 'auth.' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        cursor: { id: 'z' },
        skip: 1,
      });
      expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(page.items[0]).toMatchObject({ metadata: null, createdAt: '2026-11-01T10:00:00.000Z' });
      expect(page.nextCursor).toBe('b');
    });

    it('returns no cursor on the last page and applies defaults without filters', async () => {
      prisma.auditLog.findMany.mockResolvedValue([row('a')]);
      const page = await svc.list({});
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 51,
      });
      expect(page.nextCursor).toBeNull();
    });

    it.each([
      [0, 2],
      [-5, 2],
      [1000, 201],
    ])('clamps limit %i to take %i', async (limit, take) => {
      prisma.auditLog.findMany.mockResolvedValue([]);
      await svc.list({ limit });
      expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(take);
    });
  });
});
