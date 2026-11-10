import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const EXCEL = join(import.meta.dirname, '..', 'apps', 'web', 'test', 'fixtures', 'excel.xlsx');

test('import from Excel: template, upload, fix a row, paste cells, create the cards', async ({ page }, info) => {
  const res = await page.request.post('/api/auth/register', {
    data: { email: `xlsx-${info.project.name}-${Date.now()}@test.it`, password: 'una-password-lunga-123', displayName: 'Excel Prova', acceptPrivacy: true },
  });
  expect(res.status()).toBe(201);
  const { accessToken } = await res.json();
  // already in the wallet: the import skips her
  await page.request.post('/api/contacts', {
    data: { firstName: 'Marta', lastName: 'Colombo', emails: ['marta@cosedil.it'] },
    headers: { authorization: `Bearer ${accessToken}` },
  });

  await page.goto('/impostazioni');
  await page.getByRole('link', { name: 'Importa da Excel' }).first().click();
  await expect(page.getByRole('heading', { name: 'Biglietti da Excel' })).toBeVisible();
  await page.screenshot({ path: `test-results/import/${info.project.name}-1-start.png`, fullPage: true });

  if (info.project.name.includes('chromium')) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Modello Excel' }).click();
    expect((await download).suggestedFilename()).toBe('Modello biglietti CardVault.xlsx');
  }

  await page.locator('input[type=file]').setInputFiles(EXCEL);
  await expect(page.getByText('excel.xlsx')).toBeVisible();
  await expect(page.getByText('2 righe · 2 pronte')).toBeVisible();

  // a row without a name is flagged, then fixed in place
  await page.getByRole('button', { name: 'Aggiungi riga' }).click();
  await page.getByLabel('Ruolo, riga 3').fill('Geometra');
  await expect(page.getByText('Manca nome, cognome o azienda')).toBeVisible();
  await expect(page.getByText('1 da correggere')).toBeVisible();
  await page.getByLabel('Nome, riga 3', { exact: true }).fill('Fabio');
  await page.getByLabel('Cognome, riga 3').fill('Restivo');
  await expect(page.getByText('3 righe · 3 pronte')).toBeVisible();

  // cells copied from Excel fill the rows below
  await page.getByRole('button', { name: 'Aggiungi riga' }).click();
  await page.getByLabel('Nome, riga 4', { exact: true }).focus();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Salvatore\tGreco\tImpianti Sud\r\nJames\tWhitaker\tNorthwind Traders\r\n');
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByLabel('Azienda, riga 5')).toHaveValue('Northwind Traders');
  await expect(page.getByText('5 righe · 5 pronte')).toBeVisible();
  await page.screenshot({ path: `test-results/import/${info.project.name}-2-sheet.png`, fullPage: true });

  await page.getByRole('button', { name: 'Crea 5 biglietti' }).click();
  await expect(page.locator('.import-result')).toContainText('Creati 4 biglietti');
  await expect(page.locator('.import-result')).toContainText('1 già nel wallet, saltati');
  await page.screenshot({ path: `test-results/import/${info.project.name}-3-done.png`, fullPage: true });

  await page.getByRole('link', { name: 'Apri il wallet' }).click();
  await expect(page.getByText('1 di 5')).toBeVisible(); // the existing card + 4 imported
  await page.goto('/cerca?q=Whitaker');
  await expect(page.getByText('James Whitaker')).toBeVisible();
  await page.goto('/cerca?q=Nicolò');
  await expect(page.getByText('Tecnostrade S.r.l.').first()).toBeVisible();
});
