import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, Session } from './auth.service';
import { ChangePasswordBody, ForgotPasswordBody, LoginBody, ResetPasswordBody } from './dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './session-cookie';

/** Stricter limit for credential endpoints (per IP). */
const AUTH_LIMIT = { default: { limit: Number(process.env.THROTTLE_AUTH_LIMIT ?? 10), ttl: 60_000 } };

/**
 * Sets the refresh cookie when the session carries a new refresh token, and returns the JSON body.
 * Also used by the setup controller, which signs the first admin in.
 */
export function sendSession(res: Response, session: Session) {
  if (session.refreshToken) setRefreshCookie(res, session.refreshToken, session.refreshMaxAgeMs);
  return session.response;
}

/**
 * Sign-in, session refresh and password endpoints under `/api/auth`. Credential endpoints are rate-limited
 * per IP (`THROTTLE_AUTH_LIMIT` per minute, default 10).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Public. Returns an access token and the user, and sets the refresh cookie.
   *
   * @throws UnauthorizedException when the email or password is wrong, or the account has no password yet
   */
  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) res: Response) {
    return sendSession(res, await this.auth.login(body.email, body.password));
  }

  /**
   * Public; authenticated by the refresh cookie. Rotates the cookie and returns a new access token.
   * On any failure the cookie is cleared before the error is rethrown.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return sendSession(res, await this.auth.refresh(readRefreshCookie(req)));
    } catch (e) {
      clearRefreshCookie(res);
      throw e;
    }
  }

  /** Public. Revokes the cookie's whole token family (if any) and clears the cookie. Always 204. */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  /** The signed-in user's profile, read fresh from the database. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  /**
   * Signed in. Checks the current password, revokes every refresh token of the user and starts a new session,
   * so other devices are signed out.
   */
  @Throttle(AUTH_LIMIT)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordBody,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendSession(res, await this.auth.changePassword(user.id, body.currentPassword, body.newPassword));
  }

  /** Public. E-mails a one-hour reset link if the account exists; always answers 202 to avoid enumeration. */
  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('forgot-password')
  @HttpCode(202)
  async forgot(@Body() body: ForgotPasswordBody) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  /** Public. Consumes a reset token and sets the new password; does not sign the user in. */
  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('reset-password')
  @HttpCode(204)
  async reset(@Body() body: ResetPasswordBody) {
    await this.auth.resetPassword(body.token, body.password);
  }
}
