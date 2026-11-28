/**
 * Small fetch wrapper with timeout, retry on 429/5xx (honours Retry-After) and JSON parsing, plus a
 * concurrency limiter. Used by the integration adapters.
 */

/**
 * A non-2xx response that was not retried (or ran out of retries). The message includes up to 300 characters
 * of the body.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 300)}`);
  }
}

/** Options for {@link httpJson}. */
export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Serialised as JSON (and `Content-Type: application/json` is set) when defined. */
  body?: unknown;
  /** Retries after network errors, 429 and 5xx. Default 3. */
  retries?: number;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches `url` and parses the JSON response.
 *
 * @remarks
 * Network errors and 429/5xx responses are retried with exponential backoff (500 ms, 1 s, 2 s, ...), or after
 * `Retry-After` seconds when the server sends it.
 *
 * @typeParam T - expected response shape (not validated)
 * @returns the parsed body, or undefined for an empty body
 * @throws HttpError for a non-2xx response that is not retried
 * @throws Error naming the host when the request itself keeps failing (DNS, connection, timeout)
 */
export async function httpJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (e) {
      const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
      if (attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new Error(
        `Request to ${new URL(url).host} failed: ${cause?.code ?? cause?.message ?? (e as Error).message}`,
      );
    }
    if (res.ok) {
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }
    throw new HttpError(res.status, await res.text(), url);
  }
}

/**
 * Minimal promise concurrency limiter (like p-limit).
 *
 * @param concurrency - maximum number of tasks running at once
 * @returns a function that runs a task when a slot is free and resolves with its result
 */
export function limiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        // Wrapping the call turns a synchronous throw into a rejection, so the slot is always released.
        new Promise<T>((r) => r(fn())).then(resolve, reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

/** UTC calendar day of a date, as `YYYY-MM-DD`. */
export const toDay = (d: Date | string): string => new Date(d).toISOString().slice(0, 10);
