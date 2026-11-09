import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const CARD = join(import.meta.dirname, 'fixtures', 'card-cosedil.jpg');

test('register, scan a card with on-device OCR, save it and find it', async ({ page }, info) => {
  const email = `e2e-${info.project.name}-${Date.now()}@test.it`;

  const cspErrors: string[] = [];
  page.on('console', (m) => /Content.Security.Policy|Refused to/i.test(m.text()) && cspErrors.push(m.text()));

  // ---- login screen first, then registration
  await page.goto('/');
  await expect(page).toHaveURL(/\/accedi/);
  await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
  await page.getByRole('link', { name: 'Registrati' }).click();
  await page.getByLabel('Nome e cognome').fill('Alessio Prova');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('una-password-lunga-123');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Crea account' }).click();

  // ---- empty wallet
  await expect(page.getByRole('heading', { name: 'Il tuo wallet' })).toBeVisible();
  await expect(page.getByText('Nessun biglietto, per ora')).toBeVisible();

  // ---- scan from gallery (headless browsers have no camera)
  await page.getByRole('link', { name: 'Scansiona biglietto' }).first().click();
  await page.locator('input[type=file]:not([capture])').setInputFiles(CARD);
  await expect(page.getByRole('heading', { name: 'Ritaglia il fronte' })).toBeVisible();
  await expect(page.getByText('Bordi trovati automaticamente')).toBeVisible();
  await page.getByRole('button', { name: 'Conferma' }).click();
  await expect(page.getByRole('heading', { name: 'Il biglietto ha un retro?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continua' }).click();

  // ---- OCR runs locally; review form pre-filled
  await expect(page.getByRole('heading', { name: 'Controlla i dati' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Marta');
  await expect(page.getByLabel('Cognome')).toHaveValue('Colombo');
  await expect(page.getByLabel('Azienda')).toHaveValue(/COSEDIL/i);
  await expect(page.getByRole('textbox', { name: 'Email' }).first()).toHaveValue('m.colombo@cosedilspa.com');
  await page.screenshot({ path: `test-results/review-${info.project.name}.png`, fullPage: true });

  await page.getByRole('button', { name: 'Salva contatto' }).click();
  await expect(page.getByText('Contatto salvato')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Foto' })).toBeVisible();
  await page.screenshot({ path: `test-results/detail-${info.project.name}.png`, fullPage: true });

  // ---- search: accent/case-insensitive and typo-tolerant
  await page.goto('/cerca?q=colmbo');
  await expect(page.getByRole('link', { name: /Marta Colombo/ })).toBeVisible();
  await page.goto('/cerca?city=catania');
  await expect(page.getByText('1 risultato')).toBeVisible();

  // ---- wallet shows the card
  await page.goto('/');
  await expect(page.getByRole('link', { name: /COSEDIL.*Marta Colombo/i })).toBeVisible();
  await page.screenshot({ path: `test-results/wallet-${info.project.name}.png`, fullPage: true });
  expect(cspErrors, 'CSP violations (OCR must run under the production policy)').toEqual([]);
});
