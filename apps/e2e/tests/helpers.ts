/** Shared fixtures and UI helpers for the stateful E2E suite. */
import { Page, expect } from '@playwright/test';

/** The built-in admin; its password is chosen on the first-launch screen in 01-first-launch. */
export const ADMIN = {
  email: 'admin@cadence.local',
  password: 'E2e-Admin-Password!',
};
/** Tribe lead (with tribe name) the admin creates in 02-organization. */
export const TL = {
  name: 'Ahmed Mostafa',
  email: 'ahmed@cadence.local',
  password: 'tribe-lead-pass-1',
  tribe: 'Retail',
};
/** Engineering manager created by the admin in 02-organization. */
export const EM = {
  name: 'Michael Ramzy',
  email: 'michael@cadence.local',
  password: 'manager-pass-123',
};
/** A second engineering manager, also created in 02-organization. */
export const EM2 = {
  name: 'Rana Abdelaziz',
  email: 'rana@cadence.local',
  password: 'manager-pass-456',
};

/** Signs in through the login form and waits for the dashboard. */
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByPlaceholder('you@cadence.local').fill(email);
  await page.getByPlaceholder('Your password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** Signs out through the account menu and waits for the login page. */
export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Fields of the "add" dialog on Teams & tribes, keyed by placeholder. */
const PERSON_FIELDS = {
  name: 'Full name',
  email: 'name@cadence.local',
  tribe: 'e.g. Retail',
  title: 'e.g. Senior Engineer',
  password: 'At least 12 characters',
} as const;

/**
 * Fills the open "add" dialog on Teams & tribes, saves it and waits for it to close.
 *
 * @param fields - Values keyed by field; only the given fields are filled.
 */
export async function fillPersonDialog(
  page: Page,
  fields: Partial<Record<keyof typeof PERSON_FIELDS, string>>,
) {
  const dialog = page.locator('dialog[open]');
  for (const [key, value] of Object.entries(fields)) {
    await dialog.getByPlaceholder(PERSON_FIELDS[key as keyof typeof PERSON_FIELDS]).fill(value!);
  }
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
}

/** Sidebar navigation link (exact match, so page buttons with similar text don't collide). */
export const nav = (page: Page, name: string) =>
  page.locator('aside nav').getByRole('link', { name, exact: true });

/** Base URL of the API started by playwright.config.ts (for webhook calls and direct checks). */
export const API_URL = `http://localhost:${process.env.E2E_API_PORT ?? 3100}/api`;

/** The E2E database, for seeding data that would otherwise come from Jira / Azure DevOps syncs. */
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://cadence:cadence@localhost:5432/cadence_e2e';

/** Accepts the next window.confirm() (Playwright dismisses dialogs by default). */
export function acceptNextConfirm(page: Page) {
  page.once('dialog', (d) => void d.accept());
}
