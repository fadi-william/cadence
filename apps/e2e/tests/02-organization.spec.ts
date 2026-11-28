import { expect, test } from '@playwright/test';
import { ADMIN, EM, EM2, TL, fillPersonDialog, login, nav } from './helpers';

test('admin builds the hierarchy, connects Azure DevOps and links identities', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Teams & tribes').click();

  await page.getByRole('button', { name: 'Tribe lead' }).click();
  await fillPersonDialog(page, {
    name: TL.name,
    email: TL.email,
    tribe: TL.tribe,
    password: TL.password,
  });
  await expect(page.getByRole('heading', { name: TL.tribe })).toBeVisible();

  for (const em of [EM, EM2]) {
    await page.getByRole('button', { name: 'Manager', exact: true }).click();
    await fillPersonDialog(page, {
      name: em.name,
      email: em.email,
      password: em.password,
    });
    await expect(page.locator('.collapse-title', { hasText: em.name })).toBeVisible();
  }

  const evan = page.locator('.collapse', { hasText: EM.name });
  for (const [name, title] of [
    ['Mina Samir', 'Senior Engineer'],
    ['Bassam Adel', 'Engineer'],
  ]) {
    await evan.getByRole('button', { name: 'Person' }).click();
    await fillPersonDialog(page, { name, title });
  }
  const erin = page.locator('.collapse', { hasText: EM2.name });
  await erin.getByRole('button', { name: 'Person' }).click();
  await fillPersonDialog(page, { name: 'Omar Elshamy' });
  await expect(evan.getByText('2 people')).toBeVisible();

  // Azure DevOps connection (credentials are fake: syncing fails, which the UI surfaces).
  await nav(page, 'Integrations').click();
  await page.getByRole('button', { name: /Connect Azure DevOps/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog
    .getByPlaceholder('https://dev.azure.com/your-org')
    .fill('https://dev.azure.invalid/cadence');
  await dialog.getByPlaceholder('Personal access token').fill('fake-pat');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Integration saved')).toBeVisible();

  await page.getByRole('button', { name: 'Sync 14 days' }).click();
  await expect(page.getByText('Last sync failed')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/dev\.azure\.invalid/).first()).toBeVisible();

  await page.getByTitle('Webhook').click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Generate secret' }).click();
  await expect(page.getByText('Copy this secret now')).toBeVisible();
  await page.locator('dialog[open]').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.badge', { hasText: 'Webhook' })).toBeVisible();

  // Link Mina's Azure DevOps account from her person card.
  await nav(page, 'People').click();
  await page.getByRole('button', { name: 'Actions for Mina Samir' }).click();
  await page.getByRole('button', { name: 'Link identities' }).click();
  await page.getByLabel('Azure DevOps username').fill('mina@cadence.local');
  await page.locator('dialog[open]').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Identity linked')).toBeVisible();
  await page.locator('dialog[open]').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('article', { hasText: 'Mina Samir' })).toContainText(
    'mina@cadence.local',
  );

  // Combined profile shows the linked platform.
  await page.getByRole('link', { name: 'Mina Samir' }).click();
  await expect(page.getByRole('heading', { name: 'Mina Samir' })).toBeVisible();
  await expect(page.getByText('Where the work happens')).toBeVisible();

  // Everything is in the audit log.
  await nav(page, 'Audit log').click();
  for (const action of [
    'identity.linked',
    'integration.created',
    'member.created',
    'user.created',
    'setup.completed',
  ]) {
    await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
  }
});
