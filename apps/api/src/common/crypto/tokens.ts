import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** URL-safe random token (default 32 bytes of entropy). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Tokens are high-entropy, so a fast hash is sufficient (no need for bcrypt). */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Constant-time string comparison; strings of different lengths are unequal. */
export function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
