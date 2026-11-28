import { randomToken, safeEqual, sha256 } from './tokens';

describe('tokens', () => {
  it('randomToken is URL-safe and sized by its entropy', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(Buffer.from(randomToken(12), 'base64url')).toHaveLength(12);
    expect(randomToken()).not.toBe(t);
  });

  it('sha256 is a stable hex digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abc')).toBe(sha256('abc'));
  });

  it('safeEqual compares contents and tolerates length mismatches', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'secreT')).toBe(false);
    expect(safeEqual('secret', 'secret-longer')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});
