import { Injectable, Logger } from '@nestjs/common';
import type { ProviderDescriptorDto } from '@cadence/shared';
import { IntegrationProvider } from '../../../generated/prisma/enums';
import { httpJson, limiter, toDay } from '../../../common/http/http';
import {
  ActivityRecord,
  AdapterContext,
  DateRange,
  DeploymentRecord,
  DeploymentsAdapter,
  ExternalUser,
  IdentityRef,
  SourceControlAdapter,
  WorkTrackingAdapter,
  chunkRange,
  dayAfter,
  hoursBetween,
  listConfig,
  stringConfig,
  trimSlash,
} from '../adapter.types';
import { ItemChange, ItemFieldChange, buildAssignments } from '../assignments';

/** REST API version sent with every request. */
const API = 'api-version=7.1';

interface AdoList<T> {
  value: T[];
  count: number;
}
interface AdoIdentityRef {
  id: string;
  uniqueName?: string;
  displayName?: string;
}
interface AdoCommit {
  commitId: string;
  author: { email: string; date: string };
}
interface AdoPullRequest {
  pullRequestId: number;
  status: 'active' | 'abandoned' | 'completed';
  createdBy: AdoIdentityRef;
  creationDate: string;
  closedDate?: string;
  /** True while the PR is a draft (not yet ready for review). */
  isDraft?: boolean;
  repository: { id: string };
}
interface AdoBuild {
  id: number;
  definition: { id: number; name: string };
  result?: 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled' | 'none';
  startTime?: string;
  finishTime?: string;
  sourceVersion?: string;
  repository?: { id: string; type: string };
}
interface AdoThread {
  /** When the thread was created; for system threads, when the event happened. */
  publishedDate?: string;
  properties?: Record<string, { $value: string }>;
  comments: { author: AdoIdentityRef; publishedDate: string; commentType: string; content?: string }[];
}

/**
 * When a PR that started as a draft was published, from its activity threads; undefined when the threads
 * show no draft history, and null when they show the PR was a draft but not when it was published.
 *
 * @remarks
 * Azure DevOps has no documented field for this: a PR only has `creationDate` and its current `isDraft`. The
 * web UI's activity timeline is built from system threads, and draft changes appear there as threads whose
 * `CodeReviewThreadType` property mentions the draft state, or whose system comment says the PR was
 * published or marked as a draft. Those formats are undocumented, so this is best effort: callers leave out
 * PRs where the answer is null rather than time them from creation (which would count draft time as
 * waiting).
 */
export function draftPublishedAt(threads: AdoThread[]): string | null | undefined {
  let sawDraft = false;
  let published: string | undefined;
  for (const t of threads) {
    const type = t.properties?.['CodeReviewThreadType']?.$value ?? '';
    const isDraftValue = t.properties?.['CodeReviewIsDraft']?.$value;
    const system = t.comments.find((c) => c.commentType === 'system');
    const text = system?.content ?? '';
    const at = t.publishedDate ?? system?.publishedDate;
    const draftEvent = /draft/i.test(type) || /\bdraft\b|\bpublished\b/i.test(text);
    if (!draftEvent || !at) continue;
    sawDraft = true;
    const nowDraft =
      isDraftValue !== undefined ? isDraftValue.toLowerCase() === 'true' : /marked .*as (a )?draft/i.test(text);
    if (!nowDraft && (!published || at > published)) published = at;
  }
  if (!sawDraft) return undefined;
  return published ?? null;
}

/** A work item from `workitemsbatch`: field reference name → current value. */
interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
}
/** One revision from `workItems/{id}/updates`; `fields` holds only the fields this revision changed. */
interface AdoWorkItemUpdate {
  id: number;
  rev: number;
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
}
/** State categories of Azure Boards, shared by every process (Agile, Scrum, CMMI, Basic, inherited). */
type AdoStateCategory = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';
/** The work item part of a `workitem.*` service hook payload. */
interface AdoWorkItemHookResource {
  /** Plain values (`workitem.created`, `.deleted`, `.restored`) or deltas (`workitem.updated`). */
  fields?: Record<string, unknown>;
  /** The full revision after the change (`workitem.updated` only). */
  revision?: { fields?: Record<string, unknown> };
  /** End of the revision's validity; a 0001/9999 sentinel when not yet revised, so only used when sane. */
  revisedDate?: string;
}

/** Backlog categories whose work item types are counted when `workItemTypes` is not configured. */
const WORK_ITEM_CATEGORIES = ['Microsoft.RequirementCategory', 'Microsoft.BugCategory'];
/** Effort fields of the built-in processes (Agile, Scrum, CMMI), tried in order for story points. */
const STORY_POINT_FIELDS = [
  'Microsoft.VSTS.Scheduling.StoryPoints',
  'Microsoft.VSTS.Scheduling.Effort',
  'Microsoft.VSTS.Scheduling.Size',
];
/** WIQL returns at most this many work items per query. */
const WIQL_MAX = 20_000;
/** Days per WIQL query, keeping each result well below {@link WIQL_MAX}. */
const WIQL_WINDOW_DAYS = 7;
/** Maximum ids per `workitemsbatch` request. */
const BATCH_SIZE = 200;
/** Revisions per `updates` page. */
const UPDATES_PAGE = 200;

/**
 * Lower-cased `uniqueName` of an identity field value: an IdentityRef object (current API versions) or a
 * `Display Name <uniqueName>` string (older payloads). Null when empty.
 */
function identityKey(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return (/<([^<>]+)>\s*$/.exec(value)?.[1] ?? value).toLowerCase();
  const ref = value as AdoIdentityRef;
  const key = ref.uniqueName ?? ref.id ?? ref.displayName;
  return key ? key.toLowerCase() : null;
}

/** A scalar field value (state name, number, date) as a string, or null when absent, empty or an object. */
const text = (v: unknown) =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) || null : null;

/** Whether an ISO timestamp parses and is not one of Azure DevOps' 0001/9999 "no date" sentinels. */
const isRealDate = (d: unknown): d is string => {
  if (typeof d !== 'string') return false;
  const year = new Date(d).getUTCFullYear();
  return year >= 2000 && year < 9000;
};

/** Quotes a WIQL string literal. */
const wiqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Azure DevOps Services (dev.azure.com) and Azure DevOps Server.
 * Metrics per member/day: commits, PRs raised, PRs merged, PRs reviewed
 * (distinct PRs on which the member voted or commented, excluding their own), production deployments
 * from deployment pipelines, and Azure Boards work items (completed items, story points, cycle time and
 * assignments; see {@link AzureDevOpsAdapter.fetchWorkItemActivity}).
 *
 * Authenticates with a PAT over Basic auth. Identities are matched case-insensitively on `uniqueName` (or
 * the commit author e-mail). There is no native webhook signature: service hooks send the `X-Cadence-Token`
 * header.
 */
@Injectable()
export class AzureDevOpsAdapter implements WorkTrackingAdapter, SourceControlAdapter, DeploymentsAdapter {
  readonly provider = IntegrationProvider.AZURE_DEVOPS;
  private readonly logger = new Logger(AzureDevOpsAdapter.name);

  describe(): ProviderDescriptorDto {
    return {
      provider: 'AZURE_DEVOPS',
      label: 'Azure DevOps',
      capabilities: ['WORK_TRACKING', 'SOURCE_CONTROL', 'DEPLOYMENTS'],
      secretLabel: 'Personal access token',
      secretHelp:
        'User settings → Personal access tokens. Scopes: Work Items (Read), Code (Read), Build (Read), ' +
        'Identity (Read), Project & Team (Read).',
      identityHint: 'uniqueName — usually the user’s sign-in e-mail',
      baseUrlHint: 'https://dev.azure.com/your-org',
      webhookInstructions:
        'Project settings → Service hooks → Web Hooks. Events: Work item created/updated (covers completion), ' +
        'Code pushed, Pull request created/updated/merged, Build completed. URL: the Cadence webhook URL. ' +
        'HTTP headers: "X-Cadence-Token: <secret>".',
      configFields: [
        {
          key: 'projects',
          label: 'Projects (optional)',
          type: 'list',
          placeholder: 'Platform, Mobile',
          help: 'Leave empty to scan every project in the organisation.',
        },
        {
          key: 'workItemTypes',
          label: 'Work item types (optional)',
          type: 'list',
          placeholder: 'User Story, Bug',
          help:
            'Boards: which work item types count. Empty = the types on each project’s requirement and bug ' +
            'backlogs (e.g. User Story/PBI/Requirement/Issue and Bug), whatever the process.',
        },
        {
          key: 'storyPointsField',
          label: 'Story points field (optional)',
          type: 'text',
          placeholder: 'Custom.StoryPoints',
          help:
            'Boards: field reference name holding story points. Empty = the first of Story Points, Effort ' +
            'or Size that the item has.',
        },
        {
          key: 'deploymentPipelines',
          label: 'Deployment pipelines (optional)',
          type: 'list',
          placeholder: 'api-deploy, web-release',
          help: 'Pipeline names that deploy to production. Empty = pipelines whose name contains deploy/release/prod/cd.',
        },
        {
          key: 'deploymentEnvironment',
          label: 'Environment label',
          type: 'text',
          placeholder: 'production',
        },
      ],
    };
  }

  private headers(ctx: AdapterContext) {
    return { Authorization: `Basic ${Buffer.from(`:${ctx.secret}`).toString('base64')}` };
  }

  private get<T>(ctx: AdapterContext, url: string) {
    return httpJson<T>(url, { headers: this.headers(ctx) });
  }

  /** Identity API lives on vssps.dev.azure.com for Services, on the collection URL for Server. */
  private identityBase(ctx: AdapterContext) {
    const url = new URL(trimSlash(ctx.baseUrl));
    if (url.hostname === 'dev.azure.com') return `https://vssps.dev.azure.com${url.pathname}`;
    return trimSlash(ctx.baseUrl);
  }

  async testConnection(ctx: AdapterContext) {
    try {
      const res = await httpJson<AdoList<{ name: string }>>(
        `${trimSlash(ctx.baseUrl)}/_apis/projects?$top=100&${API}`,
        {
          headers: this.headers(ctx),
          retries: 0,
        },
      );
      return { ok: true, message: `Connected — ${res.count} project(s) visible` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async searchUsers(ctx: AdapterContext, query: string): Promise<ExternalUser[]> {
    const res = await this.get<
      AdoList<{ id: string; providerDisplayName: string; properties?: { Account?: { $value: string } } }>
    >(
      ctx,
      `${this.identityBase(ctx)}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(query)}&${API}`,
    );
    return res.value.map((i) => ({
      username: i.properties?.Account?.$value ?? i.providerDisplayName,
      displayName: i.providerDisplayName,
      externalId: i.id,
    }));
  }

  /** The configured projects, or every project in the organisation (up to 500) when none are configured. */
  private async projects(ctx: AdapterContext): Promise<string[]> {
    const configured = listConfig(ctx, 'projects');
    if (configured.length) return configured;
    const res = await this.get<AdoList<{ name: string }>>(
      ctx,
      `${trimSlash(ctx.baseUrl)}/_apis/projects?$top=500&${API}`,
    );
    return res.value.map((p) => p.name);
  }

  /** Fetches every page (500 per request) of a pull request search in one project. */
  private async pagedPullRequests(ctx: AdapterContext, project: string, query: string) {
    const out: AdoPullRequest[] = [];
    for (let skip = 0; ; skip += 500) {
      const page = await this.get<AdoList<AdoPullRequest>>(
        ctx,
        `${trimSlash(ctx.baseUrl)}/${encodeURIComponent(project)}/_apis/git/pullrequests?${query}&$top=500&$skip=${skip}&${API}`,
      );
      out.push(...page.value);
      if (page.value.length < 500) return out;
    }
  }

  /**
   * The service hook event's `createdDate` day, when present. For `workitem.*` events also the days the
   * item last changed and was closed (`System.ChangedDate`, `Microsoft.VSTS.Common.ClosedDate`, from the
   * resource's fields or revision) and the resource's `revisedDate` when it is a real date, so late or
   * delayed deliveries re-sync the right days.
   */
  webhookDates(body: unknown): string[] {
    const b = body as { eventType?: string; createdDate?: string; resource?: AdoWorkItemHookResource };
    const dates: unknown[] = [b.createdDate];
    const r = b.resource;
    if (b.eventType?.startsWith('workitem.') && r) {
      // `workitem.updated` sends deltas ({ oldValue, newValue }); the other events send plain values.
      const value = (fields: Record<string, unknown> | undefined, name: string) => {
        const v = fields?.[name];
        return v && typeof v === 'object' ? (v as { newValue?: unknown }).newValue : v;
      };
      for (const fields of [r.fields, r.revision?.fields])
        for (const name of ['System.ChangedDate', 'Microsoft.VSTS.Common.ClosedDate']) dates.push(value(fields, name));
      dates.push(r.revisedDate);
    }
    return [...new Set(dates.filter(isRealDate).map(toDay))];
  }

  /**
   * Work item types to count in one project: the configured `workItemTypes`, or else the types of the
   * project's requirement and bug backlog categories, which works for every process including custom ones.
   */
  private async workItemTypes(ctx: AdapterContext, project: string): Promise<string[]> {
    const configured = listConfig(ctx, 'workItemTypes');
    if (configured.length) return configured;
    const res = await this.get<AdoList<{ referenceName: string; workItemTypes?: { name: string }[] }>>(
      ctx,
      `${trimSlash(ctx.baseUrl)}/${encodeURIComponent(project)}/_apis/wit/workitemtypecategories?${API}`,
    );
    const types = res.value
      .filter((c) => WORK_ITEM_CATEGORIES.includes(c.referenceName))
      .flatMap((c) => (c.workItemTypes ?? []).map((t) => t.name));
    return [...new Set(types)];
  }

  /**
   * Work item type → (state name → state category) for the given types of one project. Types whose states
   * cannot be read (e.g. a configured type that does not exist in this project) are logged and left out.
   */
  private async stateCategories(ctx: AdapterContext, project: string, types: string[]) {
    const base = `${trimSlash(ctx.baseUrl)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes`;
    const out = new Map<string, Map<string, AdoStateCategory>>();
    for (const type of types) {
      const res = await this.get<AdoList<{ name: string; category: AdoStateCategory }>>(
        ctx,
        `${base}/${encodeURIComponent(type)}/states?${API}`,
      ).catch((e) => {
        this.logger.warn(`Skipping work item type ${project}/${type}: ${(e as Error).message}`);
        return null;
      });
      if (res) out.set(type, new Map(res.value.map((s) => [s.name, s.category])));
    }
    return out;
  }

  /**
   * Ids of the project's items of `types` changed on or after the range start, i.e. every item that can
   * have a completion or an ended assignment in the range. `System.ChangedDate` is the latest change, so it
   * has no upper bound; `Microsoft.VSTS.Common.ClosedDate` needs no separate clause (closing changes the
   * item). Queries use `timePrecision=true` (WIQL compares whole days otherwise) and are split into
   * {@link WIQL_WINDOW_DAYS}-day windows of `ChangedDate`, the last one open-ended, to stay under the
   * {@link WIQL_MAX}-item cap.
   */
  private async candidateIds(ctx: AdapterContext, project: string, types: string[], range: DateRange) {
    const url = `${trimSlash(ctx.baseUrl)}/${encodeURIComponent(project)}/_apis/wit/wiql?timePrecision=true&$top=${WIQL_MAX}&${API}`;
    const typeList = types.map(wiqlString).join(', ');
    const windows = chunkRange(range, WIQL_WINDOW_DAYS);
    const ids = new Set<number>();
    for (const [i, w] of windows.entries()) {
      const last = i === windows.length - 1;
      const query =
        `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project` +
        ` AND [System.WorkItemType] IN (${typeList})` +
        ` AND [System.ChangedDate] >= ${wiqlString(w.from.toISOString())}` +
        (last ? '' : ` AND [System.ChangedDate] < ${wiqlString(dayAfter(w.to).toISOString())}`);
      const res = await httpJson<{ workItems: { id: number }[] }>(url, {
        method: 'POST',
        headers: this.headers(ctx),
        body: { query },
      });
      if (res.workItems.length >= WIQL_MAX)
        this.logger.warn(`WIQL result for ${project} hit the ${WIQL_MAX}-item cap; some work items may be missed`);
      for (const w of res.workItems) ids.add(w.id);
    }
    return [...ids];
  }

  /** Current fields of the given work items, {@link BATCH_SIZE} per request; inaccessible items are omitted. */
  private async workItemDetails(ctx: AdapterContext, ids: number[]): Promise<AdoWorkItem[]> {
    const out: AdoWorkItem[] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const res = await httpJson<AdoList<AdoWorkItem | null>>(
        `${trimSlash(ctx.baseUrl)}/_apis/wit/workitemsbatch?${API}`,
        {
          method: 'POST',
          headers: this.headers(ctx),
          body: { ids: ids.slice(i, i + BATCH_SIZE), errorPolicy: 'omit' },
        },
      );
      out.push(...res.value.filter((w): w is AdoWorkItem => !!w));
    }
    return out;
  }

  /** Every revision of a work item, oldest first, following `$top`/`$skip` pages. */
  private async workItemUpdates(ctx: AdapterContext, project: string, id: number) {
    const out: AdoWorkItemUpdate[] = [];
    for (let skip = 0; ; skip += UPDATES_PAGE) {
      const page = await this.get<AdoList<AdoWorkItemUpdate>>(
        ctx,
        `${trimSlash(ctx.baseUrl)}/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/updates?$top=${UPDATES_PAGE}&$skip=${skip}&${API}`,
      );
      out.push(...page.value);
      if (page.value.length < UPDATES_PAGE) return out.sort((a, b) => a.rev - b.rev);
    }
  }

  /**
   * Azure Boards work items, mirroring the Jira adapter's semantics. Per project, the counted types (see
   * `workItemTypes`) are queried for items changed since the range start, then each item's history is
   * replayed from its updates. Emits:
   *  - one `issuesCompleted` record per credited member, dated on the item's completion day, for items whose
   *    current state is in the **Completed** category and whose last move into that category was in the
   *    range; the current assignee and everyone with a recorded assignment are credited. `workItemKey` is
   *    `<project>-<id>` (ids are unique in the organisation; the project prefix is for readability). Story
   *    points come from `storyPointsField`, or else the first present of Story Points, Effort and Size.
   *    Cycle time runs from the first move into an **InProgress**-category state (including creation in
   *    one) to completion;
   *  - one assignment record per finished assignment of a tracked member that ended in the range, built
   *    with {@link buildAssignments} where Completed and Removed states end an item's active life.
   *
   * @remarks
   * Done-ness uses state categories, not state names, so renamed or custom states work. **Resolved** counts
   * as not done (it usually means "fixed, awaiting verification"); moving into it is an ordinary stage move.
   * **Removed** items are never credited, and the assignment that ends with the removal is not reported
   * (the work was abandoned); assignments that ended earlier still are. Assignees are matched on their
   * `uniqueName`, case-insensitively.
   *
   * Cost: one `updates` request (more when paged) per counted item changed since the range start, 4 at a
   * time, whether or not a tracked person touched it. The WIQL query is deliberately not filtered by person
   * (`[System.AssignedTo] EVER '…'`): one linked identity unknown to Azure DevOps makes the whole query
   * fail. Nightly and webhook syncs stay small; long backfills of busy projects are slow. See "Limitation:
   * long Boards backfills are slow" in docs/guide/azure-devops.md.
   */
  async fetchWorkItemActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange) {
    if (!identities.length) return [];
    const byName = new Map(identities.map((i) => [i.username.toLowerCase(), i.memberId]));
    const memberOf = (key: string | null) => (key ? byName.get(key) : undefined);
    const spOverride = stringConfig(ctx, 'storyPointsField');
    const spFields = spOverride ? [spOverride] : STORY_POINT_FIELDS;
    const from = toDay(range.from);
    const to = toDay(range.to);
    const inRange = (d: Date | string) => toDay(d) >= from && toDay(d) <= to;
    const limit = limiter(4);
    const out: ActivityRecord[] = [];

    for (const project of await this.projects(ctx)) {
      const states = await this.stateCategories(ctx, project, await this.workItemTypes(ctx, project));
      if (!states.size) continue;
      // A state of a type the item no longer has (type changed) is looked up across all types.
      const anyType = new Map([...states.values()].flatMap((m) => [...m]));
      const ids = await this.candidateIds(ctx, project, [...states.keys()], range);
      const items = await this.workItemDetails(ctx, ids);

      const perItem = await Promise.all(
        items.map((item) =>
          limit(async () => {
            const typeStates = states.get(String(item.fields['System.WorkItemType']));
            const category = (state: string | null) =>
              state ? (typeStates?.get(state) ?? anyType.get(state)) : undefined;
            const updates = await this.workItemUpdates(ctx, project, item.id);
            return this.itemActivity(item, updates, { category, memberOf, spFields, inRange, project });
          }),
        ),
      );
      out.push(...perItem.flat());
    }
    return out;
  }

  /** Records for one work item, following the rules of {@link AzureDevOpsAdapter.fetchWorkItemActivity}. */
  private itemActivity(
    item: AdoWorkItem,
    updates: AdoWorkItemUpdate[],
    opts: {
      category: (state: string | null) => AdoStateCategory | undefined;
      memberOf: (key: string | null) => string | undefined;
      spFields: string[];
      inRange: (d: Date | string) => boolean;
      project: string;
    },
  ): ActivityRecord[] {
    const { category, memberOf } = opts;
    const changes: ItemChange[] = [];
    let startedAt: string | undefined;
    let completedAt: string | undefined;
    const removedAt = new Set<number>();

    for (const u of updates) {
      const changedAt = u.fields?.['System.ChangedDate']?.newValue;
      if (!u.fields || !isRealDate(changedAt)) continue;
      const fields: ItemFieldChange[] = [];
      const state = u.fields['System.State'];
      if (state && state.newValue !== undefined) {
        const prev = text(state.oldValue);
        const next = text(state.newValue);
        fields.push({ field: 'status', from: prev, to: next });
        const cat = category(next);
        if (cat === 'InProgress' && !startedAt) startedAt = changedAt;
        if (cat === 'Completed' && category(prev) !== 'Completed') completedAt = changedAt;
        if (cat === 'Removed') removedAt.add(new Date(changedAt).getTime());
      }
      const assignee = u.fields['System.AssignedTo'];
      if (assignee)
        fields.push({ field: 'assignee', from: identityKey(assignee.oldValue), to: identityKey(assignee.newValue) });
      if (fields.length) changes.push({ at: changedAt, fields });
    }

    const f = item.fields;
    const currentAssignee = identityKey(f['System.AssignedTo']);
    const currentState = text(f['System.State']);
    const created = isRealDate(f['System.CreatedDate'])
      ? f['System.CreatedDate']
      : (changes[0]?.at ?? new Date().toISOString());
    const assignments = buildAssignments({
      created,
      currentAssignee,
      currentStatus: currentState,
      changes,
      isDone: (s) => category(s) === 'Completed' || category(s) === 'Removed',
    }).filter((a) => !removedAt.has(a.end.getTime()));

    const out: ActivityRecord[] = [];
    const closedField = f['Microsoft.VSTS.Common.ClosedDate'];
    const completed = completedAt ?? (isRealDate(closedField) ? closedField : undefined);
    if (category(currentState) === 'Completed' && completed && opts.inRange(completed)) {
      const contributors = new Set(
        [memberOf(currentAssignee), ...assignments.map((a) => memberOf(a.assignee))].filter((m): m is string => !!m),
      );
      const cycle = startedAt ? hoursBetween(startedAt, completed) : undefined;
      const rawSp = opts.spFields.map((name) => f[name]).find((v) => text(v) !== null);
      const sp = Number(rawSp ?? 0);
      const project = text(f['System.TeamProject']) ?? opts.project;
      for (const memberId of contributors) {
        out.push({
          memberId,
          date: toDay(completed),
          workItemKey: `${project}-${item.id}`,
          issuesCompleted: 1,
          storyPoints: Number.isFinite(sp) ? sp : 0,
          cycleTimeHours: cycle !== undefined && cycle >= 0 ? [cycle] : [],
        });
      }
    }

    for (const a of assignments) {
      const memberId = memberOf(a.assignee);
      if (!memberId || !opts.inRange(a.end)) continue;
      const done = a.outcome === 'completed';
      out.push({
        memberId,
        date: toDay(a.end),
        assignmentsCompleted: done ? 1 : 0,
        assignmentsHandedOver: done ? 0 : 1,
        assignmentsReworked: a.rework ? 1 : 0,
        holdHours: done ? [a.hours] : [],
      });
    }
    return out;
  }

  /**
   * Production deployments = completed runs of deployment pipelines. Lead time is measured from the
   * author date of the built commit (Azure Repos only) to the run's finish time.
   *
   * Deployment pipelines are the configured `deploymentPipelines` (by name, case-insensitive), or else any
   * pipeline whose name matches deploy/release/prod/cd. Succeeded and partially succeeded runs count as
   * SUCCESS, failed runs as FAILED; other results are ignored. Each pipeline is reported as the service
   * `<project>/<pipeline name>`, and failed runs get no lead time.
   */
  async fetchDeployments(ctx: AdapterContext, range: DateRange): Promise<DeploymentRecord[]> {
    const base = trimSlash(ctx.baseUrl);
    const wanted = new Set(listConfig(ctx, 'deploymentPipelines').map((n) => n.toLowerCase()));
    const isDeployPipeline = (name: string) =>
      wanted.size ? wanted.has(name.toLowerCase()) : /deploy|release|prod|\bcd\b/i.test(name);
    const environment = stringConfig(ctx, 'deploymentEnvironment', 'production');
    const limit = limiter(4);
    const out: DeploymentRecord[] = [];

    for (const project of await this.projects(ctx)) {
      const p = encodeURIComponent(project);
      const builds = await this.get<AdoList<AdoBuild>>(
        ctx,
        `${base}/${p}/_apis/build/builds?minTime=${range.from.toISOString()}&maxTime=${dayAfter(range.to).toISOString()}` +
          `&statusFilter=completed&queryOrder=finishTimeAscending&$top=5000&${API}`,
      );
      const relevant = builds.value.filter(
        (b) =>
          b.finishTime &&
          isDeployPipeline(b.definition.name) &&
          (b.result === 'succeeded' || b.result === 'partiallySucceeded' || b.result === 'failed'),
      );
      await Promise.all(
        relevant.map((b) =>
          limit(async () => {
            let leadTimeHours: number | null = null;
            if (b.sourceVersion && b.repository?.type === 'TfsGit' && b.result !== 'failed') {
              const commit = await this.get<{ author: { date: string } }>(
                ctx,
                `${base}/${p}/_apis/git/repositories/${b.repository.id}/commits/${b.sourceVersion}?${API}`,
              ).catch(() => null);
              if (commit) leadTimeHours = Math.max(0, hoursBetween(commit.author.date, b.finishTime!));
            }
            out.push({
              externalId: String(b.id),
              service: `${project}/${b.definition.name}`,
              environment,
              status: b.result === 'failed' ? 'FAILED' : 'SUCCESS',
              startedAt: b.startTime ?? null,
              finishedAt: b.finishTime!,
              leadTimeHours,
            });
          }),
        ),
      );
    }
    return out.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  }

  /**
   * Emits one record per commit (by author date), PR raised (by creation date), PR merged (completed, by
   * close date) and PR reviewed (at most once per PR, reviewer and day). Repositories whose commits cannot
   * be read are logged and skipped.
   *
   * Also emits one review-wait record per PR of a tracked author whose first review (a vote or a human
   * comment by someone else) fell in the range: `pullRequestKey` is `<repository id>-<pull request id>` and
   * `reviewWaitHours` runs from the PR being opened, or from its publish time when it started as a draft (see
   * {@link draftPublishedAt}). PRs that are still drafts, or that started as drafts with no known publish
   * time, are left out.
   */
  async fetchCodeActivity(ctx: AdapterContext, identities: IdentityRef[], range: DateRange) {
    if (!identities.length) return [];
    const base = trimSlash(ctx.baseUrl);
    const byName = new Map(identities.map((i) => [i.username.toLowerCase(), i.memberId]));
    const match = (ref?: { uniqueName?: string; email?: string }) =>
      byName.get((ref?.uniqueName ?? ref?.email ?? '').toLowerCase());
    const fromIso = range.from.toISOString();
    const toIso = dayAfter(range.to).toISOString();
    const inRange = (d?: string) => !!d && d >= fromIso && d < toIso;
    const limit = limiter(4);
    const out: ActivityRecord[] = [];

    for (const project of await this.projects(ctx)) {
      const p = encodeURIComponent(project);

      // ---- Commits (per repository, then matched by author e-mail) ----
      const repos = await this.get<AdoList<{ id: string; name: string; isDisabled?: boolean }>>(
        ctx,
        `${base}/${p}/_apis/git/repositories?${API}`,
      );
      await Promise.all(
        repos.value
          .filter((r) => !r.isDisabled)
          .map((repo) =>
            limit(async () => {
              for (let skip = 0; ; skip += 1000) {
                const page = await this.get<AdoList<AdoCommit>>(
                  ctx,
                  `${base}/${p}/_apis/git/repositories/${repo.id}/commits?searchCriteria.fromDate=${fromIso}` +
                    `&searchCriteria.toDate=${toIso}&searchCriteria.$top=1000&searchCriteria.$skip=${skip}&${API}`,
                ).catch((e) => {
                  this.logger.warn(`Skipping repo ${repo.name}: ${(e as Error).message}`);
                  return { value: [], count: 0 };
                });
                for (const c of page.value) {
                  const memberId = match(c.author);
                  if (memberId && inRange(c.author.date))
                    out.push({ memberId, date: toDay(c.author.date), commits: 1 });
                }
                if (page.value.length < 1000) break;
              }
            }),
          ),
      );

      // ---- Pull requests: created in range, closed in range, and still active ----
      const timeQ = (type: string) =>
        `searchCriteria.status=all&searchCriteria.queryTimeRangeType=${type}` +
        `&searchCriteria.minTime=${fromIso}&searchCriteria.maxTime=${toIso}`;
      const [created, closed, active] = await Promise.all([
        this.pagedPullRequests(ctx, project, timeQ('created')),
        this.pagedPullRequests(ctx, project, timeQ('closed')),
        this.pagedPullRequests(ctx, project, 'searchCriteria.status=active'),
      ]);
      const prs = new Map<number, AdoPullRequest>();
      for (const pr of [...created, ...closed, ...active]) prs.set(pr.pullRequestId, pr);

      for (const pr of prs.values()) {
        const author = match(pr.createdBy);
        if (author && inRange(pr.creationDate))
          out.push({ memberId: author, date: toDay(pr.creationDate), prsRaised: 1 });
        if (author && pr.status === 'completed' && inRange(pr.closedDate)) {
          out.push({ memberId: author, date: toDay(pr.closedDate!), prsMerged: 1 });
        }
      }

      // ---- Reviews: votes + human comments in range by someone other than the author ----
      await Promise.all(
        [...prs.values()].map((pr) =>
          limit(async () => {
            const threads = await this.get<AdoList<AdoThread>>(
              ctx,
              `${base}/${p}/_apis/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}/threads?${API}`,
            ).catch(() => ({ value: [], count: 0 }));
            const seen = new Set<string>(); // memberId|day → count each PR once per reviewer per day
            let firstReview: string | undefined;
            for (const t of threads.value) {
              const isVote = t.properties?.['CodeReviewThreadType']?.$value === 'VoteUpdate';
              for (const c of t.comments) {
                if (!isVote && c.commentType !== 'text') continue;
                const byOther = c.author.uniqueName?.toLowerCase() !== pr.createdBy.uniqueName?.toLowerCase();
                if (byOther && c.publishedDate && (!firstReview || c.publishedDate < firstReview))
                  firstReview = c.publishedDate;
                const reviewer = match(c.author);
                if (!reviewer || !byOther || !inRange(c.publishedDate)) continue;
                const key = `${reviewer}|${toDay(c.publishedDate)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ memberId: reviewer, date: toDay(c.publishedDate), prsReviewed: 1 });
              }
            }
            const author = match(pr.createdBy);
            if (author && firstReview && inRange(firstReview) && !pr.isDraft) {
              const published = draftPublishedAt(threads.value);
              const start = published === undefined ? pr.creationDate : published;
              if (start !== null) {
                out.push({
                  memberId: author,
                  date: toDay(firstReview),
                  pullRequestKey: `${pr.repository.id}-${pr.pullRequestId}`,
                  reviewWaitHours: Math.max(0, hoursBetween(start, firstReview)),
                });
              }
            }
          }),
        ),
      );
    }
    return out;
  }
}
