import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { SetupService } from './setup.service';
import { sendSession } from '../auth/auth.controller';

/** Body of `POST /setup/complete`: the first admin's real name, email and password. */
class CompleteSetupBody {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  password!: string;

  /** One-time token printed to the API log; required when `SETUP_TOKEN_REQUIRED` is on (production default). */
  @IsOptional()
  @IsString()
  setupToken?: string;
}

/** Public first-launch endpoints. */
@Public()
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  /** Whether the install still needs its first admin password, and whether a setup token is required. */
  @Get('status')
  status() {
    return this.setup.status();
  }

  /**
   * Claims the install: sets the default admin's name, email and password, then signs them in (access token
   * plus refresh cookie). Works once; rate-limited to 10 requests per minute.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('complete')
  async complete(@Body() body: CompleteSetupBody, @Res({ passthrough: true }) res: Response) {
    return sendSession(res, await this.setup.complete(body));
  }
}
