import { Page, expect, test } from '@playwright/test';
import { ADMIN, acceptNextConfirm, fillPersonDialog, login, nav } from './helpers';

const card = (page: Page, name: string) =>
  page.locator('article', { has: page.getByRole('link', { name, exact: true }) });

test('people can be searched, filtered, added, edited and deleted', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'People').click();
  const cards = page.locator('article');
  await expect(cards).toHaveCount(3);

  const search = page.getByPlaceholder('Search people or usernames');
  await search.fill('bassam');
  await expect(cards).toHaveCount(1);
  await expect(card(page, 'Bassam Adel')).toBeVisible();
  // Linked usernames are searchable too.
  await search.fill('acc-mina');
  await expect(cards).toHaveCount(1);
  await expect(card(page, 'Mina Samir')).toBeVisible();
  await search.fill('nobody-here');
  await expect(page.getByText('No people found')).toBeVisible();
  await search.fill('');

  const team = page.getByLabel('Filter by manager');
  await team.selectOption({ label: 'Rana Abdelaziz' });
  await expect(cards).toHaveCount(1);
  await expect(card(page, 'Omar Elshamy')).toBeVisible();
  await team.selectOption({ label: 'All teams' });
  await expect(cards).toHaveCount(3);

  // Add: validation first.
  await page.getByRole('button', { name: 'Add person' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: 'Add a person' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a name')).toBeVisible();
  await expect(dialog.getByText('Choose a manager', { exact: true }).last()).toBeVisible();
  await dialog.getByPlaceholder('Hoda Fathy').fill('Laila Hassan');
  await dialog.getByPlaceholder('hoda@cadence.local').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a valid e-mail')).toBeVisible();
  await dialog.getByPlaceholder('hoda@cadence.local').fill('laila@cadence.local');
  await dialog.getByPlaceholder('Senior Engineer').fill('Engineer');
  await dialog.getByRole('combobox').selectOption({ label: 'Michael Ramzy' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Laila Hassan saved')).toBeVisible();
  await expect(card(page, 'Laila Hassan')).toContainText('Engineer · Michael Ramzy');
  await expect(card(page, 'Laila Hassan')).toContainText('Link Azure DevOps & Jira');

  // Edit: move her to Rana's team with a new title.
  await page.getByRole('button', { name: 'Actions for Laila Hassan' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(dialog.getByRole('heading', { name: 'Edit person' })).toBeVisible();
  await expect(dialog.getByPlaceholder('Hoda Fathy')).toHaveValue('Laila Hassan');
  await expect(dialog.getByPlaceholder('hoda@cadence.local')).toHaveValue('laila@cadence.local');
  await dialog.getByPlaceholder('Senior Engineer').fill('Staff Engineer');
  await dialog.getByRole('combobox').selectOption({ label: 'Rana Abdelaziz' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page, 'Laila Hassan')).toContainText('Staff Engineer · Rana Abdelaziz');

  await nav(page, 'Teams & tribes').click();
  const rana = page.locator('.collapse', { hasText: 'Rana Abdelaziz' });
  await expect(rana.getByText('2 people')).toBeVisible();
  await expect(rana.getByRole('link', { name: 'Laila Hassan' })).toBeVisible();

  // Delete (after confirming).
  await nav(page, 'People').click();
  await page.getByRole('button', { name: 'Actions for Laila Hassan' }).click();
  acceptNextConfirm(page);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Laila Hassan deleted')).toBeVisible();
  await expect(card(page, 'Laila Hassan')).toHaveCount(0);
  await expect(cards).toHaveCount(3);

  await nav(page, 'Audit log').click();
  await page.getByRole('button', { name: 'People', exact: true }).click();
  for (const action of ['member.deleted', 'member.updated', 'member.created']) {
    await expect(page.locator('tbody').getByText(action, { exact: true }).first()).toBeVisible();
  }
  await expect(page.locator('tbody').getByText('user.created', { exact: true })).toHaveCount(0);
});

test('identities are unique per platform and can be unlinked', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'People').click();
  await page.getByRole('button', { name: 'Actions for Bassam Adel' }).click();
  await page.getByRole('button', { name: 'Link identities' }).click();
  const dialog = page.locator('dialog[open]');
  const jira = dialog.locator('.rounded-box', { has: page.getByLabel('Jira username') });

  await jira.getByLabel('Jira username').fill('acc-mina');
  await jira.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.getByText('"acc-mina" is already linked to another member on Jira Cloud'),
  ).toBeVisible();

  await jira.getByTitle('Unlink').click();
  await expect(jira.getByText('Linked', { exact: true })).toHaveCount(0);
  await expect(jira.getByLabel('Jira username')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(card(page, 'Bassam Adel')).not.toContainText('acc-bassam');
  await expect(card(page, 'Bassam Adel')).toContainText('Link Azure DevOps & Jira');

  await page.reload();
  await expect(card(page, 'Bassam Adel')).toContainText('Link Azure DevOps & Jira');
  await expect(card(page, 'Mina Samir')).toContainText('acc-mina');
});

test('managers can only be removed once their people have moved on', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Teams & tribes').click();
  const retail = page.locator('section', { has: page.getByRole('heading', { name: 'Retail' }) });

  // Validation on the "new manager" dialog.
  await retail.getByRole('button', { name: 'Manager', exact: true }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog.getByRole('heading', { name: 'New engineering manager' })).toBeVisible();
  await expect(dialog.getByText('Reports to Ahmed Mostafa')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter a name')).toBeVisible();
  await expect(dialog.getByText('E-mail is required to sign in')).toBeVisible();
  await expect(dialog.getByText('Set an initial password')).toBeVisible();
  await dialog.getByPlaceholder('At least 12 characters').fill('short');
  await expect(dialog.getByText('Use at least 12 characters')).toBeVisible();

  // A taken e-mail is rejected by the API and the dialog stays open.
  await dialog.getByPlaceholder('Full name').fill('Temp Manager');
  await dialog.getByPlaceholder('name@cadence.local').fill('michael@cadence.local');
  await dialog.getByPlaceholder('At least 12 characters').fill('temp-manager-pass');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('A user with this email already exists')).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('name@cadence.local').fill('temp@cadence.local');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Temp Manager added')).toBeVisible();

  const temp = page.locator('.collapse', { hasText: 'Temp Manager' });
  await expect(temp.getByText('No people yet.')).toBeVisible();
  await temp.getByRole('button', { name: 'Person' }).click();
  await fillPersonDialog(page, { name: 'Temp Person' });
  await expect(temp.getByText('1 people')).toBeVisible();

  acceptNextConfirm(page);
  await temp.getByRole('button', { name: 'Remove manager' }).click();
  await expect(
    page.getByText('Reassign this user’s reports and members before deleting'),
  ).toBeVisible();
  await expect(temp).toBeVisible();

  // Remove the person from their profile's list, then the manager can go.
  await nav(page, 'People').click();
  await page.getByRole('button', { name: 'Actions for Temp Person' }).click();
  acceptNextConfirm(page);
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Temp Person deleted')).toBeVisible();

  await nav(page, 'Teams & tribes').click();
  acceptNextConfirm(page);
  await temp.getByRole('button', { name: 'Remove manager' }).click();
  await expect(page.getByText('Temp Manager removed')).toBeVisible();
  await expect(temp).toHaveCount(0);

  await nav(page, 'Audit log').click();
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await expect(page.locator('tbody tr', { hasText: 'user.deleted' })).toContainText(ADMIN.email);
});
