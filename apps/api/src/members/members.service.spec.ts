import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MembersService } from './members.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AccessScopeService } from '../org/access-scope.service';
import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Prisma } from '../generated/prisma/client';

const admin: AuthenticatedUser = { id: 'admin', email: 'a@cadence.local', role: 'ADMIN' };
const lead: AuthenticatedUser = { id: 'tl1', email: 'tl@cadence.local', role: 'TRIBE_LEAD' };
const em: AuthenticatedUser = { id: 'em1', email: 'em@cadence.local', role: 'ENGINEERING_MANAGER' };

const row = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  name: 'Nour',
  email: 'nour@cadence.local',
  title: 'Engineer',
  managerId: 'em1',
  manager: { id: 'em1', name: 'Hana' },
  createdAt: new Date('2026-01-02T03:04:05Z'),
  identities: [
    {
      id: 'i1',
      connectionId: 'c1',
      username: 'nour',
      displayName: 'Nour A',
      connection: { name: 'Jira Cloud', provider: 'JIRA' },
    },
  ],
  ...over,
});

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'x' });

describe('MembersService', () => {
  const prisma = {
    member: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    integrationConnection: { findUnique: vi.fn() },
    externalIdentity: { upsert: vi.fn(), deleteMany: vi.fn() },
  };
  const scope = { memberWhere: vi.fn(), assertMemberInScope: vi.fn(), assertManagerInScope: vi.fn() };
  const audit = { record: vi.fn() };
  const svc = new MembersService(
    prisma as unknown as PrismaService,
    scope as unknown as AccessScopeService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    vi.resetAllMocks();
    scope.memberWhere.mockResolvedValue({ managerId: { in: ['em1'] } });
    prisma.member.findUniqueOrThrow.mockResolvedValue(row());
  });

  describe('list', () => {
    it('applies the actor scope and maps rows to DTOs', async () => {
      prisma.member.findMany.mockResolvedValue([row()]);
      const out = await svc.list(em);
      expect(scope.memberWhere).toHaveBeenCalledWith(em);
      expect(prisma.member.findMany.mock.calls[0][0]).toMatchObject({
        where: { managerId: { in: ['em1'] } },
        orderBy: { name: 'asc' },
      });
      expect(out).toEqual([
        {
          id: 'm1',
          name: 'Nour',
          email: 'nour@cadence.local',
          title: 'Engineer',
          managerId: 'em1',
          manager: { id: 'em1', name: 'Hana' },
          createdAt: '2026-01-02T03:04:05.000Z',
          identities: [
            {
              id: 'i1',
              connectionId: 'c1',
              provider: 'JIRA',
              connectionName: 'Jira Cloud',
              username: 'nour',
              displayName: 'Nour A',
            },
          ],
        },
      ]);
    });

    it('narrows by manager with AND so the scope filter cannot be overridden', async () => {
      prisma.member.findMany.mockResolvedValue([]);
      await svc.list(em, 'em2');
      expect(prisma.member.findMany.mock.calls[0][0].where).toEqual({
        managerId: { in: ['em1'] },
        AND: [{ managerId: 'em2' }],
      });
    });
  });

  it('get checks scope first', async () => {
    scope.assertMemberInScope.mockRejectedValue(new NotFoundException());
    await expect(svc.get(em, 'm9')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.member.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it('defaults the manager to the acting engineering manager and lowercases email', async () => {
      prisma.member.create.mockResolvedValue(row());
      await svc.create(em, { name: 'Nour', email: 'Nour@Cadence.local' });
      expect(scope.assertManagerInScope).toHaveBeenCalledWith(em, 'em1');
      expect(prisma.member.create.mock.calls[0][0].data).toEqual({
        name: 'Nour',
        email: 'nour@cadence.local',
        title: undefined,
        managerId: 'em1',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'member.created',
          entityId: 'm1',
          metadata: { name: 'Nour', managerId: 'em1' },
        }),
      );
    });

    it.each([admin, lead])('requires managerId for %o', async (actor) => {
      await expect(svc.create(actor, { name: 'Nour' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.member.create).not.toHaveBeenCalled();
    });

    it('refuses managers outside the scope', async () => {
      scope.assertManagerInScope.mockRejectedValue(new ForbiddenException());
      await expect(svc.create(lead, { name: 'Nour', managerId: 'em9' })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.member.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('validates a manager change and audits the touched fields', async () => {
      prisma.member.update.mockResolvedValue(row({ managerId: 'em2' }));
      await svc.update(lead, 'm1', { managerId: 'em2', email: 'NEW@cadence.local' });
      expect(scope.assertMemberInScope).toHaveBeenCalledWith(lead, 'm1');
      expect(scope.assertManagerInScope).toHaveBeenCalledWith(lead, 'em2');
      expect(prisma.member.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'm1' },
        data: { email: 'new@cadence.local', managerId: 'em2' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'member.updated', metadata: { fields: ['managerId', 'email'] } }),
      );
    });

    it('skips the manager check when the manager is unchanged', async () => {
      prisma.member.update.mockResolvedValue(row());
      await svc.update(em, 'm1', { title: 'Lead' });
      expect(scope.assertManagerInScope).not.toHaveBeenCalled();
    });

    it('does not update members outside the scope', async () => {
      scope.assertMemberInScope.mockRejectedValue(new NotFoundException());
      await expect(svc.update(em, 'm9', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.member.update).not.toHaveBeenCalled();
    });
  });

  it('remove deletes in-scope members and audits the name', async () => {
    prisma.member.delete.mockResolvedValue(row());
    await svc.remove(em, 'm1');
    expect(prisma.member.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member.deleted', metadata: { name: 'Nour' } }),
    );
  });

  describe('upsertIdentity', () => {
    beforeEach(() =>
      prisma.integrationConnection.findUnique.mockResolvedValue({ name: 'Jira Cloud', provider: 'JIRA' }),
    );

    it('404s for an unknown integration', async () => {
      prisma.integrationConnection.findUnique.mockResolvedValue(null);
      await expect(svc.upsertIdentity(em, 'm1', 'c9', { username: 'nour' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('trims the username, clears a stale externalId on update and returns the member', async () => {
      const out = await svc.upsertIdentity(em, 'm1', 'c1', { username: '  nour  ', displayName: 'Nour' });
      expect(prisma.externalIdentity.upsert).toHaveBeenCalledWith({
        where: { memberId_connectionId: { memberId: 'm1', connectionId: 'c1' } },
        create: { memberId: 'm1', connectionId: 'c1', username: 'nour', displayName: 'Nour' },
        update: { username: 'nour', displayName: 'Nour', externalId: null },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'identity.linked',
          metadata: { connectionId: 'c1', provider: 'JIRA', username: 'nour' },
        }),
      );
      expect(out.id).toBe('m1');
    });

    it('maps a unique violation to a 409 naming the connection', async () => {
      prisma.externalIdentity.upsert.mockRejectedValue(p2002());
      await expect(svc.upsertIdentity(em, 'm1', 'c1', { username: 'nour' })).rejects.toThrow(
        new ConflictException('"nour" is already linked to another member on Jira Cloud'),
      );
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('rethrows other errors', async () => {
      prisma.externalIdentity.upsert.mockRejectedValue(new Error('db down'));
      await expect(svc.upsertIdentity(em, 'm1', 'c1', { username: 'nour' })).rejects.toThrow('db down');
    });
  });

  it('removeIdentity unlinks and returns the member', async () => {
    const out = await svc.removeIdentity(em, 'm1', 'c1');
    expect(scope.assertMemberInScope).toHaveBeenCalledWith(em, 'm1');
    expect(prisma.externalIdentity.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'm1', connectionId: 'c1' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.unlinked' }));
    expect(out.id).toBe('m1');
  });
});
