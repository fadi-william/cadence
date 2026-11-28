import { ConflictException, ForbiddenException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SetupStatusDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthService, Session } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, safeEqual, sha256 } from '../common/crypto/tokens';
import { UserRole } from '../generated/prisma/enums';

/** `AppSetting` key holding the SHA-256 hash of the current setup token. */
const SETUP_TOKEN_KEY = 'setup_token_hash';

/**
 * First-launch bootstrap: guarantees a system admin exists. Until that admin sets a
 * password, the app is in "setup mode" and the web client routes to /setup.
 * In production a one-time setup token (printed to the API log) is required, so nobody
 * else on the network can claim a fresh install.
 */
@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupService.name);
  /** From `SETUP_TOKEN_REQUIRED` when set, otherwise true in production. */
  readonly tokenRequired: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    const flag = config.get<string>('SETUP_TOKEN_REQUIRED');
    this.tokenRequired = flag ? flag === 'true' : config.get('NODE_ENV') === 'production';
  }

  /**
   * Creates the system admin (`DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_NAME`) without a password when no admin
   * exists. While that admin has no password and a token is required, stores a fresh setup token on every
   * start (`SETUP_TOKEN` when set, otherwise random) and logs it.
   */
  async onApplicationBootstrap() {
    let admin = await this.prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
    if (!admin) {
      const email = this.config.get<string>('DEFAULT_ADMIN_EMAIL', 'admin@cadence.local').toLowerCase();
      admin = await this.prisma.user.create({
        data: {
          email,
          name: this.config.get<string>('DEFAULT_ADMIN_NAME', 'Administrator'),
          role: UserRole.ADMIN,
          isSystem: true,
          passwordHash: null,
        },
      });
      this.logger.warn(`Created default admin "${email}". Open the web app to set its password.`);
    }
    if (admin.passwordHash || !this.tokenRequired) return;

    const token = this.config.get<string>('SETUP_TOKEN') || randomToken(18);
    await this.prisma.appSetting.upsert({
      where: { key: SETUP_TOKEN_KEY },
      create: { key: SETUP_TOKEN_KEY, value: sha256(token) },
      update: { value: sha256(token) },
    });
    this.logger.warn(`Setup token (needed once on the /setup page): ${token}`);
  }

  /** The system admin that has not set a password yet, i.e. setup is pending; null otherwise. */
  private pendingAdmin() {
    return this.prisma.user.findFirst({ where: { role: UserRole.ADMIN, isSystem: true, passwordHash: null } });
  }

  /** `tokenRequired` is only true while setup is still pending. */
  async status(): Promise<SetupStatusDto> {
    const admin = await this.pendingAdmin();
    return { needsSetup: !!admin, adminEmail: admin?.email ?? null, tokenRequired: !!admin && this.tokenRequired };
  }

  /**
   * Sets the pending admin's name, email (lower-cased) and password, deletes the setup token, audits
   * `setup.completed` and starts a session.
   *
   * @throws ConflictException when setup has already been completed (including by a concurrent request)
   * @throws ForbiddenException when a setup token is required and missing or wrong
   */
  async complete(input: { name: string; email: string; password: string; setupToken?: string }): Promise<Session> {
    const admin = await this.pendingAdmin();
    if (!admin) throw new ConflictException('Setup has already been completed');
    if (this.tokenRequired) {
      const stored = await this.prisma.appSetting.findUnique({ where: { key: SETUP_TOKEN_KEY } });
      if (!stored || !input.setupToken || !safeEqual(stored.value, sha256(input.setupToken))) {
        throw new ForbiddenException('Invalid setup token. Check the API log for the current token.');
      }
    }
    const passwordHash = await this.auth.hashPassword(input.password);
    // Conditional update keeps this atomic: only one request can claim the admin.
    const { count } = await this.prisma.user.updateMany({
      where: { id: admin.id, passwordHash: null },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        name: input.name,
        email: input.email.toLowerCase(),
        lastLoginAt: new Date(),
      },
    });
    if (count !== 1) throw new ConflictException('Setup has already been completed');
    await this.prisma.appSetting.deleteMany({ where: { key: SETUP_TOKEN_KEY } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    await this.audit.record({ action: 'setup.completed', entityType: 'user', entityId: user.id, actor: user });
    this.logger.log(`Setup completed for ${user.email}`);
    return this.auth.startSession(user);
  }
}
