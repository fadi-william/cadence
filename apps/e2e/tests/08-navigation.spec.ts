import { expect, test } from '@playwright/test';
import { ADMIN, TL, login, nav } from './helpers';

test.use({ colorScheme: 'light' });

test('signed-out visitors are sent to sign in, then on to the page they asked for', async ({
  page,
}) => {
  await page.goto('/members');
  await expect(page).toHaveURL(/\/login\?next=%2Fmembers$/);

  // Wrong credentials, and an account removed in 07, are both refused without detail.
  for (const [email, password] of [
    [ADMIN.email, 'not-the-password'],
    ['temp@cadence.local', 'temp-manager-pass'],
  ]) {
    await page.getByPlaceholder('you@cadence.local').fill(email);
    await page.getByPlaceholder('Your password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/login/);
  }

  await page.getByPlaceholder('you@cadence.local').fill(ADMIN.email);
  await page.getByPlaceholder('Your password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();

  // Signed in, the login page and unknown routes lead back into the app.
  await page.goto('/login');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/no-such-page');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("tribe leads can't open admin pages", async ({ page }) => {
  await login(page, TL.email, TL.password);
  await expect(nav(page, 'Integrations')).toHaveCount(0);
  await expect(nav(page, 'Audit log')).toHaveCount(0);
  await expect(page.locator('aside nav')).toContainText('Tribe Lead');
  for (const path of ['/audit', '/integrations']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard$/);
  }
});

test('theme and sidebar preferences survive a reload', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'cadence');

  await page.getByLabel('Toggle dark mode').click();
  await expect(html).toHaveAttribute('data-theme', 'cadence-dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'cadence-dark');
  await expect(page.getByLabel('Toggle dark mode')).toBeChecked();

  // The account page offers the same choice.
  await page.goto('/account');
  const theme = page.getByRole('group', { name: 'Theme' });
  await expect(theme.getByRole('button', { name: 'Dark' })).toHaveClass(/btn-primary/);
  await theme.getByRole('button', { name: 'Light' }).click();
  await expect(html).toHaveAttribute('data-theme', 'cadence');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'cadence');
  await expect(
    page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }),
  ).toHaveClass(/btn-primary/);

  // Collapsing the sidebar hides the labels and is remembered.
  await page.getByRole('button', { name: 'Collapse navigation' }).click();
  await expect(nav(page, 'Dashboard').getByText('Dashboard')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(nav(page, 'Dashboard').getByText('Dashboard')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the bottom bar and drawer reach every page', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    const bar = page.getByRole('navigation', { name: 'Quick navigation' });
    const drawer = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(bar).toBeVisible();
    await expect(drawer).not.toBeInViewport();
    await expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    await bar.getByRole('link', { name: 'People' }).click();
    await expect(page).toHaveURL(/\/members$/);
    await expect(bar.getByRole('link', { name: 'People' })).toHaveAttribute('aria-current', 'page');
    await bar.getByRole('link', { name: 'Org' }).click();
    await expect(page.getByRole('heading', { name: 'Teams & tribes' })).toBeVisible();
    await bar.getByRole('link', { name: 'Delivery' }).click();
    await expect(page.getByRole('heading', { name: 'Delivery performance' })).toBeVisible();

    // Admin pages live in the drawer behind "More".
    await bar.getByRole('button', { name: 'More navigation' }).click();
    await expect(drawer).toBeInViewport();
    await drawer.getByRole('link', { name: 'Audit log' }).click();
    await expect(page).toHaveURL(/\/audit$/);
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(drawer).not.toBeInViewport();

    await bar.getByRole('button', { name: 'More navigation' }).click();
    await drawer.getByRole('link', { name: 'Integrations' }).click();
    await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();
    await expect(drawer).not.toBeInViewport();
  });
});
