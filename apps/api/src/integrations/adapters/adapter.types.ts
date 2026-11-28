import { createHmac } from 'node:crypto';
import type { ProviderDescriptorDto } from '@cadence/shared';
import { safeEqual } from '../../common/crypto/tokens';
import { IntegrationProvider } from '../../generated/prisma/enums';

/**
 * Ports for external delivery platforms, plus small helpers shared by the adapters.
 *
 * Adapters only translate: they receive a connection's settings and the identities to look up, call the
 * platform's API and return normalised records. They never touch the database; `SyncService` aggregates
 * and stores what they return. To add a platform (e.g. GitHub, GitLab, Linear):
 *   1. implement `WorkTrackingAdapter`, `SourceControlAdapter` and/or `DeploymentsAdapter`
 *   2. add the provider to the Prisma enum + shared enum
 *   3. register the class in integrations.module.ts (`INTEGRATION_ADAPTERS`)
 *
 * See docs/guide/adapters.md for a worked example.
 */

/** DI token for the array of every registered {@link IntegrationAdapter}, consumed by `AdapterRegistry`. */
export const INTEGRATION_ADAPTERS = Symbol('INTEGRATION_ADAPTERS');

/** Everything an adapter needs to call the platform for one connection. */
export interface AdapterContext {
  /** Connection base URL without a trailing slash (e.g. `https://your-company.atlassian.net`). */
  baseUrl: string;
  /**
   * Values of the adapter's `configFields`, keyed by field key. Shape is not validated, so read it with
   * {@link stringConfig} / {@link listConfig}.
   */
  config: Record<string, unknown>;
  /** Decrypted credential (API token / PAT). */
  secret: string;
}

/** A member's linked identity on this connection: who to look up and whom to credit. */
export interface IdentityRef {
  /** Cadence member id to put on the resulting {@link ActivityRecord}s. */
  memberId: string;
  /** Platform username as linked by a manager (e.g. Jira accountId, Azure DevOps uniqueName). */
  username: string;
  /** Platform-internal id when one is stored; may be null or absent. */
  externalId?: string | null;
}

/** Inclusive UTC date range. */
export interface DateRange {
  /** First day, at UTC midnight. */
  from: Date;
  /** Last day (inclusive), at UTC midnight; use {@link dayAfter} for an exclusive upper bound. */
  to: Date;
}

/**
 * Normalised activity for one member on one UTC day. All counters are additive: adapters usually emit one
 * record per event and `aggregate()` sums them per member and day. Records dated outside the sync range are
 * dropped.
 */
export interface ActivityRecord {
  memberId: string;
  /** UTC day, YYYY-MM-DD. */
  date: string; // YYYY-MM-DD
  commits?: number;
  prsRaised?: number;
  prsReviewed?: number;
  prsMerged?: number;
  issuesCompleted?: number;
  /**
   * The completed work item this record credits (with issuesCompleted: 1). Several people can be
   * credited with the same item; team totals count each key once.
   */
  workItemKey?: string;
  storyPoints?: number;
  /** Cycle time samples in hours; stored per day as a sum plus a sample count. */
  cycleTimeHours?: number[];
  /** Assignments (periods one person held a work item) that ended this day with a stage move. */
  assignmentsCompleted?: number;
  /** Assignments that ended this day by reassignment without a stage move. */
  assignmentsHandedOver?: number;
  /** Ended assignments where the person had already held the same item before. */
  assignmentsReworked?: number;
  /** Hold time (calendar hours) of each completed assignment. */
  holdHours?: number[];
  /**
   * A pull request authored by `memberId` that got its first review on `date`: a key unique per connection
   * (set together with {@link ActivityRecord.reviewWaitHours}). Stored once per PR, not summed.
   */
  pullRequestKey?: string;
  /** Hours the PR in `pullRequestKey` waited for its first review, from being opened or published. */
  reviewWaitHours?: number;
}

/** A platform user returned by `searchUsers`, offered in the identity-linking autocomplete. */
export interface ExternalUser {
  /** Value to store as the identity's username; must be what the adapter matches activity against. */
  username: string;
  displayName: string;
  email?: string;
  externalId?: string;
}

/** A production deployment of one service (pipeline / repository), normalised across CI/CD platforms. */
export interface DeploymentRecord {
  /** Platform id of the deployment (e.g. build id); deployments are upserted by service and this id. */
  externalId: string;
  /** Service name; a `DeliveryService` is created per distinct name on the connection. */
  service: string;
  environment: string;
  status: 'SUCCESS' | 'FAILED';
  /** ISO timestamp, or null when unknown. */
  startedAt?: string | null;
  /** ISO timestamp. */
  finishedAt: string;
  /** Hours from the deployed commit's authoring time to the deployment finishing. */
  leadTimeHours?: number | null;
}

/** The inbound webhook request as seen by adapters. */
export interface WebhookRequest {
  /** Request headers with lower-case names; read them with {@link header}. */
  headers: Record<string, string | string[] | undefined>;
  /** Unparsed body bytes, needed for signature checks. */
  rawBody: Buffer;
  /** Parsed JSON body. */
  body: unknown;
}

/**
 * Base port every platform adapter implements. Capabilities are added by also implementing
 * {@link WorkTrackingAdapter}, {@link SourceControlAdapter} and/or {@link DeploymentsAdapter}; the sync
 * engine detects them at runtime with {@link isWorkTracking}, {@link isSourceControl} and
 * {@link isDeployments}.
 */
export interface IntegrationAdapter {
  /** Provider this adapter serves; `AdapterRegistry` keeps one adapter per provider. */
  readonly provider: IntegrationProvider;
  /** Label, capabilities, config fields and help texts; the web app builds the connection form from it. */
  describe(): ProviderDescriptorDto;
  /** Checks the credentials against the platform. Reports failures in the result rather than throwing. */
  testConnection(ctx: AdapterContext): Promise<{ ok: boolean; message?: string }>;
  /** Identity autocomplete. Only called for queries of at least 2 characters (trimmed). */
  searchUsers?(ctx: AdapterContext, query: string): Promise<ExternalUser[]>;
  /**
   * Provider-native signature check (e.g. HMAC). Falls back to the `X-Cadence-Token` header (or `?token=`)
   * when absent or false.
   */
  verifyWebhook?(req: WebhookRequest, secret: string): boolean;
  /**
   * UTC days (YYYY-MM-DD) touched by a webhook event. Days within the last 30 extend the re-sync back from
   * its default of yesterday to today; when absent, only yesterday and today are re-synced.
   */
  webhookDates?(body: unknown): string[];
}

/** Issues / work items (Jira-like): completed items, story points, cycle time and assignments. */
export interface WorkTrackingAdapter extends IntegrationAdapter {
  fetchWorkItemActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange): Promise<ActivityRecord[]>;
}

/** Commits, pull requests and reviews (Azure Repos-like). */
export interface SourceControlAdapter extends IntegrationAdapter {
  fetchCodeActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange): Promise<ActivityRecord[]>;
}

/** Production deployments for DORA metrics (pipelines-like). Not tied to member identities. */
export interface DeploymentsAdapter extends IntegrationAdapter {
  fetchDeployments(ctx: AdapterContext, range: DateRange): Promise<DeploymentRecord[]>;
}

/** Whether the adapter has the deployments capability. */
export const isDeployments = (a: IntegrationAdapter): a is DeploymentsAdapter =>
  typeof (a as DeploymentsAdapter).fetchDeployments === 'function';

/** Whether the adapter has the work-tracking capability. */
export const isWorkTracking = (a: IntegrationAdapter): a is WorkTrackingAdapter =>
  typeof (a as WorkTrackingAdapter).fetchWorkItemActivity === 'function';

/** Whether the adapter has the source-control capability. */
export const isSourceControl = (a: IntegrationAdapter): a is SourceControlAdapter =>
  typeof (a as SourceControlAdapter).fetchCodeActivity === 'function';

/** Removes trailing slashes so paths can be appended with a single `/`. */
export const trimSlash = (url: string) => url.replace(/\/+$/, '');

/** Exclusive end of an inclusive date range, i.e. the day after `to`. */
export const dayAfter = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

/** Reads a request header case-insensitively; returns the first value of a repeated header. */
export const header = (req: WebhookRequest, name: string): string | undefined => {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Verifies `<prefix><hex hmac-sha256(rawBody)>` signatures (Jira style) with a constant-time comparison.
 *
 * @param headerName - Header carrying the signature, e.g. `x-hub-signature`.
 * @returns false when the header is missing or the signature does not match.
 */
export function verifyHmacSha256(req: WebhookRequest, headerName: string, secret: string, prefix = 'sha256=') {
  const sig = header(req, headerName);
  if (!sig) return false;
  const expected = prefix + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(sig, expected);
}

/** Hours from `from` to `to` (fractional; negative when `to` is earlier). */
export const hoursBetween = (from: string | Date, to: string | Date) =>
  (new Date(to).getTime() - new Date(from).getTime()) / 36e5;

/** Splits an inclusive range into consecutive inclusive windows of at most `days` days. */
export function chunkRange(range: DateRange, days: number): DateRange[] {
  const out: DateRange[] = [];
  let start = new Date(range.from);
  while (start <= range.to) {
    const end = new Date(Math.min(start.getTime() + (days - 1) * 864e5, range.to.getTime()));
    out.push({ from: start, to: end });
    start = new Date(end.getTime() + 864e5);
  }
  return out;
}

/**
 * Reads a string[] config value that may arrive as a list or comma-separated string. Entries are trimmed and
 * empty ones dropped; any other type yields an empty list.
 */
export function listConfig(ctx: AdapterContext, key: string): string[] {
  const v = ctx.config[key];
  if (Array.isArray(v))
    return v
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  if (typeof v === 'string')
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/** Reads a trimmed string config value, or `fallback` when it is missing, blank or not a string. */
export function stringConfig(ctx: AdapterContext, key: string, fallback = ''): string {
  const v = ctx.config[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}
