import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { CreateIntegrationBody, SyncBody, UpdateIntegrationBody, WebhookSecretBody } from './dto';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../generated/prisma/enums';

/**
 * `/api/integrations`. Reads are open to any signed-in user; changes, tests, syncs, run history and webhook
 * settings are admin-only.
 */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  /** Readable by everyone so managers can pick a connection when linking identities. */
  @Get()
  list() {
    return this.integrations.list();
  }

  /** Descriptors of the available providers (label, capabilities, config form). */
  @Get('providers')
  providers() {
    return this.integrations.providers();
  }

  /** Identity autocomplete from the platform for `q` (at least 2 characters, else an empty list). */
  @Get(':id/users')
  searchUsers(@Param('id') id: string, @Query('q') q = '') {
    return this.integrations.searchUsers(id, q);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: CreateIntegrationBody) {
    return this.integrations.create(body);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateIntegrationBody) {
    return this.integrations.update(id, body);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.integrations.remove(id);
  }

  /** Tests the stored credentials; returns `{ ok, message }` with 200 even when the test fails. */
  @Roles(UserRole.ADMIN)
  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id') id: string) {
    return this.integrations.test(id);
  }

  /** Queues a background sync of the last `days` days (default 14) and returns the QUEUED run. */
  @Roles(UserRole.ADMIN)
  @Post(':id/sync')
  @HttpCode(200)
  sync(@Param('id') id: string, @Body() body: SyncBody) {
    return this.integrations.runSync(id, body.days);
  }

  /** The connection's 20 most recent sync runs, newest first. */
  @Roles(UserRole.ADMIN)
  @Get(':id/runs')
  runs(@Param('id') id: string) {
    return this.integrations.runs(id);
  }

  /** One sync run, for polling its status. */
  @Roles(UserRole.ADMIN)
  @Get(':id/runs/:runId')
  run(@Param('id') id: string, @Param('runId') runId: string) {
    return this.integrations.run(id, runId);
  }

  /** Webhook URL and whether a secret is configured (the secret itself is never returned here). */
  @Roles(UserRole.ADMIN)
  @Get(':id/webhook')
  webhook(@Param('id') id: string) {
    return this.integrations.webhookInfo(id);
  }

  /** Sets the webhook secret (provider-issued or generated) and returns it once, with the URL. */
  @Roles(UserRole.ADMIN)
  @Post(':id/webhook')
  @HttpCode(200)
  setWebhook(@Param('id') id: string, @Body() body: WebhookSecretBody) {
    return this.integrations.setWebhookSecret(id, body.secret);
  }

  /** Removes the webhook secret so inbound webhooks for this connection are rejected. */
  @Roles(UserRole.ADMIN)
  @Delete(':id/webhook')
  disableWebhook(@Param('id') id: string) {
    return this.integrations.disableWebhook(id);
  }
}
