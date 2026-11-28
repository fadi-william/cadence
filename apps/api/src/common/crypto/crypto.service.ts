import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for integration and webhook secrets stored in the database.
 * Format: `v1:<iv>:<tag>:<ciphertext>`, each part base64.
 *
 * @remarks
 * The key comes from `APP_ENCRYPTION_KEY` (32 bytes, base64); the constructor throws when it is missing
 * or the wrong length.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.getOrThrow<string>('APP_ENCRYPTION_KEY');
    this.key = Buffer.from(raw, 'base64');
    if (this.key.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
    }
  }

  /** Encrypts with a fresh random 12-byte IV. */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
  }

  /**
   * @throws Error when the payload is not in the `v1` format, or when authentication fails (tampered data or a
   *   different key)
   */
  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
