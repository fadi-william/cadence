import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuditModule } from './audit/audit.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { SetupModule } from './setup/setup.module';
import { OrgModule } from './org/org.module';
import { UsersModule } from './users/users.module';
import { MembersModule } from './members/members.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { MetricsModule } from './metrics/metrics.module';
import { DoraModule } from './dora/dora.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { HealthController } from './health.controller';

/**
 * Root module. Wires every feature module, global config and scheduling, and a global rate limit
 * (`THROTTLE_LIMIT` requests per minute, default 300). The JWT guard is registered globally by `AuthModule`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.THROTTLE_LIMIT ?? 300) }]),
    PrismaModule,
    CryptoModule,
    AuditModule,
    MailModule,
    AuthModule,
    SetupModule,
    OrgModule,
    UsersModule,
    MembersModule,
    IntegrationsModule,
    MetricsModule,
    DoraModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
