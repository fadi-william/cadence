import { Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { WebhooksService } from './webhooks.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { CryptoService } from '../common/crypto/crypto.service';
import type { AdapterRegistry } from '../integrations/adapters/adapter.registry';
import type { SyncDispatcher } from '../integrations/sync-dispatcher.service';
import type { WebhookRequest } from '../integrations/adapters/adapter.types';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const SECRET = 'webhook-secret-123';

describe('WebhooksService', () => {
  const prisma = { integrationConnection: { findUnique: vi.fn() } };
  const crypto = { decrypt: vi.fn(() => SECRET) };
  const adapter: { verifyWebhook?: ReturnType<typeof vi.fn>; webhookDates?: ReturnType<typeof vi.fn> } = {};
  const registry = { get: vi.fn(() => adapter) };
  const dispatcher = { enqueueDebounced: vi.fn() };
  let values: Record<string, string>;
  const svc = new WebhooksService(
    prisma as unknown as PrismaService,
    crypto as unknown as CryptoService,
    registry as unknown as AdapterRegistry,
    dispatcher as unknown as SyncDispatcher,
    { get: (k: string, d?: unknown) => values[k] ?? d } as unknown as ConfigService,
  );
  const req = (headers: WebhookRequest['headers'] = {}, body: unknown = {}): WebhookRequest => ({
    headers,
    body,
    rawBody: Buffer.from(JSON.stringify(body)),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T13:00:00Z'));
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    values = {};
    delete adapter.verifyWebhook;
    delete adapter.webhookDates;
    prisma.integrationConnection.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'ADO',
      provider: 'AZURE_DEVOPS',
      enabled: true,
      encryptedWebhookSecret: 'enc',
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    ['unknown', null],
    ['disabled', { enabled: false, encryptedWebhookSecret: 'enc' }],
    ['without a webhook secret', { enabled: true, encryptedWebhookSecret: null }],
  ])('404s for %s connections', async (_, found) => {
    prisma.integrationConnection.findUnique.mockResolvedValue(found);
    await expect(svc.receive('c1', req({ 'x-cadence-token': SECRET }))).rejects.toBeInstanceOf(NotFoundException);
    expect(dispatcher.enqueueDebounced).not.toHaveBeenCalled();
  });

  describe('verification', () => {
    it('accepts the shared token from the header or the query string', async () => {
      await expect(svc.receive('c1', req({ 'x-cadence-token': SECRET }))).resolves.toMatchObject({ accepted: true });
      await expect(svc.receive('c1', req(), SECRET)).resolves.toMatchObject({ accepted: true });
      expect(crypto.decrypt).toHaveBeenCalledWith('enc');
    });

    it('takes the first value of a repeated header', async () => {
      await expect(svc.receive('c1', req({ 'x-cadence-token': [SECRET, 'x'] }))).resolves.toMatchObject({
        accepted: true,
      });
    });

    it('prefers the header over the query token', async () => {
      await expect(svc.receive('c1', req({ 'x-cadence-token': 'wrong' }), SECRET)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it.each([
      ['no token', req(), undefined],
      ['a wrong token', req({ 'x-cadence-token': 'nope' }), undefined],
      ['an empty query token', req(), ''],
    ])('rejects %s', async (_, r, q) => {
      await expect(svc.receive('c1', r, q)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(dispatcher.enqueueDebounced).not.toHaveBeenCalled();
    });

    it('accepts a provider-native signature, and falls back to the token when it fails', async () => {
      adapter.verifyWebhook = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
      const r = req({ 'x-hub-signature': 'sig' });
      await expect(svc.receive('c1', r)).resolves.toMatchObject({ accepted: true });
      expect(adapter.verifyWebhook).toHaveBeenCalledWith(r, SECRET);
      await expect(svc.receive('c1', req())).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(svc.receive('c1', req({ 'x-cadence-token': SECRET }))).resolves.toMatchObject({ accepted: true });
    });
  });

  describe('resync window', () => {
    const ok = { 'x-cadence-token': SECRET };

    it('defaults to yesterday through today with the configured debounce', async () => {
      values.WEBHOOK_DEBOUNCE_MS = '250';
      await expect(svc.receive('c1', req(ok))).resolves.toEqual({
        accepted: true,
        resyncFrom: '2026-11-26',
        resyncTo: '2026-11-27',
      });
      expect(dispatcher.enqueueDebounced).toHaveBeenCalledWith(
        'c1',
        { from: D('2026-11-26'), to: D('2026-11-27') },
        'webhook',
        250,
      );
    });

    it('uses a 60s debounce by default', async () => {
      await svc.receive('c1', req(ok));
      expect(dispatcher.enqueueDebounced.mock.calls[0][3]).toBe(60_000);
    });

    it('extends back to the earliest event day within the 30-day lookback', async () => {
      adapter.webhookDates = vi.fn(() => ['2026-11-20', '2026-11-25']);
      const body = { event: 'x' };
      await expect(svc.receive('c1', req(ok, body))).resolves.toMatchObject({ resyncFrom: '2026-11-20' });
      expect(adapter.webhookDates).toHaveBeenCalledWith(body);
    });

    it('ignores invalid, future and too-old event dates', async () => {
      adapter.webhookDates = vi.fn(() => ['garbage', '2026-12-01', '2026-10-28', '2026-10-29']);
      await expect(svc.receive('c1', req(ok))).resolves.toMatchObject({
        resyncFrom: '2026-10-29',
        resyncTo: '2026-11-27',
      });
      adapter.webhookDates = vi.fn(() => ['2026-10-01']);
      await expect(svc.receive('c1', req(ok))).resolves.toMatchObject({ resyncFrom: '2026-11-26' });
    });
  });
});
