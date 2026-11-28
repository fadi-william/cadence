import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

/** Body of `POST /members`. */
export class CreateMemberBody {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  /** Stored lower-cased. */
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  /**
   * Engineering manager the member reports to; must be in the caller's scope. Defaults to the current user
   * when they are an engineering manager, and is required otherwise.
   */
  @IsOptional()
  @IsString()
  managerId?: string;
}

/** Body of `PATCH /members/:id`; every field is optional and omitted fields are left unchanged. */
export class UpdateMemberBody extends PartialType(CreateMemberBody) {}

/** Body of `PUT /members/:id/identities/:connectionId`: the member's account on that integration. */
export class UpsertIdentityBody {
  /** Provider-side user name or id that the sync matches activity on. Surrounding spaces are trimmed. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;
}
