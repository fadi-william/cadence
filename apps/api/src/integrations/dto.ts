import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IntegrationKind, IntegrationProvider } from '../generated/prisma/enums';

/** Body of `POST /integrations`. */
export class CreateIntegrationBody {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsIn(Object.values(IntegrationProvider))
  provider!: IntegrationProvider;

  /** Absolute URL including the protocol; trailing slashes are stripped before saving. */
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl!: string;

  /** Values for the adapter's `configFields`, keyed by field key. Defaults to `{}`. */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  /** API token / PAT; stored encrypted and never returned by the API. */
  @IsString()
  @MinLength(1)
  secret!: string;

  /** Disabled connections are skipped by the nightly sync and reject webhooks. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Capabilities to sync. Must be supported by the provider (checked by the service). Defaults to all of
   * the provider's capabilities.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(Object.values(IntegrationKind), { each: true })
  features?: IntegrationKind[];
}

/**
 * Body of `PATCH /integrations/:id`. All fields are optional and the provider cannot be changed. Omit
 * `secret` to keep the stored credential.
 */
export class UpdateIntegrationBody extends PartialType(OmitType(CreateIntegrationBody, ['provider'] as const)) {
  /**
   * Capabilities turned off by this update whose collected data should be deleted; the others keep their
   * history. Each must be enabled now and absent from `features`.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(Object.values(IntegrationKind), { each: true })
  removeDataFor?: IntegrationKind[];
}

/** Body of `POST /integrations/:id/sync`. */
export class SyncBody {
  /** Number of days to re-sync, ending today (1-365). Defaults to 14. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

/** Body of `POST /integrations/:id/webhook`. */
export class WebhookSecretBody {
  /**
   * Provider-issued signing secret. Omit to let Cadence generate one. Surrounding whitespace is trimmed
   * before the length checks, so padding can't make a short secret pass.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(8)
  @MaxLength(500)
  secret?: string;
}
