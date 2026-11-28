import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { safeEqual } from '../common/crypto/tokens';
import { toDay } from '../common/http/http';
import { AdapterRegistry } from '../integrations/adapters/adapter.registry';
import { WebhookRequest, header } from '../integrations/adapters/adapter.types';
import { SyncDispatcher } from '../integrations/sync-dispatcher.service';
import { utcMidnight } from '../integrations/sync.service';

/** How far back an event may reach. Older corrections are picked up by a manual backfill. */
const MAX_LOOKBACK_DAYS = 30;

/**
 * Inbound webhooks are "something changed" signals: after verifying the request, the affected
 * days are re-synced (debounced), so the adapters stay the single source of truth.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly registry: AdapterRegistry,
    private readonly dispatcher: SyncDispatcher,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verifies a webhook and enqueues a debounced re-sync (`WEBHOOK_DEBOUNCE_MS`, default 60 s).
   *
   * @remarks
   * The request passes when the provider adapter verifies its signature, or when the `X-Cadence-Token` header
   * (or `queryToken`) equals the connection's webhook secret. The re-sync covers yesterday through today, plus
   * any earlier day the adapter finds in the payload, up to {@link MAX_LOOKBACK_DAYS} days back.
   *
   * @param queryToken - the `?token=` query value, used when the header is absent
   * @returns the accepted re-sync range as `YYYY-MM-DD` days
   * @throws NotFoundException when the connection does not exist, is disabled or has no webhook secret
   * @throws UnauthorizedException when neither the signature nor the token is valid
   */
  async receive(connectionId: string, req: WebhookRequest, queryToken?: string) {
    const connection = await this.prisma.integrationConnection.findUnique({ where: { id: connectionId } });
    if (!connection || !connection.enabled || !connection.encryptedWebhookSecret) {
      throw new NotFoundException();
    }
    const secret = this.crypto.decrypt(connection.encryptedWebhookSecret);
    const adapter = this.registry.get(connection.provider);

    const sharedToken = header(req, 'x-cadence-token') ?? queryToken;
    const verified =
      (adapter.verifyWebhook?.(req, secret) ?? false) || (!!sharedToken && safeEqual(sharedToken, secret));
    if (!verified) {
      this.logger.warn(`Rejected webhook for ${connection.name}: bad signature/token`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const today = utcMidnight(new Date());
    const earliest = new Date(today.getTime() - (MAX_LOOKBACK_DAYS - 1) * 864e5);
    const yesterday = new Date(today.getTime() - 864e5);
    const eventDays = (adapter.webhookDates?.(req.body) ?? [])
      .map((d) => new Date(`${d}T00:00:00.000Z`))
      .filter((d) => !Number.isNaN(d.getTime()) && d >= earliest && d <= today);
    // Always include yesterday→today so events near midnight (and their timezone skew) are covered.
    const from = new Date(Math.min(yesterday.getTime(), ...eventDays.map((d) => d.getTime())));
    const delayMs = Number(this.config.get('WEBHOOK_DEBOUNCE_MS', 60_000));

    await this.dispatcher.enqueueDebounced(connection.id, { from, to: today }, 'webhook', delayMs);
    return { accepted: true, resyncFrom: toDay(from), resyncTo: toDay(today) };
  }
}
