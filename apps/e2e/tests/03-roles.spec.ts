import { expect, test } from '@playwright/test';
import { EM, TL, login, nav } from './helpers';

test('engineering managers only see their own team', async ({ page }) => {
  await login(page, EM.email, EM.password);
  await expect(nav(page, 'Integrations')).toHaveCount(0);
  await expect(nav(page, 'Audit log')).toHaveCount(0);

  await nav(page, 'People').click();
  await expect(page.getByRole('link', { name: 'Mina Samir' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Omar Elshamy' })).toHaveCount(0);

  // Admin-only routes bounce back to the dashboard.
  await page.goto('/integrations');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('tribe leads see every team in their tribe and the delivery page', async ({ page }) => {
  await login(page, TL.email, TL.password);
  await nav(page, 'People').click();
  await expect(page.getByRole('link', { name: 'Mina Samir' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Omar Elshamy' })).toBeVisible();

  await nav(page, 'Dashboard').click();
  await page.getByRole('tab', { name: 'Teams' }).click();
  await expect(page.getByRole('columnheader', { name: 'Team' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Michael Ramzy/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rana Abdelaziz/ })).toBeVisible();

  await nav(page, 'Delivery (DORA)').click();
  await expect(page.getByRole('heading', { name: 'Delivery performance' })).toBeVisible();
  await expect(page.getByText('Deployment frequency')).toBeVisible();
});
