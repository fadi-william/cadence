import { Controller, Get } from '@nestjs/common';
import type { OrgTreeDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/enums';

@Controller('org')
export class OrgController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tribe Lead → Engineering Manager → Member tree, filtered to the caller's scope: admins get every tribe,
   * a tribe lead their own tribe, an engineering manager only their own team under their tribe lead.
   *
   * @remarks
   * Engineering managers without a tribe lead do not appear, nor do the admins.
   */
  @Get('tree')
  async tree(@CurrentUser() user: AuthenticatedUser): Promise<OrgTreeDto> {
    const tlWhere =
      user.role === UserRole.ADMIN
        ? {}
        : user.role === UserRole.TRIBE_LEAD
          ? { id: user.id }
          : { reports: { some: { id: user.id } } };
    const emWhere = user.role === UserRole.ENGINEERING_MANAGER ? { id: user.id } : {};

    const tribeLeads = await this.prisma.user.findMany({
      where: { role: UserRole.TRIBE_LEAD, ...tlWhere },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        tribeName: true,
        reports: {
          where: { role: UserRole.ENGINEERING_MANAGER, ...emWhere },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            email: true,
            members: { orderBy: { name: 'asc' }, select: { id: true, name: true, title: true } },
          },
        },
      },
    });
    return { tribeLeads: tribeLeads.map(({ reports, ...tl }) => ({ ...tl, managers: reports })) };
  }
}
