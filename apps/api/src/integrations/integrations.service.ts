import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IntegrationConnectionDto, WebhookInfoDto } from '@cadence/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuditService } from '../audit/audit.service';
import { randomToken } from '../common/crypto/tokens';
import { AdapterRegistry } from './adapters/adapter.registry';
import { SyncService } from './sync.service';
import { SyncDispatcher } from './sync-dispatcher.service';
import { CreateIntegrationBody, UpdateIntegrationBody } from './dto';
import { emptyMetricRow, metricColumns, validateFeatures, zeroColumns } from './features';
import { IntegrationKind } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import type { IntegrationConnection, SyncRun } from '../generated/prisma/client';

/** API shape of a sync run: ISO timestamps, `rangeFrom`/`rangeTo` as YYYY-MM-DD days. */
export const serialiseRun = (r: SyncRun) => ({
  id: r.id,
  connectionId: r.connectionId,
  status: r.status,
  trigger: r.trigger,
  recordsWritten: r.recordsWritten,
  error: r.error,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  rangeFrom: r.rangeFrom.toISOString().slice(0, 10),
  rangeTo: r.rangeTo.toISOString().slice(0, 10),
});

/** API shape of a connection. Never includes secrets, only whether they are set. */
const toDto = (c: IntegrationConnection & { syncRuns?: SyncRun[] }): IntegrationConnectionDto => ({
  id: c.id,
  name: c.name,
  provider: c.provider,
  baseUrl: c.baseUrl,
  config: (c.config ?? {}) as Record<string, unknown>,
  enabled: c.enabled,
  features: c.features,
  hasSecret: !!c.encryptedSecret,
  webhookConfigured: !!c.encryptedWebhookSecret,
  createdAt: c.createdAt.toISOString(),
  lastSync: c.syncRuns?.[0] ? serialiseRun(c.syncRuns[0]) : null,
});

/**
 * CRUD for integration connections, plus the admin actions on them: connection test, identity search,
 * manual sync requests, sync run history and webhook secrets. Secrets are encrypted at rest and every
 * change is audited.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: AdapterRegistry,
    private readonly sync: SyncService,
    private readonly dispatcher: SyncDispatcher,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Descriptors of every registered adapter, used by the UI to build connection forms. */
  providers() {
    return this.registry.all().map((a) => a.describe());
  }

  /** All connections, by name, each with its most recent sync run as `lastSync` (null if never synced). */
  async list() {
    const rows = await this.prisma.integrationConnection.findMany({
      orderBy: { name: 'asc' },
      include: { syncRuns: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    return rows.map(toDto);
  }

  private async find(id: string) {
    const c = await this.prisma.integrationConnection.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Integration not found');
    return c;
  }

  /**
   * Creates a connection syncing `features`, or every capability of the provider when omitted.
   *
   * @throws BadRequestException when no adapter is registered for the provider, or a feature is unsupported
   */
  async create(body: CreateIntegrationBody) {
    const { capabilities } = this.registry.get(body.provider).describe();
    const features = validateFeatures(body.features ?? capabilities, capabilities);
    const row = await this.prisma.integrationConnection.create({
      data: {
        name: body.name,
        provider: body.provider,
        baseUrl: body.baseUrl.replace(/\/+$/, ''),
        config: (body.config ?? {}) as Prisma.InputJsonValue,
        encryptedSecret: this.crypto.encrypt(body.secret),
        enabled: body.enabled ?? true,
        features,
      },
    });
    await this.audit.record({
      action: 'integration.created',
      entityType: 'integration',
      entityId: row.id,
      metadata: { name: row.name, provider: row.provider, features },
    });
    return toDto(row);
  }

  /**
   * Applies the given fields; the secret is only replaced when a new one is sent. The audit entry lists the
   * changed field names, never their values, plus any feature changes.
   *
   * @remarks
   * Turning a feature off keeps its collected data (no longer refreshed) unless it is listed in
   * `removeDataFor`, in which case its data is deleted in the same transaction as the update.
   *
   * @throws NotFoundException when the connection does not exist
   * @throws BadRequestException when a feature is unsupported, none would remain, or `removeDataFor` names
   * a feature this update does not turn off
   */
  async update(id: string, body: UpdateIntegrationBody) {
    const current = await this.find(id);
    const features = body.features
      ? validateFeatures(body.features, this.registry.get(current.provider).describe().capabilities)
      : current.features;
    const turnedOff = current.features.filter((f) => !features.includes(f));
    const removeDataFor = body.removeDataFor ?? [];
    const invalid = removeDataFor.filter((k) => !turnedOff.includes(k));
    if (invalid.length) {
      throw new BadRequestException(
        `Data can only be removed for features this update turns off: ${invalid.join(', ')}`,
      );
    }
    const [row] = await this.prisma.$transaction([
      this.prisma.integrationConnection.update({
        where: { id },
        data: {
          name: body.name,
          baseUrl: body.baseUrl?.replace(/\/+$/, ''),
          config: body.config as Prisma.InputJsonValue | undefined,
          enabled: body.enabled,
          features: body.features ? features : undefined,
          ...(body.secret ? { encryptedSecret: this.crypto.encrypt(body.secret) } : {}),
        },
      }),
      ...this.removeFeatureData(id, removeDataFor),
    ]);
    const turnedOn = features.filter((f) => !current.features.includes(f));
    await this.audit.record({
      action: 'integration.updated',
      entityType: 'integration',
      entityId: id,
      metadata: {
        fields: Object.keys(body).map((k) => (k === 'secret' ? 'secret(changed)' : k)),
        ...(turnedOn.length || turnedOff.length
          ? { featuresOn: turnedOn, featuresOff: turnedOff, dataRemovedFor: removeDataFor }
          : {}),
      },
    });
    return toDto(row);
  }

  /**
   * Operations that delete what the given capabilities collected for a connection: their `DailyMetric`
   * columns (rows left empty are deleted), completed work items for work tracking, reviewed pull requests
   * for source control, and the discovered services with their deployments and team owners for deployments.
   */
  private removeFeatureData(connectionId: string, kinds: IntegrationKind[]) {
    if (!kinds.length) return [];
    return [
      ...(metricColumns(kinds).length
        ? [
            this.prisma.dailyMetric.updateMany({ where: { connectionId }, data: zeroColumns(kinds) }),
            this.prisma.dailyMetric.deleteMany({ where: { connectionId, ...emptyMetricRow } }),
          ]
        : []),
      ...(kinds.includes(IntegrationKind.WORK_TRACKING)
        ? [this.prisma.workItem.deleteMany({ where: { connectionId } })]
        : []),
      ...(kinds.includes(IntegrationKind.SOURCE_CONTROL)
        ? [this.prisma.reviewedPullRequest.deleteMany({ where: { connectionId } })]
        : []),
      ...(kinds.includes(IntegrationKind.DEPLOYMENTS)
        ? [this.prisma.deliveryService.deleteMany({ where: { connectionId } })]
        : []),
    ];
  }

  /** @throws NotFoundException when the connection does not exist */
  async remove(id: string) {
    const c = await this.find(id);
    await this.prisma.integrationConnection.delete({ where: { id } });
    await this.audit.record({
      action: 'integration.deleted',
      entityType: 'integration',
      entityId: id,
      metadata: { name: c.name },
    });
  }

  /** Builds the adapter context for a connection, decrypting its secret. */
  context(c: IntegrationConnection) {
    return {
      baseUrl: c.baseUrl,
      config: (c.config ?? {}) as Record<string, unknown>,
      secret: this.crypto.decrypt(c.encryptedSecret),
    };
  }

  /**
   * Runs the adapter's connection test.
   *
   * @throws NotFoundException when the connection does not exist
   */
  async test(id: string) {
    const c = await this.find(id);
    return this.registry.get(c.provider).testConnection(this.context(c));
  }

  /**
   * Identity autocomplete on the platform. Returns an empty list when the adapter has no user search or
   * the trimmed query is shorter than 2 characters.
   *
   * @throws NotFoundException when the connection does not exist
   * @throws BadGatewayException when the platform lookup fails
   */
  async searchUsers(id: string, q: string) {
    const c = await this.find(id);
    const adapter = this.registry.get(c.provider);
    if (!adapter.searchUsers || q.trim().length < 2) return [];
    try {
      return await adapter.searchUsers(this.context(c), q.trim());
    } catch (e) {
      // Upstream failure (network, auth): a 502 the UI can ignore, not an unhandled 500.
      throw new BadGatewayException(`User lookup failed: ${(e as Error).message}`);
    }
  }

  /**
   * Queues a manual sync of the last `days` days (including today) and returns the QUEUED run right away;
   * poll {@link IntegrationsService.run} for completion.
   *
   * @throws NotFoundException when the connection does not exist
   */
  async runSync(id: string, days = 14) {
    await this.find(id);
    const run = await this.dispatcher.enqueue(id, this.sync.rangeForDays(days), 'manual');
    await this.audit.record({
      action: 'integration.sync_requested',
      entityType: 'integration',
      entityId: id,
      metadata: { days },
    });
    return serialiseRun(run);
  }

  /**
   * The 20 most recent sync runs of a connection, newest first.
   *
   * @throws NotFoundException when the connection does not exist
   */
  async runs(id: string) {
    await this.find(id);
    const runs = await this.prisma.syncRun.findMany({
      where: { connectionId: id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return runs.map(serialiseRun);
  }

  /** @throws NotFoundException when the run does not exist or belongs to another connection */
  async run(id: string, runId: string) {
    const run = await this.prisma.syncRun.findFirst({ where: { id: runId, connectionId: id } });
    if (!run) throw new NotFoundException('Sync run not found');
    return serialiseRun(run);
  }

  /** Public URL the platform posts to, built from `PUBLIC_API_URL` (default `http://localhost:3000/api`). */
  webhookUrl(id: string) {
    const base = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:3000/api').replace(/\/$/, '');
    return `${base}/webhooks/${id}`;
  }

  /**
   * Webhook URL and whether a secret is set. Never returns the secret itself.
   *
   * @throws NotFoundException when the connection does not exist
   */
  async webhookInfo(id: string): Promise<WebhookInfoDto> {
    const c = await this.find(id);
    return { url: this.webhookUrl(id), configured: !!c.encryptedWebhookSecret };
  }

  /**
   * Generates a webhook secret, or stores one issued by the provider (e.g. a signing secret copied from
   * Jira). Replaces any existing secret.
   *
   * @param provided - Provider-issued secret; when omitted or blank a random one is generated.
   * @returns The webhook info including the plain secret. This is the only response that contains it.
   * @throws NotFoundException when the connection does not exist
   */
  async setWebhookSecret(id: string, provided?: string): Promise<WebhookInfoDto> {
    await this.find(id);
    const issued = provided?.trim();
    const secret = issued || randomToken(24);
    await this.prisma.integrationConnection.update({
      where: { id },
      data: { encryptedWebhookSecret: this.crypto.encrypt(secret) },
    });
    await this.audit.record({
      action: 'integration.webhook_secret_set',
      entityType: 'integration',
      entityId: id,
      metadata: { source: issued ? 'provider' : 'generated' },
    });
    return { url: this.webhookUrl(id), configured: true, secret };
  }

  /**
   * Deletes the webhook secret, after which inbound webhooks for the connection are rejected.
   *
   * @throws NotFoundException when the connection does not exist
   */
  async disableWebhook(id: string): Promise<WebhookInfoDto> {
    await this.find(id);
    await this.prisma.integrationConnection.update({ where: { id }, data: { encryptedWebhookSecret: null } });
    await this.audit.record({ action: 'integration.webhook_disabled', entityType: 'integration', entityId: id });
    return { url: this.webhookUrl(id), configured: false };
  }
}
