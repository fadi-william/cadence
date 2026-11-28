import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { IntegrationProvider } from '../../generated/prisma/enums';
import { INTEGRATION_ADAPTERS, IntegrationAdapter } from './adapter.types';

/** Looks up the adapter for a connection's provider among those registered in `IntegrationsModule`. */
@Injectable()
export class AdapterRegistry {
  private readonly byProvider = new Map<IntegrationProvider, IntegrationAdapter>();

  constructor(@Inject(INTEGRATION_ADAPTERS) adapters: IntegrationAdapter[]) {
    for (const a of adapters) this.byProvider.set(a.provider, a);
  }

  /** @throws BadRequestException when no adapter is registered for `provider` */
  get(provider: IntegrationProvider): IntegrationAdapter {
    const adapter = this.byProvider.get(provider);
    if (!adapter) throw new BadRequestException(`No adapter registered for ${provider}`);
    return adapter;
  }

  /** Every registered adapter, in registration order. */
  all(): IntegrationAdapter[] {
    return [...this.byProvider.values()];
  }
}
