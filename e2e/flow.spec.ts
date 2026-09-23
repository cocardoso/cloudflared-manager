import { expect, test } from '@playwright/test';

const FAKE_TOKEN = 'fake-token-0123456789abcdefghij';

test('setup, create tunnel, publish hostname, change settings, delete', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  // Step 1: admin
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('a-very-long-password');
  await page.getByLabel('Confirm password').fill('a-very-long-password');
  await page.getByRole('button', { name: 'Create admin' }).click();

  // Step 2: Cloudflare token
  await page.getByLabel('API token').fill(FAKE_TOKEN);
  await page.getByRole('button', { name: 'Connect' }).click();
  // The fake token reaches two accounts; no account has to be picked.
  await expect(page.getByText('Connected to 2 accounts')).toBeVisible();
  await expect(page.getByText('Home Lab, Second Org · 3 domains')).toBeVisible();
  await page.getByRole('button', { name: 'Go to dashboard' }).click();

  // Empty dashboard → create tunnel
  await expect(page.getByText('No tunnels yet')).toBeVisible();
  await page.getByRole('button', { name: 'Create tunnel' }).first().click();
  await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Account' })).toContainText('Home Lab');
  await page.getByLabel('Tunnel name').fill('home');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/tunnels\/[0-9a-f-]+\?tab=routes/);
  await expect(page.getByRole('heading', { name: 'home' })).toBeVisible();

  // Breadcrumb goes back to the list, and the row leads back to the tunnel
  await page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('link', { name: 'Tunnels' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'home' }).click();
  await expect(page.getByRole('heading', { name: 'home' })).toBeVisible();

  // Publish a hostname
  await page.getByRole('button', { name: 'Add public hostname' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subdomain').fill('ha');
  await dialog.getByLabel('URL').fill('10.0.0.5:8123');
  await dialog.getByRole('button', { name: 'Save' }).click();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'ha.example.com' })).toBeVisible();
  await expect(rows.last()).toContainText('Everything else returns 404');

  // A tunnel in the second account only offers that account's domains
  await page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('link', { name: 'Tunnels' }).click();
  await page.getByRole('button', { name: 'Create tunnel' }).first().click();
  const create = page.getByRole('dialog');
  await create.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: 'Second Org' }).click();
  await create.getByLabel('Tunnel name').fill('work');
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'work' })).toBeVisible();
  await expect(page.getByText('Second Org')).toBeVisible();
  await page.getByRole('button', { name: 'Add public hostname' }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Domain' }).click();
  await expect(page.getByRole('option')).toHaveText(['second.net']);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Delete tunnel' }).click();
  await page.getByRole('dialog').getByLabel('Type work to confirm').fill('work');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete tunnel' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('link', { name: 'home' }).click();

  // Settings: turn keep-alive off
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Keep-alive' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Keep-alive off')).toBeVisible();

  // Delete
  await page.getByRole('button', { name: 'Delete tunnel' }).click();
  await page.getByRole('dialog').getByLabel('Type home to confirm').fill('home');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete tunnel' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('No tunnels yet')).toBeVisible();
});

test('language switch persists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('a-very-long-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'Language' }).last().click();
  await page.getByRole('option', { name: 'Português (Brasil)' }).click();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible();
});
