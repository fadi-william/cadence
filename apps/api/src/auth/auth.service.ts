import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { AuthResponseDto, AuthUserDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { AuditService } from '../audit/audit.service';
import { currentContext } from '../common/context/request-context';
import { randomToken, sha256 } from '../common/crypto/tokens';
import type { User } from '../generated/prisma/client';

/** bcrypt cost factor for password hashes. */
export const BCRYPT_ROUNDS = 12;
/** A just-rotated token may be presented again within this window (parallel tabs) without being treated as theft. */
const REUSE_GRACE_MS = 30_000;
/**
 * A real cost-12 hash of a random secret, compared against for unknown users so their login
 * takes as long as a real one. bcrypt skips the work for malformed hashes, so it must be valid.
 */
export const DUMMY_PASSWORD_HASH = '$2b$12$/FFVukloaD0dQssh5w.fU.hTkTyCCz.EVx9.9/1u.5XVsJ3cvBsSy';

/** Maps a user row to the public DTO, leaving out password and other internal fields. */
export const toAuthUser = (u: User): AuthUserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  reportsToId: u.reportsToId,
  tribeName: u.tribeName,
});

/** Result of a sign-in or refresh: the JSON body plus what the controller needs to set the cookie. */
export interface Session {
  response: AuthResponseDto;
  /** Raw refresh token for the cookie; null when the existing cookie stays valid. */
  refreshToken: string | null;
  /** Cookie max-age in milliseconds (`REFRESH_TOKEN_TTL_DAYS`). */
  refreshMaxAgeMs: number;
}

/**
 * Passwords, sessions and reset links.
 *
 * @remarks
 * Access tokens are short-lived JWTs (`ACCESS_TOKEN_TTL_SECONDS`, default 900). Refresh tokens are random,
 * stored only as SHA-256 hashes, rotated on every use and grouped into families: replaying a rotated token
 * (outside a short grace window) revokes the whole family. Changing or resetting a password revokes all of
 * the user's refresh tokens.
 */
@Injectable()
export class AuthService {
  /** Access-token lifetime in seconds. */
  readonly accessTtlSeconds: number;
  /** Refresh-token lifetime in milliseconds. */
  readonly refreshTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.accessTtlSeconds = Number(config.get('ACCESS_TOKEN_TTL_SECONDS', 900));
    this.refreshTtlMs = Number(config.get('REFRESH_TOKEN_TTL_DAYS', 14)) * 864e5;
  }

  /** bcrypt hash with {@link BCRYPT_ROUNDS}. */
  hashPassword(password: string) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  /** Absolute web-app URL for `path`, based on the first `WEB_ORIGIN` entry. */
  private webUrl(path: string) {
    const origin = (this.config.get<string>('WEB_ORIGIN', 'http://localhost:4200').split(',')[0] ?? '').replace(
      /\/$/,
      '',
    );
    return `${origin}${path}`;
  }

  /**
   * Checks credentials (email is matched lower-cased), records the sign-in and starts a new session.
   * Failed attempts are audited as `auth.login_failed`.
   *
   * @throws UnauthorizedException with the same message for an unknown email, a wrong password or a user
   *   without a password
   */
  async login(email: string, password: string): Promise<Session> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always run a compare to keep timing similar for unknown users.
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const ok = await bcrypt.compare(password, hash);
    if (!user || !user.passwordHash || !ok) {
      await this.audit.record({
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id,
        actor: null,
        metadata: { email },
      });
      throw new UnauthorizedException('Invalid email or password');
    }
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({ action: 'auth.login', entityType: 'user', entityId: user.id, actor: user });
    return this.startSession(updated);
  }

  private async accessToken(user: User) {
    return this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: this.accessTtlSeconds },
    );
  }

  /** Issues an access token and a brand-new refresh-token family. */
  async startSession(user: User, familyId = randomToken(12)): Promise<Session> {
    const refreshToken = randomToken(48);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
        userAgent: currentContext().userAgent?.slice(0, 300),
      },
    });
    return {
      response: { accessToken: await this.accessToken(user), expiresIn: this.accessTtlSeconds, user: toAuthUser(user) },
      refreshToken,
      refreshMaxAgeMs: this.refreshTtlMs,
    };
  }

  /**
   * Rotates the refresh token: issues a new one in the same family and revokes the presented one.
   *
   * @remarks
   * A token that was rotated less than 30 seconds ago (parallel tabs) gets a new access token but no new
   * refresh token (`refreshToken: null`). Presenting a rotated token later is treated as theft: the family is
   * revoked and `auth.refresh_reuse_detected` is audited.
   *
   * @param raw - the refresh cookie value
   * @throws UnauthorizedException when the token is missing, unknown, expired or revoked
   */
  async refresh(raw: string | undefined): Promise<Session> {
    if (!raw) throw new UnauthorizedException('No session');
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!token || token.expiresAt < new Date()) throw new UnauthorizedException('Session expired');

    if (token.revokedAt) {
      const benign = token.replacedById && Date.now() - token.revokedAt.getTime() < REUSE_GRACE_MS;
      if (benign) {
        return {
          response: {
            accessToken: await this.accessToken(token.user),
            expiresIn: this.accessTtlSeconds,
            user: toAuthUser(token.user),
          },
          refreshToken: null,
          refreshMaxAgeMs: this.refreshTtlMs,
        };
      }
      await this.prisma.refreshToken.updateMany({
        where: { familyId: token.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        action: 'auth.refresh_reuse_detected',
        entityType: 'user',
        entityId: token.userId,
        actor: token.user,
      });
      throw new UnauthorizedException('Session revoked');
    }

    const next = await this.startSession(token.user, token.familyId);
    const newHash = sha256(next.refreshToken!);
    const replacement = await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: newHash } });
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: token.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: replacement.id },
    });
    if (count !== 1) {
      // Lost a race with a parallel refresh: drop ours and fall back to the grace path.
      await this.prisma.refreshToken.delete({ where: { id: replacement.id } });
      return this.refresh(raw);
    }
    return next;
  }

  /** Revokes the token's family and audits the logout. Does nothing for a missing or unknown token. */
  async logout(raw: string | undefined) {
    if (!raw) return;
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!token) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({ action: 'auth.logout', entityType: 'user', entityId: token.userId, actor: token.user });
  }

  /** @throws UnauthorizedException when the user no longer exists */
  async me(id: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new UnauthorizedException();
    return toAuthUser(user);
  }

  /** Stores the new hash and revokes every active refresh token of the user, in one transaction. */
  private async setPassword(userId: string, password: string) {
    const passwordHash = await this.hashPassword(password);
    const [user] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return user;
  }

  /**
   * Changes the password after checking the current one, then starts a fresh session (all others are revoked).
   *
   * @throws BadRequestException when the current password is wrong or the user has none
   */
  async changePassword(userId: string, current: string, next: string): Promise<Session> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const updated = await this.setPassword(userId, next);
    await this.audit.record({ action: 'auth.password_changed', entityType: 'user', entityId: userId });
    return this.startSession(updated);
  }

  /**
   * Creates a single-use reset link; only its hash is stored. Used by "forgot password" (1 hour) and by
   * admins and tribe leads (see `UsersService`).
   *
   * @param ttlHours - how long the link stays valid
   * @param createdById - the user who issued it, when not self-service
   * @returns the web-app URL containing the raw token, and its expiry
   */
  async createResetLink(userId: string, ttlHours: number, createdById?: string) {
    const raw = randomToken(32);
    const expiresAt = new Date(Date.now() + ttlHours * 36e5);
    await this.prisma.passwordResetToken.create({ data: { userId, tokenHash: sha256(raw), expiresAt, createdById } });
    return { url: this.webUrl(`/reset-password?token=${raw}`), expiresAt };
  }

  /**
   * E-mails a one-hour reset link when the account exists. Always resolves the same way, so callers cannot
   * tell whether the email is registered.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return;
    const { url } = await this.createResetLink(user.id, 1);
    await this.mailer.send(
      user.email,
      'Reset your Cadence password',
      `Hi ${user.name},\n\nUse this link within one hour to choose a new password:\n${url}\n\nIf you didn't ask for this, ignore this e-mail.`,
    );
    await this.audit.record({
      action: 'auth.password_reset_requested',
      entityType: 'user',
      entityId: user.id,
      actor: null,
    });
  }

  /**
   * Marks the reset token used (atomically, so it works once) and sets the new password, which revokes all
   * refresh tokens.
   *
   * @throws BadRequestException when the token is unknown, expired or already used
   */
  async resetPassword(raw: string, password: string) {
    const token = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }
    const { count } = await this.prisma.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count !== 1) throw new BadRequestException('This reset link has already been used');
    const user = await this.setPassword(token.userId, password);
    await this.audit.record({ action: 'auth.password_reset', entityType: 'user', entityId: user.id, actor: user });
  }
}
