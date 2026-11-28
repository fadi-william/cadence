import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessScopeService } from './access-scope.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';

const admin: AuthenticatedUser = { id: 'admin', email: 'a@cadence.local', role: 'ADMIN' };
const lead: AuthenticatedUser = { id: 'tl1', email: 'tl@cadence.local', role: 'TRIBE_LEAD' };
const em: AuthenticatedUser = { id: 'em1', email: 'em@cadence.local', role: 'ENGINEERING_MANAGER' };

describe('AccessScopeService', () => {
  const prisma = {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    member: { findFirst: vi.fn() },
  };
  const svc = new AccessScopeService(prisma as unknown as PrismaService);

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.user.findMany.mockResolvedValue([{ id: 'em1' }, { id: 'em2' }]);
  });

  describe('managerIds', () => {
    it('is unrestricted (null) for admins', async () => {
      await expect(svc.managerIds(admin)).resolves.toBeNull();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('is the EMs reporting to a tribe lead', async () => {
      await expect(svc.managerIds(lead)).resolves.toEqual(['em1', 'em2']);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { reportsToId: 'tl1', role: 'ENGINEERING_MANAGER' },
        select: { id: true },
      });
    });

    it('is a tribe lead with no EMs: an empty (deny-all) list, not null', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await expect(svc.managerIds(lead)).resolves.toEqual([]);
      await expect(svc.memberWhere(lead)).resolves.toEqual({ managerId: { in: [] } });
    });

    it('is only themselves for engineering managers', async () => {
      await expect(svc.managerIds(em)).resolves.toEqual(['em1']);
    });
  });

  it('memberWhere is empty for admins and a manager filter otherwise', async () => {
    await expect(svc.memberWhere(admin)).resolves.toEqual({});
    await expect(svc.memberWhere(em)).resolves.toEqual({ managerId: { in: ['em1'] } });
  });

  describe('assertManagerInScope', () => {
    it('404s for unknown users and for users who are not engineering managers', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(svc.assertManagerInScope(admin, 'x')).rejects.toBeInstanceOf(NotFoundException);
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'tl2', role: 'TRIBE_LEAD' });
      await expect(svc.assertManagerInScope(admin, 'tl2')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the manager when in scope', async () => {
      const manager = { id: 'em2', role: 'ENGINEERING_MANAGER' };
      prisma.user.findUnique.mockResolvedValue(manager);
      await expect(svc.assertManagerInScope(admin, 'em2')).resolves.toBe(manager);
      await expect(svc.assertManagerInScope(lead, 'em2')).resolves.toBe(manager);
    });

    it('403s for a manager outside the scope', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'em2', role: 'ENGINEERING_MANAGER' });
      await expect(svc.assertManagerInScope(em, 'em2')).rejects.toBeInstanceOf(ForbiddenException);
      prisma.user.findMany.mockResolvedValue([{ id: 'em9' }]);
      await expect(svc.assertManagerInScope(lead, 'em2')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('assertMemberInScope', () => {
    it('queries the member within the scope and returns it', async () => {
      const member = { id: 'm1', managerId: 'em1' };
      prisma.member.findFirst.mockResolvedValue(member);
      await expect(svc.assertMemberInScope(em, 'm1')).resolves.toBe(member);
      expect(prisma.member.findFirst).toHaveBeenCalledWith({ where: { id: 'm1', managerId: { in: ['em1'] } } });
    });

    it('404s (not 403) when the member is missing or out of scope', async () => {
      prisma.member.findFirst.mockResolvedValue(null);
      await expect(svc.assertMemberInScope(em, 'm2')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
