import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { UserRole } from '../generated/prisma/enums';
import { requestContext } from '../common/context/request-context';

type AuthRequest = { headers: { authorization?: string }; user?: AuthenticatedUser };

/**
 * Global guard (registered as `APP_GUARD` by `AuthModule`). Routes marked `@Public()` pass through; every other
 * route needs a valid `Authorization: Bearer` access token. The token's user is put on `req.user` and the
 * request context, then `@Roles()` is enforced when present.
 *
 * @throws UnauthorizedException when the token is missing, malformed, expired or has a bad signature
 * @throws ForbiddenException when the user's role is not one of the route's `@Roles()`
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthRequest>();
    const [type, token] = (req.headers.authorization ?? '').split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; role: UserRole }>(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
      const store = requestContext.getStore();
      if (store) store.user = req.user;
    } catch {
      throw new UnauthorizedException();
    }

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, targets);
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
