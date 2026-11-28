/**
 * Shared contracts between `@cadence/api` and `@cadence/web`: enums, display labels and the request /
 * response DTOs of every REST endpoint.
 *
 * @remarks
 * String enum values intentionally mirror the Prisma enums in `apps/api/prisma/schema.prisma`.
 * Unless stated otherwise, `...At` fields are full ISO 8601 timestamps (UTC) and `from` / `to` / `date`
 * fields are UTC calendar days formatted `YYYY-MM-DD`. Ranges given by `from` and `to` are inclusive.
 */

/** Role of a signed-in {@link AuthUserDto}; it decides which part of the org tree the user can see. */
export const UserRole = {
  ADMIN: 'ADMIN',
  TRIBE_LEAD: 'TRIBE_LEAD',
  ENGINEERING_MANAGER: 'ENGINEERING_MANAGER',
} as const;
/** One of the {@link UserRole} values. */
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/** External platform an {@link IntegrationConnectionDto} talks to. */
export const IntegrationProvider = {
  JIRA: 'JIRA',
  AZURE_DEVOPS: 'AZURE_DEVOPS',
} as const;
/** One of the {@link IntegrationProvider} values. */
export type IntegrationProvider = (typeof IntegrationProvider)[keyof typeof IntegrationProvider];

/** Kind of data a provider can supply; listed in {@link ProviderDescriptorDto.capabilities}. */
export const IntegrationKind = {
  WORK_TRACKING: 'WORK_TRACKING',
  SOURCE_CONTROL: 'SOURCE_CONTROL',
  DEPLOYMENTS: 'DEPLOYMENTS',
} as const;
/** One of the {@link IntegrationKind} values. */
export type IntegrationKind = (typeof IntegrationKind)[keyof typeof IntegrationKind];

/** Lifecycle of a {@link SyncRunDto}: created `QUEUED`, then `RUNNING`, then `SUCCESS` or `FAILED`. */
export const SyncStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
/** One of the {@link SyncStatus} values. */
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

/** Human-readable label for each {@link UserRole}. */
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  TRIBE_LEAD: 'Tribe Lead',
  ENGINEERING_MANAGER: 'Engineering Manager',
};

/** Human-readable label for each {@link IntegrationProvider}. */
export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  JIRA: 'Jira',
  AZURE_DEVOPS: 'Azure DevOps',
};

/** Human-readable label for each {@link IntegrationKind}. */
export const KIND_LABELS: Record<IntegrationKind, string> = {
  WORK_TRACKING: 'Work tracking',
  SOURCE_CONTROL: 'Source control',
  DEPLOYMENTS: 'Deployments',
};

// ---------- Setup & auth ----------

/** First-launch state, returned by `GET /setup/status` (public). */
export interface SetupStatusDto {
  /** True while the built-in admin has no password yet; the web app then routes to `/setup`. */
  needsSetup: boolean;
  /** E-mail of the built-in admin awaiting setup; null once setup is complete. */
  adminEmail: string | null;
  /** When true, /setup/complete requires the one-time token printed in the API log. */
  tokenRequired: boolean;
}

/** Body of `POST /setup/complete`: claims the built-in admin account and signs it in. */
export interface CompleteSetupDto {
  /** New display name of the admin. */
  name: string;
  /** New login e-mail of the admin (stored lower-cased). */
  email: string;
  password: string;
  /** One-time token from the API log; required only when {@link SetupStatusDto.tokenRequired} is true. */
  setupToken?: string;
}

/** Body of `POST /auth/login`. */
export interface LoginDto {
  email: string;
  password: string;
}

/** The signed-in user as the API describes it to the client. */
export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /**
   * Id of the user this one reports to: a tribe lead for an engineering manager, the creating admin for a
   * tribe lead; null for admins.
   */
  reportsToId: string | null;
  /** Tribe name; only set for tribe leads, null otherwise or when none was given. */
  tribeName: string | null;
}

/** The refresh token travels in an httpOnly cookie, never in the body. */
export interface AuthResponseDto {
  /** Bearer token for the `Authorization` header. */
  accessToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: AuthUserDto;
}

/** Body of `POST /auth/change-password` for the signed-in user. */
export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

/** Body of `POST /auth/forgot-password`; the response is the same whether or not the e-mail exists. */
export interface ForgotPasswordDto {
  email: string;
}

/** Body of `POST /auth/reset-password`. */
export interface ResetPasswordDto {
  /** Raw one-time token from the `token` query parameter of the reset link. */
  token: string;
  /** The new password. */
  password: string;
}

/** A one-time password reset link that an admin or tribe lead created for a user they manage. */
export interface ResetLinkDto {
  /** Absolute URL of the web app's reset page, including the one-time token. */
  url: string;
  /** ISO timestamp after which the link no longer works (72 hours after creation). */
  expiresAt: string;
  /** True when the link was also e-mailed to the user. */
  emailed: boolean;
}

// ---------- Users (tribe leads / engineering managers) ----------

/** A user as listed by `/users`, with reporting line and head counts. */
export interface UserDto extends AuthUserDto {
  /** ISO timestamp. */
  createdAt: string;
  /** The user referenced by {@link AuthUserDto.reportsToId}, or null when there is none. */
  reportsTo?: { id: string; name: string } | null;
  /** Number of users reporting to this one and of members this user manages directly. */
  _count?: { reports: number; members: number };
}

/** Body for creating a tribe lead or engineering manager (admins cannot be created through the API). */
export interface CreateUserDto {
  /** Login e-mail, stored lower-cased; must be unique. */
  email: string;
  name: string;
  role: Exclude<UserRole, 'ADMIN'>;
  /** Initial password. */
  password: string;
  /**
   * Tribe lead an engineering manager reports to. Required when an admin creates an engineering manager;
   * a tribe lead's own managers always report to them, and tribe leads report to the creating admin.
   */
  reportsToId?: string;
  /** Only stored for tribe leads. */
  tribeName?: string;
}

/**
 * Partial update of a user. A new `password` also revokes the user's sessions; `reportsToId` applies only
 * to engineering managers and `tribeName` only to tribe leads.
 */
export type UpdateUserDto = Partial<Omit<CreateUserDto, 'role'>>;

// ---------- Members ----------

/** A member's account on one integration connection, used to attribute that platform's activity. */
export interface ExternalIdentityDto {
  id: string;
  connectionId: string;
  provider: IntegrationProvider;
  connectionName: string;
  /** Jira accountId (or username on Server/DC), or Azure DevOps uniqueName (usually an e-mail). */
  username: string;
  /** Name shown on the platform, when known. */
  displayName: string | null;
}

/** A tracked individual (not a login user), managed by an engineering manager. */
export interface MemberDto {
  id: string;
  name: string;
  email: string | null;
  /** Job title, free text. */
  title: string | null;
  /** Id of the engineering manager the member belongs to. */
  managerId: string;
  manager?: { id: string; name: string };
  /** Linked platform accounts, at most one per connection. */
  identities: ExternalIdentityDto[];
  /** ISO timestamp. */
  createdAt: string;
}

/** Body for creating a member; `managerId` must be an engineering manager within the caller's scope. */
export interface CreateMemberDto {
  name: string;
  email?: string;
  title?: string;
  managerId: string;
}

/** Partial update of a member; a new `managerId` must also be within the caller's scope. */
export type UpdateMemberDto = Partial<CreateMemberDto>;

/** Body of `PUT /members/:id/identities/:connectionId`: links or replaces the member's account there. */
export interface UpsertIdentityDto {
  /** Platform account id, as described on {@link ExternalIdentityDto.username}. */
  username: string;
  displayName?: string;
}

// ---------- Org tree ----------

/** A member leaf of the {@link OrgTreeDto}. */
export interface OrgTreeMember {
  id: string;
  name: string;
  title: string | null;
}
/** An engineering manager in the {@link OrgTreeDto} with their members. */
export interface OrgTreeManager {
  id: string;
  name: string;
  email: string;
  members: OrgTreeMember[];
}
/** A tribe lead in the {@link OrgTreeDto} with their engineering managers. */
export interface OrgTreeTribeLead {
  id: string;
  name: string;
  email: string;
  tribeName: string | null;
  managers: OrgTreeManager[];
}
/**
 * Tribe lead, engineering manager, member hierarchy returned by `GET /org/tree`, filtered to the caller's
 * scope: admins see everything, a tribe lead their own tribe, an engineering manager only their own team
 * (under their tribe lead). Every level is sorted by name.
 */
export interface OrgTreeDto {
  tribeLeads: OrgTreeTribeLead[];
}

// ---------- Integrations ----------

/** One provider-specific setting the integration form renders; its value is stored under `config[key]`. */
export interface ProviderConfigField {
  /** Key in {@link IntegrationConnectionDto.config}. */
  key: string;
  label: string;
  /** `list` values are string arrays (a comma-separated string is accepted too); `select` uses `options`. */
  type: 'text' | 'url' | 'select' | 'list';
  required?: boolean;
  placeholder?: string;
  /** Hint shown under the field. */
  help?: string;
  /** Choices for a `select` field. */
  options?: { value: string; label: string }[];
}

/** What a provider adapter supports and how to configure it; returned by `GET /integrations/providers`. */
export interface ProviderDescriptorDto {
  provider: IntegrationProvider;
  label: string;
  /** Kinds of data this provider can sync. */
  capabilities: IntegrationKind[];
  /** Provider-specific settings besides the base URL and the secret. */
  configFields: ProviderConfigField[];
  /** Form label of the secret (API token / personal access token). */
  secretLabel: string;
  /** Where to obtain the secret and which scopes it needs. */
  secretHelp?: string;
  /** What to enter as a member's {@link ExternalIdentityDto.username} for this provider. */
  identityHint: string;
  defaultBaseUrl?: string;
  /** Example base URL shown as a placeholder. */
  baseUrlHint: string;
  /** How to configure the platform to call Cadence's webhook URL. */
  webhookInstructions?: string;
}

/** A platform account found by `GET /integrations/:id/users`, for linking to a member. */
export interface ExternalUserDto {
  /** Value to store as {@link ExternalIdentityDto.username}. */
  username: string;
  displayName: string;
  email?: string;
  /** Provider-side immutable id, when the platform has one (e.g. an Azure DevOps identity GUID). */
  externalId?: string;
}

/** Webhook endpoint of a connection; the platform calls `url` to trigger an incremental sync. */
export interface WebhookInfoDto {
  /** Absolute URL of the connection's webhook endpoint on the API. */
  url: string;
  /** True when a webhook secret is stored, i.e. the endpoint accepts deliveries. */
  configured: boolean;
  /** Only returned right after (re)generating. */
  secret?: string;
}

/** A configured connection to an external platform. The secret itself is never returned. */
export interface IntegrationConnectionDto {
  id: string;
  name: string;
  provider: IntegrationProvider;
  /** Platform base URL without a trailing slash. */
  baseUrl: string;
  /** Non-secret provider settings keyed by {@link ProviderConfigField.key}. */
  config: Record<string, unknown>;
  /** Whether nightly syncs and webhook deliveries are processed; a manual sync runs regardless. */
  enabled: boolean;
  /**
   * Capabilities this connection syncs, a subset of its provider's
   * {@link ProviderDescriptorDto.capabilities}. Syncs leave the data of the other capabilities untouched.
   */
  features: IntegrationKind[];
  /** True when an encrypted credential is stored. */
  hasSecret: boolean;
  /** True when a webhook secret is stored; see {@link WebhookInfoDto}. */
  webhookConfigured: boolean;
  /** ISO timestamp. */
  createdAt: string;
  /** Most recently started sync run, or null when the connection has never synced. */
  lastSync?: SyncRunDto | null;
}

/** Body for creating a connection (admins only). */
export interface CreateIntegrationDto {
  name: string;
  provider: IntegrationProvider;
  /** Trailing slashes are stripped. */
  baseUrl: string;
  /** Provider settings keyed by {@link ProviderConfigField.key}; defaults to an empty object. */
  config?: Record<string, unknown>;
  /** API token or personal access token; stored encrypted. */
  secret: string;
  /** Defaults to true. */
  enabled?: boolean;
  /**
   * Capabilities to sync; at least one, all supported by the provider. Defaults to every capability the
   * provider supports.
   */
  features?: IntegrationKind[];
}

/** Partial update of a connection; an omitted or empty `secret` keeps the stored one. */
export type UpdateIntegrationDto = Partial<Omit<CreateIntegrationDto, 'provider'>> & {
  /**
   * Capabilities being turned off in this update whose collected data should be deleted. Turned-off
   * capabilities not listed here keep their history: it stays in dashboards but is no longer refreshed.
   */
  removeDataFor?: IntegrationKind[];
};

/** Result of `POST /integrations/:id/test`. */
export interface TestConnectionResultDto {
  ok: boolean;
  /** Details from the platform, typically the reason a failed test failed. */
  message?: string;
}

/** One sync of a connection over a date range. */
export interface SyncRunDto {
  id: string;
  connectionId: string;
  status: SyncStatus;
  /** ISO timestamp the run started executing; its creation time while still queued. */
  startedAt: string;
  /** ISO timestamp; null while the run is queued or running. */
  finishedAt: string | null;
  /** First synced day, `YYYY-MM-DD`. */
  rangeFrom: string;
  /** Last synced day (inclusive), `YYYY-MM-DD`. */
  rangeTo: string;
  /** Daily metric rows plus deployments written by the run. */
  recordsWritten: number;
  /** What started the run: `manual`, `schedule` or `webhook`. */
  trigger: string;
  /** Failure message; null unless the run failed. */
  error: string | null;
}

// ---------- Metrics ----------

/**
 * Activity totals for one UTC day. Counts come from synced platforms: commits and pull requests from source
 * control, issues, story points, cycle time and assignments from work tracking.
 */
export interface DailyMetricDto {
  date: string; // YYYY-MM-DD
  commits: number;
  /** Pull requests opened. */
  prsRaised: number;
  /** Pull requests by others the person voted or commented on; each counts at most once per day. */
  prsReviewed: number;
  /** Own pull requests completed (merged). */
  prsMerged: number;
  /** Work items resolved. */
  issuesCompleted: number;
  /** Story points of the resolved items, rounded to one decimal. */
  storyPoints: number;
  /**
   * Average hours from an item's first move into an in-progress status to its resolution, rounded to one
   * decimal; null when no resolved item had a measurable cycle time.
   */
  cycleTimeHoursAvg: number | null;
  /** Assignments that ended with a stage move (moved forward or Done). */
  assignmentsCompleted: number;
  /** Assignments that ended by reassignment without a stage move. */
  assignmentsHandedOver: number;
  /** Ended assignments by someone who had already held the same item (rework). */
  assignmentsReworked: number;
  /** Average calendar hours a completed assignment was held. */
  holdTimeHoursAvg: number | null;
}

/**
 * The {@link DailyMetricDto} figures summed over a window. Averages are recomputed from the underlying
 * samples (not averaged per day) and rounded to one decimal; they are null when there were no samples.
 *
 * @remarks
 * In group totals (summary `totals`, roll-up rows and trend) `issuesCompleted`, `storyPoints` and
 * `cycleTimeHoursAvg` count each work item once, even when several members held it; per-member figures
 * credit the item to every contributor.
 */
export interface MetricTotals {
  commits: number;
  prsRaised: number;
  prsReviewed: number;
  prsMerged: number;
  issuesCompleted: number;
  storyPoints: number;
  cycleTimeHoursAvg: number | null;
  /** Assignments that ended with a stage move (moved forward or Done). */
  assignmentsCompleted: number;
  /** Assignments that ended by reassignment without a stage move. */
  assignmentsHandedOver: number;
  /** Ended assignments by someone who had already held the same item (rework). */
  assignmentsReworked: number;
  /** Average calendar hours a completed assignment was held. */
  holdTimeHoursAvg: number | null;
}

/** One platform's contribution to a person's combined numbers. */
export interface MemberSourceTotals {
  connectionId: string;
  connectionName: string;
  provider: IntegrationProvider;
  /** The member's linked username on this connection; null when it is no longer linked (historical data). */
  username: string | null;
  totals: MetricTotals;
}

/** Combined (Jira + Azure DevOps) view of one individual. */
export interface MemberMetricsDto {
  memberId: string;
  /** First day of the window, `YYYY-MM-DD` (default: 29 days before `to`; at most 730 days before it). */
  from: string;
  /** Last day of the window (inclusive), `YYYY-MM-DD` (default: today, UTC). */
  to: string;
  totals: MetricTotals;
  /** Same-length window immediately before `from`, for trend deltas. */
  previous: MetricTotals;
  /** One entry per linked connection, even without activity, plus any connection with historical data. */
  sources: MemberSourceTotals[];
  /**
   * How long the member's own pull requests waited for their first review, over PRs first reviewed in the
   * window: median hours (one decimal; null without any), the PR count, and the median for the previous
   * window of the same length (null without any).
   */
  reviewWait: {
    hoursMedian: number | null;
    pullRequests: number;
    previousHoursMedian: number | null;
  };
  /** One entry per day of the window, oldest first, with zeros for days without activity. */
  days: DailyMetricDto[];
}

/** Per-member line of a {@link MetricsSummaryDto}. */
export interface MetricsSummaryRow {
  memberId: string;
  memberName: string;
  /** Name of the member's engineering manager. */
  managerName: string;
  totals: MetricTotals;
}

/**
 * Totals for every member in the caller's scope (optionally one manager's team), from
 * `GET /metrics/summary`.
 */
export interface MetricsSummaryDto {
  /** First day of the window, `YYYY-MM-DD`. */
  from: string;
  /** Last day of the window (inclusive), `YYYY-MM-DD`. */
  to: string;
  /** Scope-wide totals; work items are counted once (see {@link MetricTotals}). */
  totals: MetricTotals;
  /** Same-length window immediately before `from`. */
  previous: MetricTotals;
  /** One row per member, sorted by name, including members without activity. */
  rows: MetricsSummaryRow[];
}

/** A day of a metrics trend; same shape as {@link DailyMetricDto}. */
export interface MetricsTrendPoint extends DailyMetricDto {}

/** Grouping of a roll-up: one row per engineering manager's team or per tribe. */
export type RollupGroupBy = 'manager' | 'tribe';

/** One team or tribe in a {@link RollupDto}. */
export interface RollupRow {
  /**
   * Manager id, or tribe lead id for a tribe row (`unassigned` when the manager reports to no tribe lead).
   */
  id: string;
  /** Manager name, or tribe name (falling back to the tribe lead's name, then `Unassigned`). */
  name: string;
  /** Tribe name for a manager row; tribe lead name for a tribe row. */
  subtitle: string | null;
  /** Number of members in the group. */
  memberCount: number;
  /** Group totals; work items are counted once (see {@link MetricTotals}). */
  totals: MetricTotals;
}

/** Team or tribe roll-up of the caller's scope, from `GET /metrics/rollup`. */
export interface RollupDto {
  /** First day of the window, `YYYY-MM-DD`. */
  from: string;
  /** Last day of the window (inclusive), `YYYY-MM-DD`. */
  to: string;
  groupBy: RollupGroupBy;
  /** Sorted by name. */
  rows: RollupRow[];
  /** Per-day totals across the whole visible scope. */
  trend: DailyMetricDto[];
}

// ---------- DORA ----------

/** DORA performance band of a metric, following the State of DevOps clusters. */
export type DoraRating = 'ELITE' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Per-service line of a {@link DoraSummaryDto}. */
export interface DoraServiceRow {
  id: string;
  name: string;
  connectionName: string;
  /** Owning engineering manager; null when the service is not assigned to a team. */
  managerId: string | null;
  managerName: string | null;
  /** All production deployments in the window, failed ones included. */
  deployments: number;
  /** Failed deployments in the window. */
  failures: number;
  /** Median lead time in hours, rounded to one decimal; null when no deployment had one. */
  leadTimeHoursMedian: number | null;
}

/**
 * DORA metrics over the deployments of the services in the caller's scope (optionally one manager's), from
 * `GET /dora/summary`. Deployments are bucketed by the UTC day they finished.
 */
export interface DoraSummaryDto {
  /** First day of the window, `YYYY-MM-DD`. */
  from: string;
  /** Last day of the window (inclusive), `YYYY-MM-DD`. */
  to: string;
  /** All deployments in the window, failed ones included. */
  deployments: number;
  failedDeployments: number;
  /** Successful deployments per calendar day of the window, rounded to two decimals. */
  deploymentsPerDay: number;
  /** Fraction (0 to 1) of deployments that failed, rounded to three decimals; null without deployments. */
  changeFailureRate: number | null;
  /**
   * Median hours from the deployed commit's authoring time to the deployment finishing, over successful
   * deployments, rounded to one decimal; null when none had a lead time.
   */
  leadTimeHoursMedian: number | null;
  /**
   * Median time to restore in hours: per service, from the first failed deployment of an incident to the next
   * successful one. Rounded to one decimal; null when no failure was restored in the window.
   */
  mttrHours: number | null;
  /**
   * Median hours a pull request waited for its first review (a vote or comment by someone else), from being
   * opened, or published for drafts. Over PRs authored by people in scope (or the selected team) whose first
   * review fell in the window; rounded to one decimal; null when there were none. Not a DORA metric, so it
   * has no rating.
   */
  reviewWaitHoursMedian: number | null;
  /** Number of pull requests behind {@link DoraSummaryDto.reviewWaitHoursMedian}. */
  reviewedPullRequests: number;
  /** Rating of each metric; null when there is no data to rate. */
  ratings: {
    deploymentFrequency: DoraRating | null;
    leadTime: DoraRating | null;
    changeFailureRate: DoraRating | null;
    mttr: DoraRating | null;
  };
  /** One entry per day of the window, oldest first: all deployments and the failed ones. */
  daily: { date: string; deployments: number; failures: number }[];
  /** Every service in scope, sorted by name, including those without deployments. */
  services: DoraServiceRow[];
}

/**
 * A deployable unit (pipeline or repository) discovered from a CI/CD connection, from
 * `GET /dora/services`.
 */
export interface DeliveryServiceDto {
  id: string;
  name: string;
  connectionId: string;
  connectionName: string;
  provider: IntegrationProvider;
  /** Owning engineering manager; null when unassigned (only admins see unassigned services). */
  managerId: string | null;
  managerName: string | null;
  /** All deployments ever recorded for the service. */
  deploymentCount: number;
}

// ---------- Audit ----------

/** One entry of the append-only audit trail. */
export interface AuditLogDto {
  id: string;
  /** User who performed the action; null for unauthenticated actions or when that user was deleted. */
  actorId: string | null;
  /** Actor e-mail at the time of the action, kept after the user is deleted. */
  actorEmail: string | null;
  /** Dotted action name, e.g. `integration.created` or `user.reset_link_created`. */
  action: string;
  /** Kind of entity acted on, e.g. `user`, `integration` or `service`. */
  entityType: string;
  entityId: string | null;
  /** Action-specific details, e.g. the changed field names. */
  metadata: Record<string, unknown> | null;
  /** Client IP of the request, when known. */
  ip: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

/** A page of `GET /audit` (admins only), newest first. */
export interface AuditPageDto {
  items: AuditLogDto[];
  /** Pass as `cursor` to fetch the next page; null on the last page. */
  nextCursor: string | null;
}
