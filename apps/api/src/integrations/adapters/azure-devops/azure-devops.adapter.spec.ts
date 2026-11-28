import { Logger } from '@nestjs/common';
import { AzureDevOpsAdapter, draftPublishedAt } from './azure-devops.adapter';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('AzureDevOpsAdapter.fetchCodeActivity', () => {
  const ctx = { baseUrl: 'https://dev.azure.com/cadence', config: { projects: ['Core'] }, secret: 'pat' };
  const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') };
  const mariam = { memberId: 'mariam', username: 'Mariam@cadence.local' };
  const karim = { memberId: 'karim', username: 'karim@cadence.local' };

  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/_apis/git/repositories?')) return json({ value: [{ id: 'r1', name: 'api' }], count: 1 });
      if (url.includes('/repositories/r1/commits')) {
        return json({
          value: [
            { commitId: 'a', author: { email: 'mariam@cadence.local', date: '2026-11-01T09:00:00Z' } },
            { commitId: 'b', author: { email: 'mariam@cadence.local', date: '2026-11-01T15:00:00Z' } },
            { commitId: 'c', author: { email: 'stranger@cadence.local', date: '2026-11-01T15:00:00Z' } },
          ],
          count: 3,
        });
      }
      if (url.includes('queryTimeRangeType=created')) {
        return json({
          value: [
            {
              pullRequestId: 7,
              status: 'completed',
              createdBy: { id: '1', uniqueName: 'mariam@cadence.local' },
              creationDate: '2026-11-01T10:00:00Z',
              closedDate: '2026-11-02T10:00:00Z',
              repository: { id: 'r1' },
            },
          ],
          count: 1,
        });
      }
      if (url.includes('/git/pullrequests?')) return json({ value: [], count: 0 });
      if (url.includes('/pullRequests/7/threads')) {
        return json({
          value: [
            {
              properties: { CodeReviewThreadType: { $value: 'VoteUpdate' } },
              comments: [
                {
                  author: { id: '2', uniqueName: 'karim@cadence.local' },
                  publishedDate: '2026-11-02T08:00:00Z',
                  commentType: 'system',
                },
              ],
            },
            {
              comments: [
                {
                  author: { id: '2', uniqueName: 'karim@cadence.local' },
                  publishedDate: '2026-11-02T09:00:00Z',
                  commentType: 'text',
                },
                {
                  author: { id: '1', uniqueName: 'mariam@cadence.local' },
                  publishedDate: '2026-11-02T09:30:00Z',
                  commentType: 'text',
                },
              ],
            },
          ],
          count: 2,
        });
      }
      throw new Error(`unexpected ${url}`);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('counts commits, PRs raised/merged and distinct reviews per day', async () => {
    const records = await new AzureDevOpsAdapter().fetchCodeActivity(ctx, [mariam, karim], range);
    const sum = (member: string, key: 'commits' | 'prsRaised' | 'prsMerged' | 'prsReviewed') =>
      records.filter((r) => r.memberId === member).reduce((n, r) => n + (r[key] ?? 0), 0);
    expect(sum('mariam', 'commits')).toBe(2);
    expect(sum('mariam', 'prsRaised')).toBe(1);
    expect(sum('mariam', 'prsMerged')).toBe(1);
    expect(sum('mariam', 'prsReviewed')).toBe(0); // own PR comments are not reviews
    expect(sum('karim', 'prsReviewed')).toBe(1); // vote + comment same day = one review
  });
});

describe('AzureDevOpsAdapter review wait', () => {
  const ctx = { baseUrl: 'https://dev.azure.com/cadence', config: { projects: ['Core'] }, secret: 'pat' };
  const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-03T00:00:00Z') };
  const mariam = { memberId: 'mariam', username: 'mariam@cadence.local' };
  const karim = { memberId: 'karim', username: 'karim@cadence.local' };
  const pr = (id: number, over: Record<string, unknown> = {}) => ({
    pullRequestId: id,
    status: 'active',
    createdBy: { id: '1', uniqueName: 'mariam@cadence.local' },
    creationDate: '2026-11-01T08:00:00Z',
    repository: { id: 'r1' },
    ...over,
  });
  const comment = (who: string, at: string, commentType = 'text', content?: string) => ({
    author: { id: who, uniqueName: `${who}@cadence.local` },
    publishedDate: at,
    commentType,
    content,
  });
  let prs: ReturnType<typeof pr>[];
  let threads: Record<number, unknown[]>;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/_apis/git/repositories?')) return json({ value: [], count: 0 });
      if (url.includes('queryTimeRangeType=created')) return json({ value: prs, count: prs.length });
      if (url.includes('/git/pullrequests?')) return json({ value: [], count: 0 });
      const m = url.match(/pullRequests\/(\d+)\/threads/);
      if (m) return json({ value: threads[Number(m[1])] ?? [], count: 0 });
      throw new Error(`unexpected ${url}`);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const waits = async () =>
    (await new AzureDevOpsAdapter().fetchCodeActivity(ctx, [mariam, karim], range)).filter((r) => r.pullRequestKey);

  it('times a PR from creation to its first vote or comment by someone else', async () => {
    prs = [pr(1)];
    threads = {
      1: [
        { comments: [comment('mariam', '2026-11-01T09:00:00Z')] }, // the author's own comment doesn't count
        { comments: [comment('carl', '2026-11-01T13:30:00Z')] }, // reviewers needn't be tracked
        {
          properties: { CodeReviewThreadType: { $value: 'VoteUpdate' } },
          comments: [comment('karim', '2026-11-02T08:00:00Z', 'system')],
        },
      ],
    };
    expect(await waits()).toEqual([
      { memberId: 'mariam', date: '2026-11-01', pullRequestKey: 'r1-1', reviewWaitHours: 5.5 },
    ]);
  });

  it('times a published draft from its publish event', async () => {
    prs = [pr(2)];
    threads = {
      2: [
        {
          publishedDate: '2026-11-02T10:00:00Z',
          properties: { CodeReviewThreadType: { $value: 'IsDraftUpdate' }, CodeReviewIsDraft: { $value: 'False' } },
          comments: [comment('mariam', '2026-11-02T10:00:00Z', 'system')],
        },
        { comments: [comment('karim', '2026-11-02T12:00:00Z')] },
      ],
    };
    expect((await waits())[0]).toMatchObject({ pullRequestKey: 'r1-2', reviewWaitHours: 2 });
  });

  it('leaves out drafts, drafts with no known publish time, untracked authors and reviews outside the range', async () => {
    prs = [
      pr(3, { isDraft: true }),
      pr(4),
      pr(5, { createdBy: { id: '9', uniqueName: 'stranger@cadence.local' } }),
      pr(6),
      pr(7),
    ];
    const review = { comments: [comment('karim', '2026-11-02T12:00:00Z')] };
    threads = {
      3: [review],
      4: [
        {
          comments: [comment('mariam', '2026-11-01T09:00:00Z', 'system', 'Mariam marked the pull request as a draft')],
        },
        review,
      ],
      5: [review],
      6: [{ comments: [comment('karim', '2026-11-05T12:00:00Z')] }],
      7: [], // never reviewed
    };
    expect(await waits()).toEqual([]);
  });
});

describe('draftPublishedAt', () => {
  const sys = (at: string, content: string) => ({
    comments: [{ author: { id: '1' }, publishedDate: at, commentType: 'system', content }],
  });

  it('is undefined without draft history', () => {
    expect(draftPublishedAt([sys('2026-11-01T09:00:00Z', 'Mariam updated the description')])).toBeUndefined();
  });

  it('reads the latest publish from properties or system text', () => {
    expect(
      draftPublishedAt([
        sys('2026-11-01T09:00:00Z', 'Mariam published the pull request'),
        sys('2026-11-01T10:00:00Z', 'Mariam marked the pull request as a draft'),
        sys('2026-11-01T12:00:00Z', 'Mariam published the pull request'),
      ]),
    ).toBe('2026-11-01T12:00:00Z');
  });

  it('is null when the PR was a draft but no publish is recorded', () => {
    expect(draftPublishedAt([sys('2026-11-01T09:00:00Z', 'Mariam marked the pull request as a draft')])).toBeNull();
  });
});

describe('AzureDevOpsAdapter.fetchDeployments', () => {
  afterEach(() => vi.restoreAllMocks());

  it('treats deploy pipelines as production deployments with commit lead time', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/_apis/build/builds?')) {
        return json({
          value: [
            {
              id: 1,
              definition: { id: 1, name: 'api-deploy' },
              result: 'succeeded',
              startTime: '2026-11-01T10:00:00Z',
              finishTime: '2026-11-01T12:00:00Z',
              sourceVersion: 'abc',
              repository: { id: 'r1', type: 'TfsGit' },
            },
            {
              id: 2,
              definition: { id: 1, name: 'api-deploy' },
              result: 'failed',
              finishTime: '2026-11-02T12:00:00Z',
              sourceVersion: 'def',
              repository: { id: 'r1', type: 'TfsGit' },
            },
            { id: 3, definition: { id: 2, name: 'api-ci' }, result: 'succeeded', finishTime: '2026-11-02T12:00:00Z' },
            {
              id: 4,
              definition: { id: 1, name: 'api-deploy' },
              result: 'canceled',
              finishTime: '2026-11-02T13:00:00Z',
            },
          ],
          count: 4,
        });
      }
      if (url.includes('/commits/abc')) return json({ author: { date: '2026-11-01T00:00:00Z' } });
      throw new Error(`unexpected ${url}`);
    });
    const deps = await new AzureDevOpsAdapter().fetchDeployments(
      { baseUrl: 'https://dev.azure.com/cadence', config: { projects: ['Core'] }, secret: 'pat' },
      { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') },
    );
    expect(deps.map((d) => [d.externalId, d.status, d.leadTimeHours, d.service])).toEqual([
      ['1', 'SUCCESS', 12, 'Core/api-deploy'],
      ['2', 'FAILED', null, 'Core/api-deploy'],
    ]);
  });
});

describe('AzureDevOpsAdapter.fetchWorkItemActivity', () => {
  const base = 'https://dev.azure.com/cadence';
  const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-07T00:00:00Z') };
  const mariam = { memberId: 'mariam', username: 'Mariam@cadence.local' };
  const karim = { memberId: 'karim', username: 'karim@cadence.local' };
  const tarek = { memberId: 'tarek', username: 'tarek@cadence.local' };
  const who = (name: string) => ({ id: `id-${name}`, uniqueName: name, displayName: name });

  type Change = { state?: [string | null, string]; assignee?: [string | null, string | null] };
  /** One revision as returned by the updates API, changed at `at`. */
  const rev = (n: number, at: string, c: Change = {}) => ({
    id: n,
    rev: n,
    revisedDate: '9999-01-01T00:00:00Z', // sentinel: must not be used as the change time
    fields: {
      'System.ChangedDate': { ...(n > 1 ? { oldValue: '2000-01-01T00:00:00Z' } : {}), newValue: at },
      ...(c.state ? { 'System.State': { ...(c.state[0] ? { oldValue: c.state[0] } : {}), newValue: c.state[1] } } : {}),
      ...(c.assignee
        ? {
            'System.AssignedTo': {
              ...(c.assignee[0] ? { oldValue: who(c.assignee[0]) } : {}),
              ...(c.assignee[1] ? { newValue: who(c.assignee[1]) } : {}),
            },
          }
        : {}),
    },
  });

  interface Item {
    fields: Record<string, unknown>;
    updates: ReturnType<typeof rev>[];
  }

  /**
   * A Scrum-like project with renamed states: PBI New/Doing/Review/Shipped/Removed and Bug
   * New/Active/Resolved/Closed/Removed; categories also list a Task type, which must not be counted.
   */
  const categories = [
    { referenceName: 'Microsoft.RequirementCategory', workItemTypes: [{ name: 'Product Backlog Item' }] },
    { referenceName: 'Microsoft.BugCategory', workItemTypes: [{ name: 'Bug' }] },
    { referenceName: 'Microsoft.TaskCategory', workItemTypes: [{ name: 'Task' }] },
  ];
  const states: Record<string, { name: string; category: string }[]> = {
    'Product Backlog Item': [
      { name: 'New', category: 'Proposed' },
      { name: 'Doing', category: 'InProgress' },
      { name: 'Review', category: 'InProgress' },
      { name: 'Shipped', category: 'Completed' },
      { name: 'Removed', category: 'Removed' },
    ],
    Bug: [
      { name: 'New', category: 'Proposed' },
      { name: 'Active', category: 'InProgress' },
      { name: 'Resolved', category: 'Resolved' },
      { name: 'Closed', category: 'Completed' },
      { name: 'Removed', category: 'Removed' },
    ],
    Issue: [
      { name: 'To Do', category: 'Proposed' },
      { name: 'Doing', category: 'InProgress' },
      { name: 'Done', category: 'Completed' },
    ],
  };

  let urls: string[] = [];
  let queries: string[] = [];

  const serve = (items: Record<number, Item>, opts: { categories?: typeof categories } = {}) => {
    urls = [];
    queries = [];
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith(`${base}/Core/_apis/wit/workitemtypecategories?`))
        return json({ value: opts.categories ?? categories, count: 3 });
      const st = /\/Core\/_apis\/wit\/workitemtypes\/([^/]+)\/states\?/.exec(url);
      if (st) {
        const list = states[decodeURIComponent(st[1])];
        return list ? json({ value: list, count: list.length }) : new Response('not found', { status: 404 });
      }
      if (url.startsWith(`${base}/Core/_apis/wit/wiql?`)) {
        queries.push(JSON.parse(String(init?.body)).query);
        return json({ queryType: 'flat', workItems: Object.keys(items).map((id) => ({ id: Number(id) })) });
      }
      if (url.startsWith(`${base}/_apis/wit/workitemsbatch?`)) {
        const ids: number[] = JSON.parse(String(init?.body)).ids;
        return json({ value: ids.map((id) => ({ id, fields: items[id].fields })), count: ids.length });
      }
      const up = /\/Core\/_apis\/wit\/workItems\/(\d+)\/updates\?/.exec(url);
      if (up) {
        const q = new URL(url).searchParams;
        const top = Number(q.get('$top'));
        const skip = Number(q.get('$skip'));
        const page = items[Number(up[1])].updates.slice(skip, skip + top);
        return json({ value: page, count: page.length });
      }
      throw new Error(`unexpected ${url}`);
    });
  };
  afterEach(() => vi.restoreAllMocks());

  const ctx = (config: Record<string, unknown> = {}) => ({
    baseUrl: base,
    config: { projects: ['Core'], ...config },
    secret: 'pat',
  });
  const fetchActivity = (config?: Record<string, unknown>, identities = [mariam, karim, tarek], r = range) =>
    new AzureDevOpsAdapter().fetchWorkItemActivity(ctx(config), identities, r);

  /** PBI developed by Mariam, reviewed by Karim (current assignee, upper-case uniqueName), shipped on 11-04. */
  const pbi: Item = {
    fields: {
      'System.WorkItemType': 'Product Backlog Item',
      'System.TeamProject': 'Core',
      'System.State': 'Shipped',
      'System.AssignedTo': who('KARIM@cadence.local'),
      'System.CreatedDate': '2026-11-02T09:00:00Z',
      'Microsoft.VSTS.Scheduling.Effort': 5,
      'Custom.Points': 13,
    },
    updates: [
      rev(1, '2026-11-02T09:00:00Z', { state: [null, 'New'], assignee: [null, 'mariam@cadence.local'] }),
      rev(2, '2026-11-02T12:00:00Z', { state: ['New', 'Doing'] }),
      rev(3, '2026-11-03T15:00:00Z', {
        state: ['Doing', 'Review'],
        assignee: ['mariam@cadence.local', 'KARIM@cadence.local'],
      }),
      rev(4, '2026-11-04T09:00:00Z', { state: ['Review', 'Shipped'] }),
    ],
  };

  it('resolves types from the requirement and bug backlog categories and queries with time precision', async () => {
    serve({ 1: pbi });
    await fetchActivity();
    expect(urls.filter((u) => u.includes('/states?')).map((u) => decodeURIComponent(u.split('/')[8]))).toEqual([
      'Product Backlog Item',
      'Bug',
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("[System.WorkItemType] IN ('Product Backlog Item', 'Bug')");
    expect(queries[0]).toContain('[System.TeamProject] = @project');
    expect(queries[0]).toContain("[System.ChangedDate] >= '2026-11-01T00:00:00.000Z'");
    expect(urls.find((u) => u.includes('/wiql?'))).toContain('timePrecision=true');
  });

  it('credits a completed item to everyone who held it, with story points, cycle time and assignments', async () => {
    serve({ 1: pbi });
    expect(await fetchActivity()).toEqual([
      {
        memberId: 'karim',
        date: '2026-11-04',
        workItemKey: 'Core-1',
        issuesCompleted: 1,
        storyPoints: 5,
        cycleTimeHours: [45],
      },
      {
        memberId: 'mariam',
        date: '2026-11-04',
        workItemKey: 'Core-1',
        issuesCompleted: 1,
        storyPoints: 5,
        cycleTimeHours: [45],
      },
      {
        memberId: 'mariam',
        date: '2026-11-03',
        assignmentsCompleted: 1,
        assignmentsHandedOver: 0,
        assignmentsReworked: 0,
        holdHours: [30],
      },
      {
        memberId: 'karim',
        date: '2026-11-04',
        assignmentsCompleted: 1,
        assignmentsHandedOver: 0,
        assignmentsReworked: 0,
        holdHours: [18],
      },
    ]);
  });

  it('records hand-overs and rework from the updates', async () => {
    serve({
      7: {
        fields: { ...pbi.fields, 'System.State': 'Review', 'System.AssignedTo': who('mariam@cadence.local') },
        updates: [
          rev(1, '2026-11-02T09:00:00Z', { state: [null, 'Doing'], assignee: [null, 'mariam@cadence.local'] }),
          rev(2, '2026-11-03T09:00:00Z', { assignee: ['mariam@cadence.local', 'karim@cadence.local'] }), // Mariam off sick
          rev(3, '2026-11-04T09:00:00Z', {
            state: ['Doing', 'Review'],
            assignee: ['karim@cadence.local', 'mariam@cadence.local'],
          }),
          rev(4, '2026-11-05T09:00:00Z', { assignee: ['mariam@cadence.local', 'tarek@cadence.local'] }),
        ],
      },
    });
    const records = await fetchActivity();
    expect(records.some((r) => r.issuesCompleted)).toBe(false);
    expect(
      records.map((r) => [
        r.memberId,
        r.date,
        r.assignmentsCompleted,
        r.assignmentsHandedOver,
        r.assignmentsReworked,
        r.holdHours,
      ]),
    ).toEqual([
      ['mariam', '2026-11-03', 0, 1, 0, []],
      ['karim', '2026-11-04', 1, 0, 0, [24]],
      ['mariam', '2026-11-05', 0, 1, 1, []],
    ]);
  });

  it('falls back from Story Points to Effort to Size, and honours a configured field', async () => {
    const item = (fields: Record<string, unknown>): Item => ({ ...pbi, fields: { ...pbi.fields, ...fields } });
    const points = async (fields: Record<string, unknown>, config?: Record<string, unknown>) => {
      serve({ 1: item(fields) });
      return (await fetchActivity(config, [mariam])).find((r) => r.issuesCompleted)?.storyPoints;
    };
    expect(await points({ 'Microsoft.VSTS.Scheduling.StoryPoints': 8 })).toBe(8);
    expect(await points({})).toBe(5); // Effort
    expect(await points({ 'Microsoft.VSTS.Scheduling.Effort': undefined, 'Microsoft.VSTS.Scheduling.Size': 2 })).toBe(
      2,
    );
    expect(await points({ 'Microsoft.VSTS.Scheduling.Effort': undefined })).toBe(0);
    expect(await points({}, { storyPointsField: 'Custom.Points' })).toBe(13);
    expect(await points({}, { storyPointsField: 'Custom.Missing' })).toBe(0);
  });

  it('does not count Resolved or Removed items, nor items completed outside the range', async () => {
    serve({
      2: {
        fields: {
          'System.WorkItemType': 'Bug',
          'System.State': 'Resolved',
          'System.AssignedTo': who('mariam@cadence.local'),
        },
        updates: [
          rev(1, '2026-11-02T09:00:00Z', { state: [null, 'Active'], assignee: [null, 'mariam@cadence.local'] }),
          rev(2, '2026-11-03T09:00:00Z', { state: ['Active', 'Resolved'] }),
        ],
      },
      3: {
        fields: {
          'System.WorkItemType': 'Bug',
          'System.State': 'Removed',
          'System.AssignedTo': who('mariam@cadence.local'),
        },
        updates: [
          rev(1, '2026-11-02T09:00:00Z', { state: [null, 'Active'], assignee: [null, 'mariam@cadence.local'] }),
          rev(2, '2026-11-03T09:00:00Z', { state: ['Active', 'Removed'] }),
        ],
      },
      4: {
        fields: { ...pbi.fields, 'System.AssignedTo': who('mariam@cadence.local') },
        updates: [
          rev(1, '2026-10-20T09:00:00Z', { state: [null, 'Doing'], assignee: [null, 'mariam@cadence.local'] }),
          rev(2, '2026-10-21T09:00:00Z', { state: ['Doing', 'Shipped'] }),
          rev(3, '2026-11-02T09:00:00Z'), // a later comment brings it into the query
        ],
      },
      5: {
        fields: { ...pbi.fields, 'System.AssignedTo': who('mariam@cadence.local') },
        updates: [
          rev(1, '2026-11-06T09:00:00Z', { state: [null, 'Doing'], assignee: [null, 'mariam@cadence.local'] }),
          rev(2, '2026-11-08T09:00:00Z', { state: ['Doing', 'Shipped'] }), // after the range
        ],
      },
    });
    expect(await fetchActivity()).toEqual([]);
  });

  it('reads every page of a long update history', async () => {
    const noise = Array.from({ length: 247 }, (_, i) =>
      rev(i + 3, `2026-11-02T${String(10 + (i % 10)).padStart(2, '0')}:00:00Z`),
    );
    serve({
      9: {
        fields: { ...pbi.fields, 'System.AssignedTo': who('tarek@cadence.local') },
        updates: [
          rev(1, '2026-11-01T08:00:00Z', { state: [null, 'New'], assignee: [null, 'tarek@cadence.local'] }),
          rev(2, '2026-11-01T10:00:00Z', { state: ['New', 'Doing'] }),
          ...noise,
          rev(250, '2026-11-05T10:00:00Z', { state: ['Doing', 'Shipped'] }),
        ],
      },
    });
    const records = await fetchActivity();
    expect(urls.filter((u) => u.includes('/updates?')).map((u) => new URL(u).searchParams.get('$skip'))).toEqual([
      '0',
      '200',
    ]);
    expect(records.find((r) => r.issuesCompleted)).toMatchObject({
      memberId: 'tarek',
      date: '2026-11-05',
      cycleTimeHours: [96],
    });
  });

  it('works for the Basic process and splits long ranges into bounded WIQL windows', async () => {
    const issue: Item = {
      fields: {
        'System.WorkItemType': 'Issue',
        'System.State': 'Done',
        'System.AssignedTo': who('mariam@cadence.local'),
      },
      updates: [
        rev(1, '2026-11-02T09:00:00Z', { state: [null, 'To Do'], assignee: [null, 'mariam@cadence.local'] }),
        rev(2, '2026-11-09T09:00:00Z', { state: ['To Do', 'Done'] }),
      ],
    };
    serve(
      { 1: issue },
      { categories: [{ referenceName: 'Microsoft.RequirementCategory', workItemTypes: [{ name: 'Issue' }] }] },
    );
    const records = await fetchActivity({}, [mariam], { from: range.from, to: new Date('2026-11-10T00:00:00Z') });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain("[System.ChangedDate] < '2026-11-08T00:00:00.000Z'");
    expect(queries[1]).toContain("[System.ChangedDate] >= '2026-11-08T00:00:00.000Z'");
    expect(queries[1]).not.toContain('<');
    expect(urls.filter((u) => u.includes('/updates?'))).toHaveLength(1); // ids are de-duplicated
    expect(records.find((r) => r.issuesCompleted)).toMatchObject({
      workItemKey: 'Core-1',
      date: '2026-11-09',
      cycleTimeHours: [],
    });
  });

  it('uses configured work item types instead of the backlog categories, skipping unknown ones', async () => {
    serve({ 1: pbi });
    const records = await fetchActivity({ workItemTypes: ['Product Backlog Item', 'Epic'] });
    expect(urls.some((u) => u.includes('workitemtypecategories'))).toBe(false);
    expect(queries[0]).toContain("[System.WorkItemType] IN ('Product Backlog Item')");
    expect(records.filter((r) => r.issuesCompleted)).toHaveLength(2);
  });

  it('returns nothing without identities', async () => {
    serve({ 1: pbi });
    expect(await fetchActivity({}, [])).toEqual([]);
    expect(urls).toEqual([]);
  });
});

describe('AzureDevOpsAdapter.webhookDates', () => {
  const adapter = new AzureDevOpsAdapter();

  it('keeps the event day for code events', () => {
    expect(adapter.webhookDates({ eventType: 'git.push', createdDate: '2026-11-03T10:00:00Z' })).toEqual([
      '2026-11-03',
    ]);
    expect(adapter.webhookDates({})).toEqual([]);
  });

  it('adds the changed and closed days of work item updates, ignoring sentinel dates', () => {
    expect(
      adapter.webhookDates({
        eventType: 'workitem.updated',
        createdDate: '2026-11-05T08:00:00Z',
        resource: {
          revisedDate: '9999-01-01T00:00:00Z',
          fields: {
            'System.ChangedDate': { oldValue: '2026-11-01T10:00:00Z', newValue: '2026-11-04T23:59:00Z' },
            'Microsoft.VSTS.Common.ClosedDate': { newValue: '2026-11-04T23:59:00Z' },
          },
          revision: { fields: { 'System.ChangedDate': '2026-11-04T23:59:00Z' } },
        },
      }),
    ).toEqual(['2026-11-05', '2026-11-04']);
  });

  it('reads plain field values of created/deleted events', () => {
    expect(
      adapter.webhookDates({
        eventType: 'workitem.created',
        resource: { revisedDate: '0001-01-01T00:00:00', fields: { 'System.ChangedDate': '2026-11-02T09:00:00Z' } },
      }),
    ).toEqual(['2026-11-02']);
  });
});
