import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SetupService } from './setup.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';
import type { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto/tokens';

const config = (values: Record<string, string>) =>
  ({ get: (k: string, d?: string) => values[k] ?? d }) as unknown as ConfigService;

describe('SetupService', () => {
  const prisma = {
    user: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    appSetting: { upsert: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  };
  const auth = { hashPassword: vi.fn(), startSession: vi.fn() };
  const audit = { record: vi.fn() };
  const make = (values: Record<string, string> = {}) =>
    new SetupService(
      prisma as unknown as PrismaService,
      auth as unknown as AuthService,
      audit as unknown as AuditService,
      config(values),
    );
  let warn: ReturnType<typeof vi.spyOn>;
  const pending = { id: 'admin', email: 'admin@cadence.local', passwordHash: null };

  beforeEach(() => {
    vi.resetAllMocks();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    auth.hashPassword.mockResolvedValue('hashed');
    auth.startSession.mockResolvedValue({ refreshToken: 'rt' });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [{}, false],
    [{ NODE_ENV: 'production' }, true],
    [{ NODE_ENV: 'production', SETUP_TOKEN_REQUIRED: 'false' }, false],
    [{ SETUP_TOKEN_REQUIRED: 'true' }, true],
  ])('tokenRequired for %o is %s', (values, expected) => {
    expect(make(values).tokenRequired).toBe(expected);
  });

  describe('onApplicationBootstrap', () => {
    it('creates a password-less system admin on first launch', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({ id: 'admin', ...data }));
      await make({ DEFAULT_ADMIN_EMAIL: 'Root@Cadence.local' }).onApplicationBootstrap();
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'root@cadence.local', name: 'Administrator', role: 'ADMIN', isSystem: true, passwordHash: null },
      });
      expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    });

    it('leaves an existing admin alone and issues no token once a password is set', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'admin', passwordHash: 'h' });
      await make({ SETUP_TOKEN_REQUIRED: 'true' }).onApplicationBootstrap();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.appSetting.upsert).not.toHaveBeenCalled();
    });

    it('stores only the hash of the configured setup token', async () => {
      prisma.user.findFirst.mockResolvedValue(pending);
      await make({ SETUP_TOKEN_REQUIRED: 'true', SETUP_TOKEN: 'tok-123' }).onApplicationBootstrap();
      expect(prisma.appSetting.upsert).toHaveBeenCalledWith({
        where: { key: 'setup_token_hash' },
        create: { key: 'setup_token_hash', value: sha256('tok-123') },
        update: { value: sha256('tok-123') },
      });
    });

    it('generates a random token when none is configured', async () => {
      prisma.user.findFirst.mockResolvedValue(pending);
      await make({ SETUP_TOKEN_REQUIRED: 'true' }).onApplicationBootstrap();
      const logged = warn.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      const token = /Setup token[^:]*: (\S+)/.exec(logged)![1];
      expect(prisma.appSetting.upsert.mock.calls[0][0].create.value).toBe(sha256(token));
    });
  });

  it('status reflects whether a pending admin exists', async () => {
    const svc = make({ SETUP_TOKEN_REQUIRED: 'true' });
    prisma.user.findFirst.mockResolvedValueOnce(pending);
    await expect(svc.status()).resolves.toEqual({
      needsSetup: true,
      adminEmail: 'admin@cadence.local',
      tokenRequired: true,
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { role: 'ADMIN', isSystem: true, passwordHash: null },
    });
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(svc.status()).resolves.toEqual({ needsSetup: false, adminEmail: null, tokenRequired: false });
  });

  describe('complete', () => {
    const input = { name: 'Root', email: 'Root@Cadence.local', password: 'p'.repeat(12) };

    it('409s once setup is done', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(make().complete(input)).rejects.toBeInstanceOf(ConflictException);
    });

    it.each([
      ['no stored token', null, 'tok'],
      ['no token supplied', { value: sha256('tok') }, undefined],
      ['a wrong token', { value: sha256('tok') }, 'nope'],
    ])('403s with %s when a token is required', async (_, stored, setupToken) => {
      prisma.user.findFirst.mockResolvedValue(pending);
      prisma.appSetting.findUnique.mockResolvedValue(stored);
      await expect(make({ SETUP_TOKEN_REQUIRED: 'true' }).complete({ ...input, setupToken })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('claims the admin atomically, removes the token, audits and starts a session', async () => {
      prisma.user.findFirst.mockResolvedValue(pending);
      prisma.appSetting.findUnique.mockResolvedValue({ value: sha256('tok') });
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      const claimed = { id: 'admin', email: 'root@cadence.local' };
      prisma.user.findUniqueOrThrow.mockResolvedValue(claimed);

      const session = await make({ SETUP_TOKEN_REQUIRED: 'true' }).complete({ ...input, setupToken: 'tok' });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'admin', passwordHash: null },
        data: expect.objectContaining({ passwordHash: 'hashed', name: 'Root', email: 'root@cadence.local' }),
      });
      expect(prisma.appSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'setup_token_hash' } });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'setup.completed', actor: claimed }));
      expect(auth.startSession).toHaveBeenCalledWith(claimed);
      expect(session).toEqual({ refreshToken: 'rt' });
    });

    it('does not check a token when none is required', async () => {
      prisma.user.findFirst.mockResolvedValue(pending);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'admin', email: 'root@cadence.local' });
      await make().complete(input);
      expect(prisma.appSetting.findUnique).not.toHaveBeenCalled();
    });

    it('409s when a concurrent request claimed the admin first', async () => {
      prisma.user.findFirst.mockResolvedValue(pending);
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      await expect(make().complete(input)).rejects.toThrow('Setup has already been completed');
      expect(auth.startSession).not.toHaveBeenCalled();
    });
  });
});
