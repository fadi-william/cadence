import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SyncService } from './sync.service';
import { SyncDispatcher } from './sync-dispatcher.service';
import { AdapterRegistry } from './adapters/adapter.registry';
import { INTEGRATION_ADAPTERS, IntegrationAdapter } from './adapters/adapter.types';
import { JiraAdapter } from './adapters/jira/jira.adapter';
import { AzureDevOpsAdapter } from './adapters/azure-devops/azure-devops.adapter';

/** Register new platform adapters here. */
const ADAPTERS = [JiraAdapter, AzureDevOpsAdapter];

/**
 * Integration connections, platform adapters and the sync engine. Exports the sync services and registry
 * for the webhooks module.
 */
@Module({
  controllers: [IntegrationsController],
  providers: [
    ...ADAPTERS,
    {
      provide: INTEGRATION_ADAPTERS,
      useFactory: (...adapters: IntegrationAdapter[]) => adapters,
      inject: ADAPTERS,
    },
    AdapterRegistry,
    SyncService,
    SyncDispatcher,
    IntegrationsService,
  ],
  exports: [SyncService, SyncDispatcher, AdapterRegistry, IntegrationsService],
})
export class IntegrationsModule {}
