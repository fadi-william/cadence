import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/** Inbound webhook endpoint; uses the integration adapters and sync dispatcher. */
@Module({ imports: [IntegrationsModule], controllers: [WebhooksController], providers: [WebhooksService] })
export class WebhooksModule {}
