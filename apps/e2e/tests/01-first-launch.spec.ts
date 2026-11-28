import { expect, test } from '@playwright/test';
import { ADMIN } from './helpers';

test('first launch forces the admin to set a password, then setup is closed', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { name: 'Welcome to Cadence' })).toBeVisible();
  await expect(page.getByPlaceholder('admin@cadence.local')).toHaveValue(ADMIN.email);

  // Signal Forms validation is shown inline once the user tries to submit.
  await page.getByPlaceholder('Create a password').fill('short');
  await page.getByRole('button', { name: 'Complete setup' }).click();
  await expect(page.getByText('Use at least 12 characters')).toBeVisible();
  await expect(page.getByText('Repeat the password', { exact: true }).last()).toBeVisible();

  await page.getByPlaceholder('Create a password').fill(ADMIN.password);
  await page.getByPlaceholder('Repeat the password').fill('mismatch-password');
  await page.getByPlaceholder('Repeat the password').blur();
  await expect(page.getByText('Passwords don’t match')).toBeVisible();
  await page.getByPlaceholder('Repeat the password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Complete setup' }).click();

  await expect(page).toHaveURL(/\/organization$/);
  await expect(page.getByText('No tribes yet')).toBeVisible();

  // Reload restores the session from the httpOnly refresh cookie.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Teams & tribes' })).toBeVisible();

  // Setup can no longer be reached.
  await page.goto('/setup');
  await expect(page).not.toHaveURL(/\/setup$/);
});
