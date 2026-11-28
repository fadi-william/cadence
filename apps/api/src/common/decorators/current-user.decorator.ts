import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums';

/** The caller as read from the access token (not re-read from the database). */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

/** Route parameter decorator that injects the {@link AuthenticatedUser} set by the auth guard. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser =>
    ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
