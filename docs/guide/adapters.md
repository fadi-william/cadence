# Add a provider

Cadence talks to delivery platforms through **adapters**. Jira and Azure DevOps ship in the box; adding
GitHub, GitLab, Linear or an in-house tool means writing **one class**. The sync engine, scheduling,
webhooks, encryption and the whole UI work with your adapter automatically.

## How it fits together

```text
             ┌──────────────────────────┐
  nightly /  │      SyncDispatcher      │  BullMQ queue (with Redis) or in-process
  webhook /  └────────────┬─────────────┘
  "Sync now"              ▼
             ┌──────────────────────────┐   decrypted token, base URL, config
             │       SyncService        │ ───────────────────────────────────┐
             └────────────┬─────────────┘                                    ▼
                          │                                      ┌───────────────────────┐
                          │ ActivityRecord[] / DeploymentRecord[] │   Your adapter class   │
                          ◀──────────────────────────────────────┤ (calls the platform)  │
                          ▼                                      └───────────────────────┘
             daily metrics per person · deployments per service
```

An adapter **only translates**: it receives the connection's settings and the people to look up, calls
the platform's API, and returns normalized records. It never touches the database.

## The contract

Adapters implement one or more **capabilities**, defined in
`apps/api/src/integrations/adapters/adapter.types.ts`:

```ts
interface IntegrationAdapter {
  readonly provider: IntegrationProvider;
  describe(): ProviderDescriptorDto;                 // label, form fields, help text
  testConnection(ctx: AdapterContext): Promise<{ ok: boolean; message?: string }>;
  searchUsers?(ctx: AdapterContext, query: string): Promise<ExternalUser[]>;   // identity autocomplete
  verifyWebhook?(req: WebhookRequest, secret: string): boolean;                // e.g. HMAC signatures
  webhookDates?(body: unknown): string[];                                       // days to re-sync
}

/** Issues / work items (Jira-like). */
interface WorkTrackingAdapter extends IntegrationAdapter {
  fetchWorkItemActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange): Promise<ActivityRecord[]>;
}

/** Commits, pull requests, reviews (Azure Repos-like). */
interface SourceControlAdapter extends IntegrationAdapter {
  fetchCodeActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange): Promise<ActivityRecord[]>;
}

/** Production deployments for DORA (pipelines-like). */
interface DeploymentsAdapter extends IntegrationAdapter {
  fetchDeployments(ctx: AdapterContext, range: DateRange): Promise<DeploymentRecord[]>;
}
```

The inputs:

| Type | Contents |
|---|---|
| `AdapterContext` | `baseUrl`, `config` (your form fields) and the decrypted `secret` |
| `IdentityRef` | `memberId` plus the `username` someone linked for that person |
| `DateRange` | Inclusive UTC `from` / `to` days |

The output is a list of small, additive records. Return one per event, and Cadence sums them per
person per day:

```ts
interface ActivityRecord {
  memberId: string;
  date: string;              // YYYY-MM-DD (UTC)
  commits?: number;
  prsRaised?: number;
  prsReviewed?: number;
  prsMerged?: number;
  issuesCompleted?: number;
  workItemKey?: string;      // with issuesCompleted: 1; one record per person credited, teams count each key once
  storyPoints?: number;
  cycleTimeHours?: number[];
  // Assignments (optional): periods one person held a work item, dated on the day each ended.
  assignmentsCompleted?: number;  // ended with a stage move
  assignmentsHandedOver?: number; // ended by reassignment without a stage move
  assignmentsReworked?: number;   // the person had held the same item before
  holdHours?: number[];           // calendar hours of each completed assignment
}
```

## Example: a minimal GitHub adapter

```ts
// apps/api/src/integrations/adapters/github/github.adapter.ts
import { Injectable } from '@nestjs/common';
import type { ProviderDescriptorDto } from '@cadence/shared';
import { IntegrationProvider } from '../../../generated/prisma/enums';
import { httpJson, toDay } from '../../../common/http/http';
import {
  ActivityRecord, AdapterContext, DateRange, IdentityRef, SourceControlAdapter,
  WebhookRequest, stringConfig, trimSlash, verifyHmacSha256,
} from '../adapter.types';

@Injectable()
export class GitHubAdapter implements SourceControlAdapter {
  readonly provider = IntegrationProvider.GITHUB;

  describe(): ProviderDescriptorDto {
    return {
      provider: 'GITHUB',
      label: 'GitHub',
      capabilities: ['SOURCE_CONTROL'],
      secretLabel: 'Personal access token',
      identityHint: 'GitHub login',
      defaultBaseUrl: 'https://api.github.com',
      baseUrlHint: 'https://api.github.com',
      configFields: [{ key: 'org', label: 'Organization', type: 'text', required: true }],
    };
  }

  private headers(ctx: AdapterContext) {
    return { Authorization: `Bearer ${ctx.secret}`, 'User-Agent': 'cadence' };
  }

  async testConnection(ctx: AdapterContext) {
    try {
      const me = await httpJson<{ login: string }>(`${trimSlash(ctx.baseUrl)}/user`, { headers: this.headers(ctx) });
      return { ok: true, message: `Authenticated as ${me.login}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  verifyWebhook(req: WebhookRequest, secret: string) {
    return verifyHmacSha256(req, 'x-hub-signature-256', secret);
  }

  async fetchCodeActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange) {
    const org = stringConfig(ctx, 'org');
    const out: ActivityRecord[] = [];
    for (const person of identities) {
      const q = `type:pr org:${org} author:${person.username} created:${toDay(range.from)}..${toDay(range.to)}`;
      const res = await httpJson<{ items: { created_at: string }[] }>(
        `${trimSlash(ctx.baseUrl)}/search/issues?q=${encodeURIComponent(q)}&per_page=100`,
        { headers: this.headers(ctx) },
      );
      for (const pr of res.items) out.push({ memberId: person.memberId, date: toDay(pr.created_at), prsRaised: 1 });
    }
    return out;
  }
}
```

`httpJson` retries on 429/5xx and honors `Retry-After`; `limiter(n)` caps concurrent requests. Both
live in `apps/api/src/common/http/http.ts`.

## Register it

1. **Add the provider to the enums.** In `apps/api/prisma/schema.prisma`:

   ```prisma
   enum IntegrationProvider {
     JIRA
     AZURE_DEVOPS
     GITHUB
   }
   ```

   Then create the migration: `npm run prisma:migrate -w @cadence/api -- --name add_github`.

2. **Mirror it in the shared contracts** (`packages/shared/src/index.ts`): add `GITHUB` to
   `IntegrationProvider` and a label to `PROVIDER_LABELS`.

3. **Register the class** in `apps/api/src/integrations/integrations.module.ts`:

   ```ts
   const ADAPTERS = [JiraAdapter, AzureDevOpsAdapter, GitHubAdapter];
   ```

4. *(Optional)* Give it an icon in `apps/web/src/app/shared/provider-icon.ts`.

That's it. **Integrations** now shows *Connect GitHub* with the form you described, people can link
GitHub accounts, syncs run on schedule, and the data appears in dashboards and combined profiles.

## Test it

Adapters are plain classes, so test them by mocking `fetch` (see the Jira and Azure DevOps specs):

```ts
import { GitHubAdapter } from './github.adapter';

it('counts pull requests per day', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ items: [{ created_at: '2026-11-02T10:00:00Z' }] })),
  );
  const records = await new GitHubAdapter().fetchCodeActivity(
    { baseUrl: 'https://api.github.com', config: { org: 'cadence' }, secret: 't' },
    [{ memberId: 'm1', username: 'octocat' }],
    { from: new Date('2026-11-01'), to: new Date('2026-11-03') },
  );
  expect(records).toEqual([{ memberId: 'm1', date: '2026-11-02', prsRaised: 1 }]);
});
```

Run `npm test` for unit tests, and `npm run test:int` for the API integration suite.

## Good practices

- **Be idempotent.** A sync may re-read a range many times; return the same records each time.
- **Stay read-only.** Ask users for the smallest scopes that work, and list them in `secretHelp`.
- **Use UTC days.** Convert timestamps with `toDay()` so records land on the right day.
- **Match identities generously.** Compare case-insensitively, and accept e-mail or id where the platform
  has both.
- **Skip what you can't read.** Log and continue rather than failing the whole sync because one repo is
  inaccessible.
