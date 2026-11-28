import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { requestContext, type RequestContext } from '../common/context/request-context';

const jwt = new JwtService({ secret: 'unit-test-secret' });

describe('AuthGuard', () => {
  const meta: Record<string, unknown> = {};
  const getAllAndOverride = vi.fn((key: string) => meta[key]);
  const reflector = { getAllAndOverride } as unknown as Reflector;
  const guard = new AuthGuard(jwt, reflector);
  const handler = () => undefined;
  class Ctrl {}

  const ctx = (authorization?: string) => {
    const req: { headers: { authorization?: string }; user?: unknown } = { headers: { authorization } };
    const context = {
      getHandler: () => handler,
      getClass: () => Ctrl,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return { req, context };
  };
  const token = (role = 'ENGINEERING_MANAGER', opts = {}) =>
    jwt.signAsync({ sub: 'u1', email: 'u1@cadence.local', role }, opts);

  beforeEach(() => {
    for (const k of Object.keys(meta)) delete meta[k];
    getAllAndOverride.mockClear();
  });

  it('lets @Public() routes through without a token, checking handler then class', async () => {
    meta[IS_PUBLIC_KEY] = true;
    await expect(guard.canActivate(ctx().context)).resolves.toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [handler, Ctrl]);
  });

  it.each([undefined, '', 'Bearer', 'Basic abc', 'bearer abc'])('rejects authorization header %j', async (h) => {
    await expect(guard.canActivate(ctx(h).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid, foreign-signed and expired tokens', async () => {
    await expect(guard.canActivate(ctx('Bearer not.a.jwt').context)).rejects.toBeInstanceOf(UnauthorizedException);
    const foreign = await new JwtService({ secret: 'other' }).signAsync({ sub: 'u1' });
    await expect(guard.canActivate(ctx(`Bearer ${foreign}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
    const expired = await token('ADMIN', { expiresIn: -10 });
    await expect(guard.canActivate(ctx(`Bearer ${expired}`).context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the user to the request and the request context', async () => {
    const { req, context } = ctx(`Bearer ${await token()}`);
    const store: RequestContext = { ip: '1.2.3.4' };
    await expect(requestContext.run(store, () => guard.canActivate(context))).resolves.toBe(true);
    const user = { id: 'u1', email: 'u1@cadence.local', role: 'ENGINEERING_MANAGER' };
    expect(req.user).toEqual(user);
    expect(store.user).toEqual(user);
  });

  it('works outside a request context', async () => {
    const { req, context } = ctx(`Bearer ${await token()}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'u1' });
  });

  it('enforces @Roles() when present', async () => {
    meta[ROLES_KEY] = ['ADMIN', 'TRIBE_LEAD'];
    await expect(guard.canActivate(ctx(`Bearer ${await token('TRIBE_LEAD')}`).context)).resolves.toBe(true);
    await expect(guard.canActivate(ctx(`Bearer ${await token('ENGINEERING_MANAGER')}`).context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('treats an empty @Roles() list as no restriction', async () => {
    meta[ROLES_KEY] = [];
    await expect(guard.canActivate(ctx(`Bearer ${await token()}`).context)).resolves.toBe(true);
  });
});
