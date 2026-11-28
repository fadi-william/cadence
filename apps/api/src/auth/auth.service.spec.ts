import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService, BCRYPT_ROUNDS, DUMMY_PASSWORD_HASH, toAuthUser } from './auth.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { MailerService } from '../mail/mailer.service';
import type { AuditService } from '../audit/audit.service';
import { requestContext } from '../common/context/request-context';
import { sha256 } from '../common/crypto/tokens';

// Low cost factor keeps compare() fast; the cost is read from the hash itself.
const HASH = bcrypt.hashSync('correct horse', 4);

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'mariam@cadence.local',
  name: 'Mariam',
  role: 'ENGINEERING_MANAGER' as const,
  reportsToId: 'tl1',
  tribeName: null,
  passwordHash: HASH,
  ...over,
});

const config = (values: Record<string, string> = {}) =>
  ({ get: (k: string, d?: unknown) => values[k] ?? d }) as unknown as ConfigService;

describe('AuthService', () => {
  const prisma = {
    user: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    passwordResetToken: { create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const mailer = { send: vi.fn() };
  const audit = { record: vi.fn() };
  const jwt = new JwtService({ secret: 'unit-test-secret' });
  let svc: AuthService;
  let hashPassword: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    svc = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      mailer as unknown as MailerService,
      audit as unknown as AuditService,
      config({ WEB_ORIGIN: 'https://app.cadence.local/,https://other.cadence.local' }),
    );
    hashPassword = vi.spyOn(svc, 'hashPassword').mockResolvedValue('new-hash');
    prisma.refreshToken.create.mockResolvedValue({});
  });

  it('reads TTLs from config with defaults', () => {
    expect(svc.accessTtlSeconds).toBe(900);
    expect(svc.refreshTtlMs).toBe(14 * 864e5);
    const custom = new AuthService(
      prisma as never,
      jwt,
      mailer as never,
      audit as never,
      config({ ACCESS_TOKEN_TTL_SECONDS: '60', REFRESH_TOKEN_TTL_DAYS: '1' }),
    );
    expect(custom.accessTtlSeconds).toBe(60);
    expect(custom.refreshTtlMs).toBe(864e5);
  });

  it('toAuthUser exposes only public fields', () => {
    expect(toAuthUser(user() as never)).toEqual({
      id: 'u1',
      email: 'mariam@cadence.local',
      name: 'Mariam',
      role: 'ENGINEERING_MANAGER',
      reportsToId: 'tl1',
      tribeName: null,
    });
  });

  describe('login', () => {
    it('normalises the email, stamps lastLoginAt, audits and starts a session', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user({ name: 'Mariam Updated' }));
      const session = await svc.login('Mariam@Cadence.local', 'correct horse');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'mariam@cadence.local' } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.login', entityId: 'u1' }));
      expect(session.response.user.name).toBe('Mariam Updated');
      expect(session.refreshToken).toEqual(expect.any(String));
      const payload = await jwt.verifyAsync(session.response.accessToken);
      expect(payload).toMatchObject({ sub: 'u1', email: 'mariam@cadence.local', role: 'ENGINEERING_MANAGER' });
      expect(payload.exp - payload.iat).toBe(900);
    });

    it.each([
      ['unknown user', null],
      ['user without a password', user({ passwordHash: null })],
    ])('rejects %s and audits the failure', async (_, found) => {
      prisma.user.findUnique.mockResolvedValue(found);
      await expect(svc.login('mariam@cadence.local', 'correct horse')).rejects.toThrow(UnauthorizedException);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login_failed',
          actor: null,
          metadata: { email: 'mariam@cadence.local' },
        }),
      );
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('compares unknown users against a well-formed hash so the timing matches real accounts', () => {
      // bcrypt returns immediately for anything that is not a 60-character hash.
      expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
      expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(BCRYPT_ROUNDS);
    });

    it('rejects a wrong password with the same message', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      await expect(svc.login('mariam@cadence.local', 'wrong')).rejects.toThrow('Invalid email or password');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'u1' }));
    });
  });

  describe('startSession', () => {
    it('stores only the hash of the refresh token, with family, expiry and truncated user agent', async () => {
      const ua = 'x'.repeat(400);
      const before = Date.now();
      const session = await requestContext.run({ userAgent: ua }, () => svc.startSession(user() as never, 'fam'));
      const { data } = prisma.refreshToken.create.mock.calls[0][0];
      expect(data).toMatchObject({ userId: 'u1', familyId: 'fam', tokenHash: sha256(session.refreshToken!) });
      expect(data.tokenHash).not.toBe(session.refreshToken);
      expect(data.userAgent).toHaveLength(300);
      expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + svc.refreshTtlMs);
      expect(session.refreshMaxAgeMs).toBe(svc.refreshTtlMs);
      expect(session.response.expiresIn).toBe(900);
    });

    it('starts a new random family by default', async () => {
      await svc.startSession(user() as never);
      await svc.startSession(user() as never);
      const [a, b] = prisma.refreshToken.create.mock.calls.map((c) => c[0].data.familyId);
      expect(a).toEqual(expect.any(String));
      expect(a).not.toBe(b);
    });
  });

  describe('refresh', () => {
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 'rt1',
      userId: 'u1',
      familyId: 'fam',
      expiresAt: new Date(Date.now() + 1e6),
      revokedAt: null,
      replacedById: null,
      user: user(),
      ...over,
    });

    it('requires a cookie', async () => {
      await expect(svc.refresh(undefined)).rejects.toThrow('No session');
    });

    it('rejects unknown and expired tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
      await expect(svc.refresh('raw')).rejects.toThrow('Session expired');
      prisma.refreshToken.findUnique.mockResolvedValueOnce(stored({ expiresAt: new Date(Date.now() - 1) }));
      await expect(svc.refresh('raw')).rejects.toThrow('Session expired');
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256('raw') },
        include: { user: true },
      });
    });

    it('rotates within the same family and revokes the old token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored());
      prisma.refreshToken.findUniqueOrThrow.mockResolvedValue({ id: 'rt2' });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const session = await svc.refresh('raw');
      expect(session.refreshToken).toEqual(expect.any(String));
      expect(prisma.refreshToken.create.mock.calls[0][0].data.familyId).toBe('fam');
      expect(prisma.refreshToken.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { tokenHash: sha256(session.refreshToken!) },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt1', revokedAt: null },
        data: { revokedAt: expect.any(Date), replacedById: 'rt2' },
      });
    });

    it('re-issues an access token without a new cookie for a just-rotated token (grace window)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(
        stored({ revokedAt: new Date(Date.now() - 5_000), replacedById: 'rt2' }),
      );
      const session = await svc.refresh('raw');
      expect(session.refreshToken).toBeNull();
      expect(session.response.user.id).toBe('u1');
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['rotated outside the grace window', { revokedAt: new Date(Date.now() - 60_000), replacedById: 'rt2' }],
      ['revoked by logout (never replaced)', { revokedAt: new Date(), replacedById: null }],
    ])('treats reuse of a token %s as theft and revokes the family', async (_, over) => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored(over));
      await expect(svc.refresh('raw')).rejects.toThrow('Session revoked');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.refresh_reuse_detected' }));
    });

    it('drops its replacement and falls back to the grace path when it loses a rotation race', async () => {
      prisma.refreshToken.findUnique
        .mockResolvedValueOnce(stored())
        .mockResolvedValueOnce(stored({ revokedAt: new Date(), replacedById: 'rt-other' }));
      prisma.refreshToken.findUniqueOrThrow.mockResolvedValue({ id: 'rt2' });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      const session = await svc.refresh('raw');
      expect(prisma.refreshToken.delete).toHaveBeenCalledWith({ where: { id: 'rt2' } });
      expect(session.refreshToken).toBeNull();
      expect(session.response.accessToken).toEqual(expect.any(String));
    });
  });

  describe('logout', () => {
    it('is a no-op without a cookie or for an unknown token', async () => {
      await svc.logout(undefined);
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await svc.logout('raw');
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('revokes the whole family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({ userId: 'u1', familyId: 'fam', user: user() });
      await svc.logout('raw');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { familyId: 'fam', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.logout', entityId: 'u1' }));
    });
  });

  it('me returns the public user or 401s', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(user());
    await expect(svc.me('u1')).resolves.toMatchObject({ id: 'u1', email: 'mariam@cadence.local' });
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(svc.me('gone')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('changePassword', () => {
    it('rejects a wrong current password, or an account without one', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce(user());
      await expect(svc.changePassword('u1', 'wrong', 'n'.repeat(12))).rejects.toBeInstanceOf(BadRequestException);
      prisma.user.findUniqueOrThrow.mockResolvedValueOnce(user({ passwordHash: null }));
      await expect(svc.changePassword('u1', '', 'n'.repeat(12))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('stores the new hash, revokes every session and starts a fresh one', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue(user());
      prisma.user.update.mockResolvedValue(user({ passwordHash: 'new-hash' }));
      const session = await svc.changePassword('u1', 'correct horse', 'n'.repeat(12));
      expect(hashPassword).toHaveBeenCalledWith('n'.repeat(12));
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'new-hash', passwordChangedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(session.refreshToken).toEqual(expect.any(String));
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.password_changed' }));
    });
  });

  it('createResetLink stores a hashed single-use token and links to the first web origin', async () => {
    const before = Date.now();
    const { url, expiresAt } = await svc.createResetLink('u1', 72, 'admin');
    const raw = new URL(url).searchParams.get('token')!;
    expect(url).toBe(`https://app.cadence.local/reset-password?token=${raw}`);
    expect(prisma.passwordResetToken.create).toHaveBeenCalledWith({
      data: { userId: 'u1', tokenHash: sha256(raw), expiresAt, createdById: 'admin' },
    });
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(72 * 36e5);
    expect(expiresAt.getTime() - before).toBeLessThan(72 * 36e5 + 1000);
  });

  describe('forgotPassword', () => {
    it('silently does nothing for unknown emails', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(svc.forgotPassword('nobody@cadence.local')).resolves.toBeUndefined();
      expect(mailer.send).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('mails a one-hour link to known users', async () => {
      prisma.user.findUnique.mockResolvedValue(user());
      await svc.forgotPassword('MARIAM@cadence.local');
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'mariam@cadence.local' } });
      const { expiresAt } = prisma.passwordResetToken.create.mock.calls[0][0].data;
      expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(36e5);
      const [to, subject, text] = mailer.send.mock.calls[0];
      expect(to).toBe('mariam@cadence.local');
      expect(subject).toMatch(/reset/i);
      expect(text).toContain('https://app.cadence.local/reset-password?token=');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.password_reset_requested', actor: null }),
      );
    });
  });

  describe('resetPassword', () => {
    const token = (over: Record<string, unknown> = {}) => ({
      id: 'prt1',
      userId: 'u1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 1e6),
      ...over,
    });

    it.each([
      ['unknown', null],
      ['used', token({ usedAt: new Date() })],
      ['expired', token({ expiresAt: new Date(Date.now() - 1) })],
    ])('rejects %s tokens', async (_, found) => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(found);
      await expect(svc.resetPassword('raw', 'p'.repeat(12))).rejects.toThrow('invalid or has expired');
      expect(prisma.passwordResetToken.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a token consumed concurrently', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(token());
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(svc.resetPassword('raw', 'p'.repeat(12))).rejects.toThrow('already been used');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('consumes the token, sets the password and revokes sessions', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(token());
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.update.mockResolvedValue(user());
      await svc.resetPassword('raw', 'p'.repeat(12));
      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha256('raw') } });
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'prt1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.user.update.mock.calls[0][0].data.passwordHash).toBe('new-hash');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.password_reset' }));
    });
  });
});
