import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Body of `POST /auth/login`. */
export class LoginBody {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

/** Body of `POST /auth/change-password`. The new password must be 12-128 characters. */
export class ChangePasswordBody {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  newPassword!: string;
}

/** Body of `POST /auth/forgot-password`. */
export class ForgotPasswordBody {
  @IsEmail()
  email!: string;
}

/** Body of `POST /auth/reset-password`. */
export class ResetPasswordBody {
  /** Raw token from the reset link's `token` query parameter. */
  @IsString()
  @MinLength(20)
  token!: string;

  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(128)
  password!: string;
}
