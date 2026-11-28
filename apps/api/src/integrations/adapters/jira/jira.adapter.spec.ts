import { JiraAdapter } from './jira.adapter';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('JiraAdapter.fetchWorkItemActivity', () => {
  const ctx = {
    baseUrl: 'https://cadence.atlassian.net',
    config: { deployment: 'cloud', email: 'bot@cadence.local', storyPointsField: 'customfield_10016' },
    secret: 'token',
  };
  const range = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-07T00:00:00Z') };
  let jql = '';

  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/rest/api/3/status')) {
        return json([
          { id: '1', statusCategory: { key: 'new' } },
          { id: '3', statusCategory: { key: 'indeterminate' } },
          { id: '5', statusCategory: { key: 'done' } },
        ]);
      }
      if (url.endsWith('/rest/api/3/search/jql')) {
        jql = JSON.parse(String(init?.body)).jql;
        return json({
          isLast: true,
          issues: [
            {
              key: 'CORE-1',
              fields: {
                assignee: { accountId: 'acc-1', displayName: 'Mariam' },
                resolutiondate: '2026-11-03T12:00:00.000+0000',
                created: '2026-11-02T09:00:00.000+0000',
                status: { id: '5' },
                customfield_10016: 5,
              },
              changelog: {
                histories: [
                  { created: '2026-11-02T12:00:00.000+0000', items: [{ field: 'status', to: '3' }] },
                  { created: '2026-11-03T12:00:00.000+0000', items: [{ field: 'status', to: '5' }] },
                ],
              },
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('builds JQL and maps resolved issues to story points, cycle time and assignments', async () => {
    const records = await new JiraAdapter().fetchWorkItemActivity(
      ctx,
      [{ memberId: 'mariam', username: 'acc-1' }],
      range,
    );
    expect(jql).toContain('assignee was in ("acc-1") AND statusCategory = Done');
    expect(jql).toContain('resolved >= "2026-11-01"');
    expect(jql).toContain('resolved < "2026-11-08"');
    expect(jql).toContain('assignee was in ("acc-1") during ("2026-11-01", "2026-11-08")');
    expect(records).toEqual([
      {
        memberId: 'mariam',
        date: '2026-11-03',
        workItemKey: 'CORE-1',
        issuesCompleted: 1,
        storyPoints: 5,
        cycleTimeHours: [24],
      },
      {
        memberId: 'mariam',
        date: '2026-11-03',
        assignmentsCompleted: 1,
        assignmentsHandedOver: 0,
        assignmentsReworked: 0,
        holdHours: [27],
      },
    ]);
  });

  it('credits a done ticket to everyone who held it', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/rest/api/3/status')) {
        return json([
          { id: '3', statusCategory: { key: 'indeterminate' } },
          { id: '4', statusCategory: { key: 'indeterminate' } },
          { id: '5', statusCategory: { key: 'done' } },
        ]);
      }
      if (url.endsWith('/rest/api/3/search/jql')) {
        return json({
          isLast: true,
          issues: [
            {
              key: 'CORE-3',
              fields: {
                assignee: { accountId: 'qa-outsider', displayName: 'QA' },
                resolutiondate: '2026-11-04T09:00:00.000+0000',
                created: '2026-11-02T09:00:00.000+0000',
                status: { id: '5' },
                customfield_10016: 3,
              },
              changelog: {
                histories: [
                  {
                    created: '2026-11-02T09:00:00.000+0000',
                    items: [
                      { field: 'status', from: '1', to: '3' },
                      { field: 'assignee', from: null, to: 'acc-1' },
                    ],
                  },
                  {
                    created: '2026-11-03T09:00:00.000+0000',
                    items: [
                      { field: 'status', from: '3', to: '4' },
                      { field: 'assignee', from: 'acc-1', to: 'acc-2' },
                    ],
                  },
                  {
                    created: '2026-11-03T15:00:00.000+0000',
                    items: [{ field: 'assignee', from: 'acc-2', to: 'qa-outsider' }],
                  },
                  { created: '2026-11-04T09:00:00.000+0000', items: [{ field: 'status', from: '4', to: '5' }] },
                ],
              },
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const records = await new JiraAdapter().fetchWorkItemActivity(
      ctx,
      [
        { memberId: 'mariam', username: 'acc-1' },
        { memberId: 'tarek', username: 'acc-2' },
      ],
      range,
    );
    const done = records.filter((r) => r.issuesCompleted);
    expect(done).toEqual([
      {
        memberId: 'mariam',
        date: '2026-11-04',
        workItemKey: 'CORE-3',
        issuesCompleted: 1,
        storyPoints: 3,
        cycleTimeHours: [48],
      },
      {
        memberId: 'tarek',
        date: '2026-11-04',
        workItemKey: 'CORE-3',
        issuesCompleted: 1,
        storyPoints: 3,
        cycleTimeHours: [48],
      },
    ]);
  });

  it('credits each person who held the ticket, even when the closer is not tracked', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/rest/api/3/status')) {
        return json([
          { id: '3', statusCategory: { key: 'indeterminate' } },
          { id: '4', statusCategory: { key: 'indeterminate' } },
          { id: '6', statusCategory: { key: 'indeterminate' } },
        ]);
      }
      if (url.endsWith('/rest/api/3/search/jql')) {
        return json({
          isLast: true,
          issues: [
            {
              key: 'CORE-2',
              fields: {
                assignee: { accountId: 'qa-outsider', displayName: 'QA' },
                resolutiondate: null,
                created: '2026-11-02T09:00:00.000+0000',
                status: { id: '6' },
              },
              changelog: {
                histories: [
                  {
                    created: '2026-11-03T09:00:00.000+0000',
                    items: [
                      { field: 'status', from: '3', to: '4' },
                      { field: 'assignee', from: 'acc-1', to: 'acc-2' },
                    ],
                  },
                  {
                    created: '2026-11-03T15:00:00.000+0000',
                    items: [
                      { field: 'status', from: '4', to: '6' },
                      { field: 'assignee', from: 'acc-2', to: 'qa-outsider' },
                    ],
                  },
                ],
              },
            },
          ],
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    const records = await new JiraAdapter().fetchWorkItemActivity(
      ctx,
      [
        { memberId: 'mariam', username: 'acc-1' },
        { memberId: 'tarek', username: 'acc-2' },
      ],
      range,
    );
    expect(records).toEqual([
      expect.objectContaining({ memberId: 'mariam', date: '2026-11-03', assignmentsCompleted: 1, holdHours: [24] }),
      expect.objectContaining({ memberId: 'tarek', date: '2026-11-03', assignmentsCompleted: 1, holdHours: [6] }),
    ]);
  });
});
