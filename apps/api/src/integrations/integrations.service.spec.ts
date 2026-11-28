import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { IntegrationsService, serialiseRun } from './integrations.service';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { CryptoService } from '../common/crypto/crypto.service';
import type { AuditService } from '../audit/audit.service';
import type { AdapterRegistry } from './adapters/adapter.registry';
import type { SyncService } from './sync.service';
import type { SyncDispatcher } from './sync-dispatcher.service';

const run = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  connectionId: 'c1',
  status: 'SUCCESS',
  trigger: 'manual',
  recordsWritten: 5,
  error: null,
  startedAt: new Date('2026-11-27T10:00:00Z'),
  finishedAt: new Date('2026-11-27T10:01:00Z'),
  rangeFrom: new Date('2026-11-14T00:00:00Z'),
  rangeTo: new Date('2026-11-27T00:00:00Z'),
  ...over,
});
const conn = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Jira',
  provider: 'JIRA',
  baseUrl: 'https://cadence.atlassian.net',
  config: { email: 'bot@cadence.local' },
  enabled: true,
  features: ['WORK_TRACKING'],
  encryptedSecret: 'enc(pat)',
  encryptedWebhookSecret: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

describe('serialiseRun', () => {
  it('formats timestamps and ranges', () => {
    expect(serialiseRun(run() as never)).toEqual({
      id: 'r1',
      connectionId: 'c1',
      status: 'SUCCESS',
      trigger: 'manual',
      recordsWritten: 5,
      error: null,
      startedAt: '2026-11-27T10:00:00.000Z',
      finishedAt: '2026-11-27T10:01:00.000Z',
      rangeFrom: '2026-11-14',
      rangeTo: '2026-11-27',
    });
    expect(serialiseRun(run({ finishedAt: null }) as never).finishedAt).toBeNull();
  });
});

describe('IntegrationsService', () => {
  const prisma = {
    integrationConnection: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    syncRun: { findMany: vi.fn(), findFirst: vi.fn() },
    dailyMetric: { updateMany: vi.fn(), deleteMany: vi.fn() },
    workItem: { deleteMany: vi.fn() },
    reviewedPullRequest: { deleteMany: vi.fn() },
    deliveryService: { deleteMany: vi.fn() },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const crypto = { encrypt: vi.fn((s: string) => `enc(${s})`), decrypt: vi.fn((s: string) => s.slice(4, -1)) };
  const adapter = { describe: vi.fn(), testConnection: vi.fn(), searchUsers: vi.fn() };
  const registry = { get: vi.fn(), all: vi.fn() };
  const sync = { rangeForDays: vi.fn() };
  const dispatcher = { enqueue: vi.fn() };
  const audit = { record: vi.fn() };
  const values: Record<string, string> = {};
  const config = { get: (k: string, d?: string) => values[k] ?? d } as unknown as ConfigService;
  const svc = new IntegrationsService(
    prisma as unknown as PrismaService,
    crypto as unknown as CryptoService,
    registry as unknown as AdapterRegistry,
    sync as unknown as SyncService,
    dispatcher as unknown as SyncDispatcher,
    audit as unknown as AuditService,
    config,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(values)) delete values[k];
    registry.get.mockReturnValue(adapter);
    adapter.describe.mockReturnValue({ provider: 'JIRA', capabilities: ['WORK_TRACKING'] });
    prisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    registry.all.mockReturnValue([adapter]);
    prisma.integrationConnection.findUnique.mockResolvedValue(conn());
    prisma.integrationConnection.create.mockImplementation(async ({ data }) => conn(data));
    prisma.integrationConnection.update.mockImplementation(async ({ data }) => conn(data));
  });

  it('providers describes every registered adapter', () => {
    expect(svc.providers()).toEqual([{ provider: 'JIRA', capabilities: ['WORK_TRACKING'] }]);
  });

  it('list never exposes secrets and includes the latest run', async () => {
    prisma.integrationConnection.findMany.mockResolvedValue([
      { ...conn({ encryptedWebhookSecret: 'enc(w)' }), syncRuns: [run()] },
      { ...conn({ id: 'c2', config: null, encryptedSecret: '' }), syncRuns: [] },
    ]);
    const [a, b] = await svc.list();
    expect(a).toMatchObject({ hasSecret: true, webhookConfigured: true, lastSync: { id: 'r1' } });
    expect(JSON.stringify(a)).not.toContain('enc(');
    expect(b).toMatchObject({ config: {}, hasSecret: false, webhookConfigured: false, lastSync: null });
  });

  describe('create', () => {
    it('validates the provider before writing', async () => {
      registry.get.mockImplementation(() => {
        throw new BadRequestException('No adapter');
      });
      await expect(
        svc.create({ name: 'X', provider: 'JIRA', baseUrl: 'https://x', secret: 's' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.integrationConnection.create).not.toHaveBeenCalled();
    });

    it('encrypts the secret, trims trailing slashes and defaults enabled/config', async () => {
      const out = await svc.create({
        name: 'Jira',
        provider: 'JIRA',
        baseUrl: 'https://cadence.atlassian.net///',
        secret: 'pat',
      });
      expect(prisma.integrationConnection.create).toHaveBeenCalledWith({
        data: {
          name: 'Jira',
          provider: 'JIRA',
          baseUrl: 'https://cadence.atlassian.net',
          config: {},
          encryptedSecret: 'enc(pat)',
          enabled: true,
          features: ['WORK_TRACKING'],
        },
      });
      expect(out).not.toHaveProperty('encryptedSecret');
      expect(out.features).toEqual(['WORK_TRACKING']);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'integration.created' }));
    });

    it('stores the chosen features in the provider order', async () => {
      adapter.describe.mockReturnValue({
        provider: 'AZURE_DEVOPS',
        capabilities: ['WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS'],
      });
      await svc.create({
        name: 'ADO',
        provider: 'AZURE_DEVOPS',
        baseUrl: 'https://dev.azure.com/cadence',
        secret: 'pat',
        features: ['DEPLOYMENTS', 'SOURCE_CONTROL'],
      });
      expect(prisma.integrationConnection.create.mock.calls[0][0].data.features).toEqual([
        'SOURCE_CONTROL',
        'DEPLOYMENTS',
      ]);
    });

    it.each([
      ['an unsupported feature', ['SOURCE_CONTROL'], 'does not support: SOURCE_CONTROL'],
      ['no features', [], 'at least one feature'],
    ])('rejects %s', async (_, features, message) => {
      await expect(
        svc.create({ name: 'X', provider: 'JIRA', baseUrl: 'https://x', secret: 's', features: features as never }),
      ).rejects.toThrow(message);
      expect(prisma.integrationConnection.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('404s for unknown integrations', async () => {
      prisma.integrationConnection.findUnique.mockResolvedValue(null);
      await expect(svc.update('x', { name: 'Y' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.integrationConnection.update).not.toHaveBeenCalled();
    });

    it('keeps the stored secret when none is supplied', async () => {
      await svc.update('c1', { name: 'Renamed', enabled: false });
      const { data } = prisma.integrationConnection.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('encryptedSecret');
      expect(data).toMatchObject({ name: 'Renamed', enabled: false, baseUrl: undefined });
    });

    it('re-encrypts a new secret and redacts it in the audit log', async () => {
      await svc.update('c1', { secret: 'new', baseUrl: 'https://cadence.local/' });
      expect(prisma.integrationConnection.update.mock.calls[0][0].data).toMatchObject({
        encryptedSecret: 'enc(new)',
        baseUrl: 'https://cadence.local',
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { fields: ['secret(changed)', 'baseUrl'] } }),
      );
    });

    describe('features', () => {
      const ado = conn({ provider: 'AZURE_DEVOPS', features: ['SOURCE_CONTROL', 'DEPLOYMENTS'] });
      beforeEach(() => {
        prisma.integrationConnection.findUnique.mockResolvedValue(ado);
        adapter.describe.mockReturnValue({
          provider: 'AZURE_DEVOPS',
          capabilities: ['WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS'],
        });
      });

      it('turns a feature on and audits the change', async () => {
        await svc.update('c1', { features: ['WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS'] });
        expect(prisma.integrationConnection.update.mock.calls[0][0].data.features).toEqual([
          'WORK_TRACKING',
          'SOURCE_CONTROL',
          'DEPLOYMENTS',
        ]);
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: { fields: ['features'], featuresOn: ['WORK_TRACKING'], featuresOff: [], dataRemovedFor: [] },
          }),
        );
      });

      it('keeps the history of a feature turned off without removeDataFor', async () => {
        await svc.update('c1', { features: ['SOURCE_CONTROL'] });
        expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(1);
        expect(prisma.deliveryService.deleteMany).not.toHaveBeenCalled();
        expect(audit.record.mock.calls[0][0].metadata).toMatchObject({
          featuresOff: ['DEPLOYMENTS'],
          dataRemovedFor: [],
        });
      });

      it('removes the data of turned-off features in the same transaction', async () => {
        prisma.integrationConnection.findUnique.mockResolvedValue(
          conn({ provider: 'AZURE_DEVOPS', features: ['WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS'] }),
        );
        await svc.update('c1', { features: ['SOURCE_CONTROL'], removeDataFor: ['WORK_TRACKING', 'DEPLOYMENTS'] });
        expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(5);
        expect(prisma.dailyMetric.updateMany).toHaveBeenCalledWith({
          where: { connectionId: 'c1' },
          data: expect.objectContaining({ issuesCompleted: 0, storyPoints: 0, holdSamples: 0 }),
        });
        expect(prisma.dailyMetric.updateMany.mock.calls[0][0].data).not.toHaveProperty('commits');
        expect(prisma.dailyMetric.deleteMany).toHaveBeenCalledWith({
          where: expect.objectContaining({ connectionId: 'c1', commits: 0, issuesCompleted: 0 }),
        });
        expect(prisma.workItem.deleteMany).toHaveBeenCalledWith({ where: { connectionId: 'c1' } });
        expect(prisma.deliveryService.deleteMany).toHaveBeenCalledWith({ where: { connectionId: 'c1' } });
      });

      it('removes the reviewed pull requests with the source-control data', async () => {
        await svc.update('c1', { features: ['DEPLOYMENTS'], removeDataFor: ['SOURCE_CONTROL'] });
        expect(prisma.reviewedPullRequest.deleteMany).toHaveBeenCalledWith({ where: { connectionId: 'c1' } });
        expect(prisma.dailyMetric.updateMany.mock.calls[0][0].data).toMatchObject({ commits: 0 });
      });

      it('removes only deployments without touching daily metrics', async () => {
        await svc.update('c1', { features: ['SOURCE_CONTROL'], removeDataFor: ['DEPLOYMENTS'] });
        expect(prisma.dailyMetric.updateMany).not.toHaveBeenCalled();
        expect(prisma.deliveryService.deleteMany).toHaveBeenCalledWith({ where: { connectionId: 'c1' } });
      });

      it.each([
        ['a feature that stays on', { features: ['SOURCE_CONTROL'], removeDataFor: ['SOURCE_CONTROL'] }],
        ['a feature that was never on', { features: ['SOURCE_CONTROL'], removeDataFor: ['WORK_TRACKING'] }],
        ['an update that leaves features unchanged', { removeDataFor: ['DEPLOYMENTS'] }],
      ])('refuses to remove data for %s', async (_, body) => {
        await expect(svc.update('c1', body as never)).rejects.toThrow(
          'only be removed for features this update turns off',
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      });

      it('rejects turning every feature off', async () => {
        await expect(svc.update('c1', { features: [] })).rejects.toThrow('at least one feature');
      });
    });
  });

  it('remove deletes and audits the name', async () => {
    await svc.remove('c1');
    expect(prisma.integrationConnection.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { name: 'Jira' } }));
  });

  it('test passes the decrypted context to the adapter', async () => {
    adapter.testConnection.mockResolvedValue({ ok: true });
    await expect(svc.test('c1')).resolves.toEqual({ ok: true });
    expect(registry.get).toHaveBeenCalledWith('JIRA');
    expect(adapter.testConnection).toHaveBeenCalledWith({
      baseUrl: 'https://cadence.atlassian.net',
      config: { email: 'bot@cadence.local' },
      secret: 'pat',
    });
  });

  describe('searchUsers', () => {
    it('skips short queries and adapters without search', async () => {
      await expect(svc.searchUsers('c1', ' a ')).resolves.toEqual([]);
      registry.get.mockReturnValue({ ...adapter, searchUsers: undefined });
      await expect(svc.searchUsers('c1', 'salma')).resolves.toEqual([]);
      expect(adapter.searchUsers).not.toHaveBeenCalled();
    });

    it('searches with a trimmed query', async () => {
      adapter.searchUsers.mockResolvedValue([{ username: 'salma' }]);
      await expect(svc.searchUsers('c1', '  al ')).resolves.toEqual([{ username: 'salma' }]);
      expect(adapter.searchUsers).toHaveBeenCalledWith(expect.objectContaining({ secret: 'pat' }), 'al');
    });

    it('turns upstream failures into 502s', async () => {
      adapter.searchUsers.mockRejectedValue(new Error('401 Unauthorized'));
      await expect(svc.searchUsers('c1', 'salma')).rejects.toThrow(
        new BadGatewayException('User lookup failed: 401 Unauthorized'),
      );
    });
  });

  it('runSync enqueues a manual run over the requested window', async () => {
    const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-07T00:00:00Z') };
    sync.rangeForDays.mockReturnValue(range);
    dispatcher.enqueue.mockResolvedValue(run({ status: 'QUEUED', finishedAt: null }));
    const out = await svc.runSync('c1', 7);
    expect(sync.rangeForDays).toHaveBeenCalledWith(7);
    expect(dispatcher.enqueue).toHaveBeenCalledWith('c1', range, 'manual');
    expect(out).toMatchObject({ status: 'QUEUED', finishedAt: null });
    await svc.runSync('c1');
    expect(sync.rangeForDays).toHaveBeenLastCalledWith(14);
  });

  it('runSync 404s before enqueueing for unknown integrations', async () => {
    prisma.integrationConnection.findUnique.mockResolvedValue(null);
    await expect(svc.runSync('x')).rejects.toBeInstanceOf(NotFoundException);
    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });

  it('runs lists the last 20 runs; run is scoped to its connection', async () => {
    prisma.syncRun.findMany.mockResolvedValue([run()]);
    await expect(svc.runs('c1')).resolves.toHaveLength(1);
    expect(prisma.syncRun.findMany).toHaveBeenCalledWith({
      where: { connectionId: 'c1' },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    prisma.syncRun.findFirst.mockResolvedValue(null);
    await expect(svc.run('c2', 'r1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.syncRun.findFirst).toHaveBeenCalledWith({ where: { id: 'r1', connectionId: 'c2' } });
  });

  describe('webhooks', () => {
    it('builds the URL from PUBLIC_API_URL without a double slash', async () => {
      expect(svc.webhookUrl('c1')).toBe('http://localhost:3000/api/webhooks/c1');
      values.PUBLIC_API_URL = 'https://api.cadence.local/api/';
      await expect(svc.webhookInfo('c1')).resolves.toEqual({
        url: 'https://api.cadence.local/api/webhooks/c1',
        configured: false,
      });
    });

    it('generates a secret when none is provided', async () => {
      const out = await svc.setWebhookSecret('c1');
      expect(out.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(prisma.integrationConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { encryptedWebhookSecret: `enc(${out.secret})` },
      });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { source: 'generated' } }));
    });

    it('records a blank provided secret as generated, since one is generated in its place', async () => {
      const out = await svc.setWebhookSecret('c1', '        ');
      expect(out.secret).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { source: 'generated' } }));
    });

    it('stores a trimmed provider-issued secret', async () => {
      const out = await svc.setWebhookSecret('c1', '  signing-secret  ');
      expect(out).toMatchObject({ configured: true, secret: 'signing-secret' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: { source: 'provider' } }));
    });

    it('disableWebhook clears the secret', async () => {
      await expect(svc.disableWebhook('c1')).resolves.toMatchObject({ configured: false });
      expect(prisma.integrationConnection.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { encryptedWebhookSecret: null },
      });
    });
  });
});
