import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';

/**
 * JWT configuration and the global {@link AuthGuard}. Refuses to start when `JWT_SECRET` is shorter than
 * 32 characters. Global so other modules can inject {@link AuthService}.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET') ?? '';
        if (secret.length < 32)
          throw new Error('JWT_SECRET must be set to at least 32 characters (openssl rand -base64 48)');
        return { secret };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
