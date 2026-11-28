import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/enums';

/**
 * Central visibility rules, applied by every scoped query:
 *  - ADMIN sees everything
 *  - TRIBE_LEAD sees the engineering managers reporting to them (and their members)
 *  - ENGINEERING_MANAGER sees only their own members
 *
 * @remarks
 * Scope is expressed as a list of engineering-manager ids; members and delivery services are filtered by
 * their `managerId`.
 */
@Injectable()
export class AccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Manager ids visible to the user, or `null` meaning "all". */
  async managerIds(user: AuthenticatedUser): Promise<string[] | null> {
    switch (user.role) {
      case UserRole.ADMIN:
        return null;
      case UserRole.TRIBE_LEAD: {
        const ems = await this.prisma.user.findMany({
          where: { reportsToId: user.id, role: UserRole.ENGINEERING_MANAGER },
          select: { id: true },
        });
        return ems.map((e) => e.id);
      }
      case UserRole.ENGINEERING_MANAGER:
        return [user.id];
    }
  }

  /** Prisma `where` fragment for members visible to the user (empty for admins). */
  async memberWhere(user: AuthenticatedUser) {
    const ids = await this.managerIds(user);
    return ids === null ? {} : { managerId: { in: ids } };
  }

  /**
   * @returns the manager's user row
   * @throws NotFoundException when the id is not an engineering manager
   * @throws ForbiddenException when the engineering manager is outside the user's scope
   */
  async assertManagerInScope(user: AuthenticatedUser, managerId: string) {
    const manager = await this.prisma.user.findUnique({ where: { id: managerId } });
    if (!manager || manager.role !== UserRole.ENGINEERING_MANAGER) {
      throw new NotFoundException('Engineering manager not found');
    }
    const ids = await this.managerIds(user);
    if (ids !== null && !ids.includes(managerId)) throw new ForbiddenException('Manager is outside your scope');
    return manager;
  }

  /**
   * @returns the member row
   * @throws NotFoundException when the member does not exist or is outside the user's scope (the two are not
   *   told apart)
   */
  async assertMemberInScope(user: AuthenticatedUser, memberId: string) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, ...(await this.memberWhere(user)) },
    });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }
}
