import { Page, expect, test } from '@playwright/test';
import pg from 'pg';
import { ADMIN, API_URL, DATABASE_URL, acceptNextConfirm, login, nav } from './helpers';

const JIRA_URL = 'https://cadence.atlassian.invalid';

const card = (page: Page, name: string) =>
  page.locator('article', {
    has: page.getByRole('heading', { name, exact: true }),
  });

test('admin connects Jira: the form validates, then the connection can be edited and disabled', async ({
  page,
}) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Integrations').click();

  await page.getByRole('button', { name: /Connect Jira/ }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: 'Connect Jira' })).toBeVisible();

  // Nothing filled in: every required field explains itself.
  await dialog.getByPlaceholder('Name', { exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Give the connection a name')).toBeVisible();
  await expect(dialog.getByText('Enter the base URL')).toBeVisible();
  await expect(dialog.getByText('A token is required')).toBeVisible();

  await dialog.getByPlaceholder('Name', { exact: true }).fill('Jira');
  await dialog.getByPlaceholder('https://your-company.atlassian.net').fill('cadence.atlassian.net');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a full URL (https://…)')).toBeVisible();
  await expect(dialog.getByText('Give the connection a name')).toHaveCount(0);

  await dialog.getByPlaceholder('https://your-company.atlassian.net').fill(`${JIRA_URL}/`);
  await expect(dialog.getByRole('combobox')).toHaveValue('cloud');
  await dialog.getByPlaceholder('bot@cadence.local').fill('bot@cadence.local');
  await dialog.getByPlaceholder('customfield_10016').fill('customfield_10016');
  await dialog.getByPlaceholder('CORE, WEB').fill('CORE, WEB');
  await dialog.getByPlaceholder('API token / Personal access token').fill('fake-jira-token');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Integration saved')).toBeVisible();

  const jira = card(page, 'Jira');
  // Trailing slash is stripped server-side.
  await expect(jira.getByText(JIRA_URL, { exact: true })).toBeVisible();
  await expect(jira.getByText('Never synced')).toBeVisible();

  // Edit: the stored token is kept when the secret field is left empty; config round-trips.
  await jira.getByTitle('Edit').click();
  await expect(dialog.getByRole('heading', { name: 'Edit Jira' })).toBeVisible();
  await expect(dialog.getByText('Leave empty to keep the stored secret.')).toBeVisible();
  await expect(dialog.getByPlaceholder('CORE, WEB')).toHaveValue('CORE, WEB');
  await expect(dialog.getByPlaceholder('bot@cadence.local')).toHaveValue('bot@cadence.local');
  await dialog.getByPlaceholder('Name', { exact: true }).fill('Jira Cloud');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  const jiraCloud = card(page, 'Jira Cloud');
  await expect(jiraCloud).toBeVisible();
  await expect(card(page, 'Jira')).toHaveCount(0);

  // Disabling persists and hides the connection from identity linking.
  const toggle = page.getByLabel('Enable Jira Cloud');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.reload();
  await expect(page.getByLabel('Enable Jira Cloud')).not.toBeChecked();

  await nav(page, 'People').click();
  await page.getByRole('button', { name: 'Actions for Mina Samir' }).click();
  await page.getByRole('button', { name: 'Link identities' }).click();
  const ids = page.locator('dialog[open]');
  await expect(ids.getByLabel('Azure DevOps username')).toHaveValue('mina@cadence.local');
  await expect(ids.getByLabel('Jira username')).toHaveCount(0);
  await ids.getByRole('button', { name: 'Done' }).click();

  await nav(page, 'Integrations').click();
  await page.getByLabel('Enable Jira Cloud').check();
  await expect(page.getByLabel('Enable Jira Cloud')).toBeChecked();

  // Re-enabled: Mina and Bassam can now be linked to their Jira accounts.
  await nav(page, 'People').click();
  for (const [name, account] of [
    ['Mina Samir', 'acc-mina'],
    ['Bassam Adel', 'acc-bassam'],
  ]) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('button', { name: 'Link identities' }).click();
    await ids.getByLabel('Jira username').fill(account);
    await ids
      .locator('.rounded-box', { has: page.getByLabel('Jira username') })
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(ids.getByText('Linked', { exact: true })).toHaveCount(
      name === 'Mina Samir' ? 2 : 1,
    );
    await ids.getByRole('button', { name: 'Done' }).click();
    await expect(ids).toHaveCount(0);
    await expect(page.locator('article', { hasText: name })).toContainText(account);
  }
});

test('webhooks accept the shared secret, reject bad tokens and stop once disabled', async ({
  page,
  request,
}) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Integrations').click();
  await card(page, 'Jira Cloud').getByTitle('Webhook').click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByText('Not enabled')).toBeVisible();
  await dialog.getByRole('button', { name: 'Generate secret' }).click();
  await expect(page.getByText('Webhook enabled')).toBeVisible();
  const secret = await dialog.getByLabel('Webhook secret').inputValue();
  const id = new URL(await dialog.getByLabel('Webhook URL').inputValue()).pathname.split('/').pop();
  expect(secret.length).toBeGreaterThan(10);
  const endpoint = `${API_URL}/webhooks/${id}`;

  const bad = await request.post(endpoint, {
    headers: { 'x-cadence-token': 'not-the-secret' },
    data: {},
  });
  expect(bad.status()).toBe(401);
  const ok = await request.post(endpoint, {
    headers: { 'x-cadence-token': secret },
    data: {},
  });
  expect(ok.status()).toBe(202);
  expect(await ok.json()).toMatchObject({ accepted: true });

  await expect(dialog.getByText('Enabled', { exact: true })).toBeVisible();
  acceptNextConfirm(page);
  await dialog.getByRole('button', { name: 'Disable' }).click();
  await expect(dialog.getByText('Not enabled')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card(page, 'Jira Cloud').locator('.badge', { hasText: 'Webhook' })).toHaveCount(0);

  const gone = await request.post(endpoint, {
    headers: { 'x-cadence-token': secret },
    data: {},
  });
  expect(gone.status()).toBe(404);
});

test('admin deletes a connection after confirming, and it shows in the audit log', async ({
  page,
}) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Integrations').click();

  await page.getByRole('button', { name: /Connect Azure DevOps/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByPlaceholder('Name', { exact: true }).fill('Scratch ADO');
  await dialog
    .getByPlaceholder('https://dev.azure.com/your-org')
    .fill('https://dev.azure.invalid/scratch');
  await dialog.getByPlaceholder('Personal access token').fill('scratch-pat');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'Scratch ADO')).toBeVisible();

  // Cancelling the confirmation keeps it.
  page.once('dialog', (d) => void d.dismiss());
  await card(page, 'Scratch ADO').getByTitle('Delete').click();
  await expect(card(page, 'Scratch ADO')).toBeVisible();

  acceptNextConfirm(page);
  await card(page, 'Scratch ADO').getByTitle('Delete').click();
  await expect(card(page, 'Scratch ADO')).toHaveCount(0);
  await expect(card(page, 'Jira Cloud')).toBeVisible();
  await expect(card(page, 'Azure DevOps')).toBeVisible();

  await nav(page, 'Audit log').click();
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  const rows = page.locator('tbody tr');
  for (const action of [
    'integration.deleted',
    'integration.webhook_disabled',
    'integration.webhook_secret_set',
    'integration.updated',
    'integration.created',
  ]) {
    await expect(rows.getByText(action, { exact: true }).first()).toBeVisible();
  }
  // The filter only shows integration entries.
  await expect(rows.getByText('user.created', { exact: true })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'integration.deleted' }).first()).toContainText(ADMIN.email);
});

test('admin turns connection features off, keeping or removing what they collected', async ({
  page,
}) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Integrations').click();

  // New connections start with every feature the provider supports.
  await page.getByRole('button', { name: /Connect Azure DevOps/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByPlaceholder('Name', { exact: true }).fill('Features ADO');
  await dialog
    .getByPlaceholder('https://dev.azure.com/your-org')
    .fill('https://dev.azure.invalid/features');
  await dialog.getByPlaceholder('Personal access token').fill('features-pat');
  for (const name of [/Work tracking/, /Source control/, /Deployments/]) {
    await expect(dialog.getByRole('checkbox', { name })).toBeChecked();
  }
  await dialog.getByRole('button', { name: 'Save' }).click();
  const ado = card(page, 'Features ADO');
  await expect(ado).toBeVisible();
  await expect(ado.getByTitle(/is turned off/)).toHaveCount(0);

  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const {
    rows: [conn],
  } = await db.query(`SELECT id FROM "IntegrationConnection" WHERE name = 'Features ADO'`);
  await db.query(
    `INSERT INTO "DeliveryService" (id, "connectionId", name) VALUES ('e2e-features-svc', $1, 'features-api')`,
    [conn.id],
  );
  const services = async () =>
    Number(
      (
        await db.query(`SELECT count(*) FROM "DeliveryService" WHERE "connectionId" = $1`, [
          conn.id,
        ])
      ).rows[0].count,
    );

  // Turning work tracking off keeps its history by default.
  await ado.getByTitle('Edit').click();
  await dialog.getByRole('checkbox', { name: /Work tracking/ }).uncheck();
  const workChoice = dialog.getByRole('radiogroup', { name: /Work tracking data/ });
  await expect(workChoice.getByRole('radio', { name: /Keep its history/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(ado.getByTitle('Work tracking is turned off')).toBeVisible();

  // Removing deployments' data asks first; cancelling keeps the dialog open and the data.
  await ado.getByTitle('Edit').click();
  await expect(dialog.getByRole('checkbox', { name: /Work tracking/ })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: /Deployments/ }).uncheck();
  await dialog
    .getByRole('radiogroup', { name: /Deployments data/ })
    .getByRole('radio', { name: 'Remove its data' })
    .check();
  page.once('dialog', (d) => void d.dismiss());
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeVisible();
  expect(await services()).toBe(1);
  acceptNextConfirm(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(ado.getByTitle('Deployments is turned off')).toBeVisible();
  expect(await services()).toBe(0);
  await db.end();

  // At least one feature has to stay on.
  await ado.getByTitle('Edit').click();
  await dialog.getByRole('checkbox', { name: /Source control/ }).uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Turn on at least one feature')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  acceptNextConfirm(page);
  await ado.getByTitle('Delete').click();
  await expect(ado).toHaveCount(0);
});
