import { BadRequestException } from '@nestjs/common';
import { AdapterRegistry } from './adapter.registry';
import type { IntegrationAdapter } from './adapter.types';

const adapter = (provider: string, tag = provider) =>
  ({ provider, tag, describe: vi.fn(), testConnection: vi.fn() }) as unknown as IntegrationAdapter;

describe('AdapterRegistry', () => {
  it('looks adapters up by provider', () => {
    const jira = adapter('JIRA');
    const ado = adapter('AZURE_DEVOPS');
    const reg = new AdapterRegistry([jira, ado]);
    expect(reg.get('JIRA')).toBe(jira);
    expect(reg.get('AZURE_DEVOPS')).toBe(ado);
    expect(reg.all()).toEqual([jira, ado]);
  });

  it('rejects unknown providers with a 400', () => {
    const reg = new AdapterRegistry([adapter('JIRA')]);
    expect(() => reg.get('AZURE_DEVOPS')).toThrow(BadRequestException);
    expect(() => reg.get('AZURE_DEVOPS')).toThrow('No adapter registered for AZURE_DEVOPS');
  });

  it('lets a later registration for the same provider win', () => {
    const second = adapter('JIRA', 'second');
    const reg = new AdapterRegistry([adapter('JIRA', 'first'), second]);
    expect(reg.get('JIRA')).toBe(second);
    expect(reg.all()).toHaveLength(1);
  });
});
