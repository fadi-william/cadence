import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { UserRole } from '../generated/prisma/enums';

/** Body of `POST /users`. Admin accounts cannot be created through the API. */
export class CreateUserBody {
  /** Stored lower-cased; must be unique. */
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsIn([UserRole.TRIBE_LEAD, UserRole.ENGINEERING_MANAGER])
  role!: typeof UserRole.TRIBE_LEAD | typeof UserRole.ENGINEERING_MANAGER;

  /** Initial password, 12-128 characters. */
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  /**
   * Tribe Lead id for an EM: required when an admin creates one; a tribe lead may only omit it or pass
   * their own id. Ignored for Tribe Leads (they report to the creating admin).
   */
  @IsOptional()
  @IsString()
  reportsToId?: string;

  /** Display name of the tribe; only stored for Tribe Leads. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tribeName?: string;
}

/**
 * Body of `PATCH /users/:id`. The role cannot be changed. Setting `password` revokes the user's sessions;
 * `reportsToId` applies to engineering managers only and `tribeName` to tribe leads only.
 */
export class UpdateUserBody extends PartialType(OmitType(CreateUserBody, ['role'] as const)) {}
