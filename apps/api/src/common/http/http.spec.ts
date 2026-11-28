import { HttpError, httpJson, limiter, toDay } from './http';

const res = (status: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body || null, { status, headers });

describe('httpJson', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends JSON bodies with headers and parses the response', async () => {
    fetchMock.mockResolvedValueOnce(res(200, '{"ok":true}'));
    const out = await httpJson<{ ok: boolean }>('https://api.cadence.local/a', {
      method: 'POST',
      body: { q: 1 },
      headers: { Authorization: 'Bearer t' },
    });
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.cadence.local/a');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"q":1}',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('defaults to GET without a body or content type, and returns undefined for empty bodies', async () => {
    fetchMock.mockResolvedValueOnce(res(204));
    await expect(httpJson('https://api.cadence.local/a')).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });

  it('retries 429 honouring Retry-After seconds', async () => {
    fetchMock.mockResolvedValueOnce(res(429, 'slow down', { 'retry-after': '2' })).mockResolvedValueOnce(res(200, '1'));
    const p = httpJson('https://api.cadence.local/a');
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx with exponential backoff, then throws HttpError', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(res(503, 'down')));
    const p = httpJson('https://api.cadence.local/a', { retries: 2 });
    const assertion = expect(p).rejects.toMatchObject({ status: 503, body: 'down' });
    await vi.advanceTimersByTimeAsync(500 + 1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(p).rejects.toBeInstanceOf(HttpError);
  });

  it('does not retry client errors', async () => {
    fetchMock.mockResolvedValue(res(404, 'missing'));
    await expect(httpJson('https://api.cadence.local/a')).rejects.toThrow(
      'HTTP 404 for https://api.cadence.local/a: missing',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries network errors and reports the cause code with the host', async () => {
    const err = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    fetchMock.mockRejectedValue(err);
    const p = httpJson('https://api.cadence.local/path', { retries: 1 });
    const assertion = expect(p).rejects.toThrow('Request to api.cadence.local failed: ECONNREFUSED');
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the error message when there is no cause', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(httpJson('https://api.cadence.local/a', { retries: 0 })).rejects.toThrow(
      'Request to api.cadence.local failed: boom',
    );
  });
});

describe('HttpError', () => {
  it('truncates the body in the message but keeps it whole', () => {
    const body = 'x'.repeat(500);
    const e = new HttpError(500, body, 'https://api.cadence.local');
    expect(e.body).toBe(body);
    expect(e.message).toBe(`HTTP 500 for https://api.cadence.local: ${'x'.repeat(300)}`);
  });
});

describe('limiter', () => {
  it('releases the slot when a task throws synchronously', async () => {
    const limit = limiter(1);
    const failing = limit((): Promise<string> => {
      throw new Error('sync boom');
    });
    const next = limit(async () => 'ok');
    await expect(failing).rejects.toThrow('sync boom');
    await expect(next).resolves.toBe('ok');
  });

  it('never runs more than `concurrency` tasks at once and preserves results', async () => {
    const limit = limiter(2);
    let active = 0;
    let peak = 0;
    const task = (v: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return v;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((v) => limit(task(v))));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('propagates rejections and keeps processing the queue', async () => {
    const limit = limiter(1);
    const failing = limit(() => Promise.reject(new Error('nope')));
    const next = limit(async () => 'ok');
    await expect(failing).rejects.toThrow('nope');
    await expect(next).resolves.toBe('ok');
  });
});

describe('toDay', () => {
  it('formats dates and strings as UTC YYYY-MM-DD', () => {
    expect(toDay(new Date('2026-11-27T23:59:59.999Z'))).toBe('2026-11-27');
    expect(toDay('2026-11-27T22:30:00-05:00')).toBe('2026-11-28');
  });
});
