import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserBody, UpdateUserBody } from './dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';

/**
 * Sign-in accounts (tribe leads and engineering managers). Admins manage tribe leads and engineering managers;
 * tribe leads manage the engineering managers reporting to them; engineering managers can only read
 * themselves. Admin accounts are never returned by `GET /users/:id` and cannot be changed here.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Users visible to the caller, ordered by role then name. Without `role`, admins are left out; an unknown
   * `role` value is ignored.
   */
  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query('role') role?: UserRole) {
    return this.users.list(actor, role && Object.values(UserRole).includes(role) ? role : undefined);
  }

  @Get(':id')
  get(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.get(actor, id);
  }

  /** Admins and tribe leads: creates a tribe lead (admins only) or an engineering manager. */
  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateUserBody) {
    return this.users.create(actor, body);
  }

  /** Admins and tribe leads: updates a user in the caller's scope. */
  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Patch(':id')
  update(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: UpdateUserBody) {
    return this.users.update(actor, id, body);
  }

  /**
   * Admins and tribe leads: creates a 72-hour password reset link for another user in scope. The URL is
   * returned so it can be shared by hand, and is also e-mailed when mail is configured.
   */
  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Post(':id/reset-link')
  resetLink(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.resetLink(actor, id);
  }

  /** Admins and tribe leads: deletes a user who has no reports and no members. */
  @Roles(UserRole.ADMIN, UserRole.TRIBE_LEAD)
  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.users.remove(actor, id);
  }
}
