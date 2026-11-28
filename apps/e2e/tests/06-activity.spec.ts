import { Page, expect, test } from '@playwright/test';
import pg from 'pg';
import { ADMIN, DATABASE_URL, EM, TL, login, nav } from './helpers';

/**
 * Activity normally arrives through Jira / Azure DevOps syncs, which can't reach real platforms here.
 * Seed the same rows a sync would write, on the connections created by earlier specs.
 *
 * 30-day window (previous window = 30–59 days ago):
 *   Mina   ADO: 10 commits, 3 PRs raised / 3 merged, 4 reviews (+5 commits, 1 merge 40 days ago)
 *          Jira: KEY-1 (3 pts, 10 h) and KEY-2 (2 pts, 20 h, shared with Bassam)
 *   Bassam ADO: 3 commits, 1 raised / 1 merged, 2 reviews · Jira: KEY-2
 *   Omar   ADO: 1 commit
 *   Retail/storefront-deploy (unassigned): 3 successful deploys (lead 10/20/30 h), 1 failure restored after 4 h
 */
const SERVICE = 'Retail/storefront-deploy';
const DAY = 864e5;
const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
const day = (n: number) => new Date(today - n * DAY).toISOString().slice(0, 10);
const at = (n: number, hour: number) => new Date(today - n * DAY + hour * 36e5);

async function seed() {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const one = async (sql: string, params: unknown[]) =>
      (await db.query<{ id: string }>(sql, params)).rows[0].id;
    const member = (name: string) => one('SELECT id FROM "Member" WHERE name = $1', [name]);
    const connection = (name: string) =>
      one('SELECT id FROM "IntegrationConnection" WHERE name = $1', [name]);
    // One client runs one query at a time.
    const mina = await member('Mina Samir');
    const bassam = await member('Bassam Adel');
    const omar = await member('Omar Elshamy');
    const ado = await connection('Azure DevOps');
    const jira = await connection('Jira Cloud');

    const metrics: [string, string, string, Record<string, number>][] = [
      [mina, ado, day(2), { commits: 6, prsRaised: 2, prsMerged: 2, prsReviewed: 3 }],
      [mina, ado, day(10), { commits: 4, prsRaised: 1, prsMerged: 1, prsReviewed: 1 }],
      [mina, ado, day(40), { commits: 5, prsMerged: 1 }],
      [bassam, ado, day(3), { commits: 3, prsRaised: 1, prsMerged: 1, prsReviewed: 2 }],
      [omar, ado, day(4), { commits: 1 }],
      [
        mina,
        jira,
        day(2),
        { issuesCompleted: 2, storyPoints: 5, cycleTimeHoursSum: 30, cycleTimeSamples: 2 },
      ],
      [
        bassam,
        jira,
        day(2),
        { issuesCompleted: 1, storyPoints: 2, cycleTimeHoursSum: 20, cycleTimeSamples: 1 },
      ],
    ];
    for (const [i, [memberId, connectionId, date, values]] of metrics.entries()) {
      const cols = Object.keys(values);
      await db.query(
        `INSERT INTO "DailyMetric" (id, "memberId", "connectionId", date, "updatedAt", ${cols
          .map((c) => `"${c}"`)
          .join(', ')})
         VALUES ($1, $2, $3, $4, now(), ${cols.map((_, j) => `$${j + 5}`).join(', ')})
         ON CONFLICT DO NOTHING`,
        [`e2e-dm-${i}`, memberId, connectionId, date, ...Object.values(values)],
      );
    }

    const items: [string, number, number, string[]][] = [
      ['KEY-1', 3, 10, [mina]],
      ['KEY-2', 2, 20, [mina, bassam]],
    ];
    for (const [key, points, cycle, contributors] of items) {
      await db.query(
        `INSERT INTO "WorkItem" (id, "connectionId", key, date, "storyPoints", "cycleTimeHours")
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [`e2e-${key}`, jira, key, day(2), points, cycle],
      );
      for (const memberId of contributors) {
        await db.query(
          `INSERT INTO "WorkItemContributor" ("workItemId", "memberId") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [`e2e-${key}`, memberId],
        );
      }
    }

    // Review waits: Mina 2h and 6h this period, 9h in the previous one; Bassam 30h.
    const waits: [string, string, number][] = [
      [mina, day(2), 2],
      [mina, day(10), 6],
      [mina, day(40), 9],
      [bassam, day(3), 30],
    ];
    for (const [i, [memberId, date, waitHours]] of waits.entries()) {
      await db.query(
        `INSERT INTO "ReviewedPullRequest" (id, "connectionId", key, "memberId", date, "waitHours")
         VALUES ($1, $2, $1, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [`e2e-pr-${i}`, ado, memberId, date, waitHours],
      );
    }

    await db.query(
      `INSERT INTO "DeliveryService" (id, "connectionId", name) VALUES ('e2e-svc', $1, $2) ON CONFLICT DO NOTHING`,
      [ado, SERVICE],
    );
    const deploys: [string, Date, number | null][] = [
      ['SUCCESS', at(5, 10), 10],
      ['FAILED', at(3, 9), null],
      ['SUCCESS', at(3, 13), 20],
      ['SUCCESS', at(1, 12), 30],
    ];
    for (const [i, [status, finishedAt, lead]] of deploys.entries()) {
      await db.query(
        `INSERT INTO "Deployment" (id, "serviceId", "externalId", environment, status, "finishedAt", "leadTimeHours")
         VALUES ($1, 'e2e-svc', $2, 'production', $3, $4, $5) ON CONFLICT DO NOTHING`,
        [`e2e-dep-${i}`, String(i + 1), status, finishedAt, lead],
      );
    }
  } finally {
    await db.end();
  }
}

test.beforeAll(seed);

/** KPI card on the dashboard / member page, found by its label. */
const kpi = (page: Page, label: string) =>
  page.locator('app-stat-card').filter({ has: page.getByText(label, { exact: true }) });
const dora = (page: Page, label: string) =>
  page.locator('app-dora-tile').filter({ has: page.getByText(label, { exact: true }) });
const cells = (page: Page, name: RegExp) => page.getByRole('row', { name }).getByRole('cell');

test('dashboard rolls up seeded activity by person, team and tribe', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await expect(page.getByText('Here’s how 3 people across 2 teams delivered')).toBeVisible();

  await expect(kpi(page, 'Commits')).toContainText('14');
  await expect(kpi(page, 'Commits')).toContainText('+180%');
  await expect(kpi(page, 'PRs merged')).toContainText('4');
  await expect(kpi(page, 'PRs merged')).toContainText('4 raised');
  await expect(kpi(page, 'Reviews')).toContainText('6');
  await expect(kpi(page, 'Reviews')).toContainText('new');
  // KEY-2 is shared by Mina and Bassam but counted once.
  await expect(kpi(page, 'Issues done')).toContainText('2');
  await expect(kpi(page, 'Issues done')).toContainText('5 story points');

  await expect(dora(page, 'Deployment frequency')).toContainText('0.1/day');
  await expect(dora(page, 'Change failure rate')).toContainText('25%');
  await expect(page.getByText('No deployments yet', { exact: false })).toHaveCount(0);

  // People breakdown, sorted by commits by default, then by name.
  const body = page.locator('tbody tr');
  await expect(body).toHaveCount(3);
  await expect(body.nth(0)).toContainText('Mina Samir');
  await expect(body.nth(2)).toContainText('Omar Elshamy');
  await expect(cells(page, /Mina Samir/).nth(1)).toHaveText('10');
  await page.getByRole('button', { name: 'Person' }).click();
  await expect(body.nth(0)).toContainText('Bassam Adel');

  await page.getByRole('tab', { name: 'Teams' }).click();
  await expect(cells(page, /Michael Ramzy/).nth(1)).toHaveText('13');
  await expect(cells(page, /Michael Ramzy/).nth(4)).toHaveText('2');
  await expect(cells(page, /Rana Abdelaziz/).nth(1)).toHaveText('1');
  await expect(page.getByRole('row', { name: /Michael Ramzy/ })).toContainText('2 people');

  await page.getByRole('tab', { name: 'Tribes' }).click();
  await expect(page.getByRole('columnheader', { name: 'Tribe' })).toBeVisible();
  await expect(cells(page, /Retail/).nth(1)).toHaveText('14');
  await expect(page.getByRole('row', { name: /Retail/ })).toContainText('3 people');

  // A narrower range drops Mina's activity from 10 days ago and compares against it instead.
  await page.getByLabel('Date range').selectOption({ label: 'Last 7 days' });
  await expect(kpi(page, 'Commits')).toContainText('10');
  await expect(kpi(page, 'Commits')).toContainText('+150%');

  // Rows link to the combined profile.
  await page.getByRole('tab', { name: 'People' }).click();
  await page.getByRole('link', { name: /Mina Samir/ }).click();
  await expect(page).toHaveURL(/\/members\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Mina Samir' })).toBeVisible();
});

test('member profile merges Azure DevOps and Jira activity', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'People').click();

  // List view shows the same 30-day numbers per person.
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(cells(page, /Mina Samir/).nth(2)).toHaveText('10');
  await expect(cells(page, /Mina Samir/).nth(4)).toHaveText('2');
  await expect(cells(page, /Bassam Adel/).nth(2)).toHaveText('3');
  await page.getByRole('link', { name: /Mina Samir/ }).click();

  await expect(page.getByRole('heading', { name: 'Mina Samir' })).toBeVisible();
  await expect(page.getByText('Senior Engineer · reports to Michael Ramzy')).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'mina@cadence.local' })).toBeVisible();
  await expect(page.locator('.badge', { hasText: 'acc-mina' })).toBeVisible();

  await expect(kpi(page, 'Commits')).toContainText('10');
  await expect(kpi(page, 'Commits')).toContainText('+100%');
  await expect(kpi(page, 'Pull requests')).toContainText('3 / 3');
  await expect(kpi(page, 'Reviews')).toContainText('4');
  await expect(kpi(page, 'Issues done')).toContainText('5 pts · cycle 15.0 h');
  // Median of Mina's own PRs (2h, 6h), down from 9h in the previous period.
  await expect(kpi(page, 'Review wait')).toContainText('4.0 h');
  await expect(kpi(page, 'Review wait')).toContainText('median, 2 PRs');

  // Share of activity: ADO 10 + 3 + 4 = 17, Jira 2 → 89% / 11%.
  const sources = page.locator('section', {
    has: page.getByRole('heading', { name: 'Where the work happens' }),
  });
  const adoSource = sources.locator('.rounded-box', {
    hasText: 'mina@cadence.local · Azure DevOps',
  });
  const jiraSource = sources.locator('.rounded-box', { hasText: 'acc-mina · Jira Cloud' });
  await expect(adoSource).toContainText('89%');
  await expect(jiraSource).toContainText('11%');
  await expect(jiraSource).toContainText('15.0 h');
  await expect(page.getByRole('heading', { name: 'Activity calendar' })).toBeVisible();

  await page.getByLabel('Date range').selectOption({ label: 'Last 7 days' });
  await expect(kpi(page, 'Commits')).toContainText('6');
  await expect(kpi(page, 'Commits')).toContainText('+50%');

  await page.locator('main').getByRole('link', { name: 'People', exact: true }).click();
  await expect(page).toHaveURL(/\/members$/);
});

test('admin assigns a pipeline to a team and DORA metrics follow the owner', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Delivery (DORA)').click();

  await expect(dora(page, 'Deployment frequency')).toContainText('0.1/day');
  await expect(dora(page, 'Deployment frequency')).toContainText('3 successful deploys');
  await expect(dora(page, 'Deployment frequency')).toContainText('Medium');
  await expect(dora(page, 'Lead time for changes')).toContainText('20.0 h');
  await expect(dora(page, 'Lead time for changes')).toContainText('Elite');
  await expect(dora(page, 'Change failure rate')).toContainText('1 of 4 failed');
  await expect(dora(page, 'Change failure rate')).toContainText('Low');
  await expect(dora(page, 'Time to restore')).toContainText('4.0 h');
  await expect(dora(page, 'Time to restore')).toContainText('High');
  // Not a DORA metric: a median over the people in view (2h, 6h, 30h) and no rating.
  await expect(dora(page, 'Review wait')).toContainText('6.0 h');
  await expect(dora(page, 'Review wait')).toContainText('Median, 3 PRs');
  await expect(dora(page, 'Review wait').getByRole('progressbar')).toHaveCount(0);

  const row = page.getByRole('row', { name: new RegExp(SERVICE) });
  await expect(row.getByRole('cell').nth(2)).toHaveText('4');
  await expect(row.getByRole('cell').nth(3)).toHaveText('1');
  const owner = page.getByLabel(`Owner of ${SERVICE}`);
  await expect(owner).toHaveValue('');
  await owner.selectOption({ label: 'Michael Ramzy' });
  await expect(page.getByText('Owner updated')).toBeVisible();

  // Filtering by another team hides the service and its deployments.
  await page.getByLabel('Team', { exact: true }).selectOption({ label: 'Rana Abdelaziz' });
  await expect(page.getByText('No services yet.')).toBeVisible();
  await expect(dora(page, 'Deployment frequency')).toContainText('0/day');
  await page.getByLabel('Team', { exact: true }).selectOption({ label: 'Michael Ramzy' });
  await expect(row).toBeVisible();

  await nav(page, 'Audit log').click();
  await page.getByRole('button', { name: 'Services', exact: true }).click();
  await expect(page.getByText('service.owner_changed', { exact: true })).toBeVisible();
});

test("the owning manager sees their pipeline and only their team's activity", async ({ page }) => {
  await login(page, EM.email, 'changed-password-9');
  await expect(kpi(page, 'Commits')).toContainText('13');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('row', { name: /Omar Elshamy/ })).toHaveCount(0);

  await nav(page, 'Delivery (DORA)').click();
  const row = page.getByRole('row', { name: new RegExp(SERVICE) });
  // Managers can't reassign: the owner is plain text.
  await expect(row).toContainText('Michael Ramzy');
  await expect(page.getByLabel(`Owner of ${SERVICE}`)).toHaveCount(0);
  await expect(dora(page, 'Change failure rate')).toContainText('25%');
});

test('tribe leads can reassign pipelines between their own teams', async ({ page }) => {
  await login(page, TL.email, TL.password);
  await nav(page, 'Delivery (DORA)').click();
  const owner = page.getByLabel(`Owner of ${SERVICE}`);
  // No "Unassigned" option for tribe leads.
  await expect(owner.getByRole('option')).toHaveText(['Michael Ramzy', 'Rana Abdelaziz']);
  await owner.selectOption({ label: 'Rana Abdelaziz' });
  await expect(page.getByText('Owner updated')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(`Owner of ${SERVICE}`)).toHaveValue(/.+/);
  await expect(page.getByLabel(`Owner of ${SERVICE}`).locator('option:checked')).toHaveText(
    'Rana Abdelaziz',
  );
});
