import { expect, test } from '@playwright/test';
import { ADMIN, EM, login, logout, nav } from './helpers';

test('admin issues a reset link and the manager sets a new password with it', async ({
  page,
  browser,
}) => {
  await login(page, ADMIN.email, ADMIN.password);
  await nav(page, 'Teams & tribes').click();
  await page
    .locator('.collapse', { hasText: EM.name })
    .getByRole('button', { name: 'Reset link' })
    .click();
  const url = await page.getByLabel('Reset link').inputValue();
  expect(url).toContain('/reset-password?token=');

  const other = await browser.newContext();
  const em = await other.newPage();
  await em.goto(url);
  await em.getByPlaceholder(/^New password/).fill('a-fresh-password-1');
  await em.getByPlaceholder('Confirm new password').fill('a-fresh-password-1');
  await em.getByRole('button', { name: 'Set password' }).click();
  await expect(em).toHaveURL(/\/login$/);
  await login(em, EM.email, 'a-fresh-password-1');

  // The link is single-use.
  await em.goto(url);
  await em.getByPlaceholder(/^New password/).fill('another-password-2');
  await em.getByPlaceholder('Confirm new password').fill('another-password-2');
  await em.getByRole('button', { name: 'Set password' }).click();
  await expect(em.getByText('This reset link is invalid or has expired')).toBeVisible();
  await other.close();
});

test('users can change their own password and sign out', async ({ page }) => {
  await login(page, EM.email, 'a-fresh-password-1');
  await page.goto('/account');
  await page.getByPlaceholder('Current password').fill('a-fresh-password-1');
  await page.getByPlaceholder(/^New password/).fill('changed-password-9');
  await page.getByPlaceholder('Confirm new password').fill('changed-password-9');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Password updated')).toBeVisible();
  await logout(page);

  // After sign-out a reload does not restore the session.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  await login(page, EM.email, 'changed-password-9');
});

test('forgot password never reveals whether an account exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  // Wait for the new page: the login form's own E-mail field is still present during the lazy load.
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByPlaceholder('you@cadence.local').fill('nobody@cadence.local');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account exists for nobody@cadence.local')).toBeVisible();
});
