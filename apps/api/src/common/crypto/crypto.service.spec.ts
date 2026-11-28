import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  const svc = new CryptoService({ getOrThrow: () => randomBytes(32).toString('base64') } as unknown as ConfigService);

  it('round-trips secrets and uses a random IV', () => {
    const a = svc.encrypt('pat-123');
    expect(a).not.toEqual(svc.encrypt('pat-123'));
    expect(svc.decrypt(a)).toBe('pat-123');
  });

  it('rejects tampered ciphertext', () => {
    const [v, iv, tag, data] = svc.encrypt('secret').split(':');
    const tampered = [v, iv, tag, Buffer.from('x' + data).toString('base64')].join(':');
    expect(() => svc.decrypt(tampered)).toThrow();
  });
});
