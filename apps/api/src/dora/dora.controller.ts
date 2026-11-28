import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { DoraService } from './dora.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { queryDate } from '../common/http/query-date';
import { UserRole } from '../generated/prisma/enums';

/** Body of `PATCH /dora/services/:id`. */
class SetOwnerBody {
  /** Engineering manager whose team owns the service; null or omitted unassigns it (admins only). */
  @IsOptional()
  @IsString()
  managerId?: string | null;
}

/** DORA delivery metrics and service ownership, scoped to the caller's teams. */
@Controller('dora')
export class DoraController {
  constructor(private readonly dora: DoraService) {}

  /**
   * DORA summary for the services in the caller's scope.
   *
   * @param from - first day, `YYYY-MM-DD` (default: 29 days before `to`); invalid dates use the default
   * @param to - last day, inclusive, `YYYY-MM-DD` (default: today, UTC)
   * @param managerId - optionally narrows to one team's services, within the caller's scope
   */
  @Get('summary')
  summary(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('managerId') managerId?: string,
  ) {
    return this.dora.summary(actor, queryDate(from), queryDate(to), managerId);
  }

  /** Delivery services in the caller's scope with their owning team and deployment count. */
  @Get('services')
  services(@CurrentUser() actor: AuthenticatedUser) {
    return this.dora.services(actor);
  }

  /**
   * Admins and tribe leads: assigns the team that owns a service. See {@link DoraService.setOwner} for the
   * tribe-lead restrictions.
   */
  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Patch('services/:id')
  setOwner(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: SetOwnerBody) {
    return this.dora.setOwner(actor, id, body.managerId ?? null);
  }
}
