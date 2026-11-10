import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const CARD = join(import.meta.dirname, 'fixtures', 'card-cosedil.jpg');

async function register(page: Page, tag: string, name = 'Prova Utente') {
  const res = await page.request.post('/api/auth/register', {
    data: { email: `${tag}-${test.info().project.name}-${Date.now()}@test.it`, password: 'una-password-lunga-123', displayName: name, acceptPrivacy: true },
  });
  expect(res.status()).toBe(201);
  const { accessToken } = await res.json();
  return { authorization: `Bearer ${accessToken}` };
}

test('event mode tags new cards; a follow-up reminder shows up and is closed', async ({ page }) => {
  const headers = await register(page, 'event');
  const { contact } = await (
    await page.request.post('/api/contacts', { data: { firstName: 'Paolo', lastName: 'De Santis', company: 'Studio Legale Martini' }, headers })
  ).json();

  await page.goto('/');
  await page.getByRole('button', { name: 'Modalità evento' }).click();
  await page.getByLabel('Nome dell’evento').fill('SAIE Bologna 2026');
  await page.getByRole('button', { name: 'Attiva', exact: true }).click();
  await expect(page.getByText('Evento in corso: SAIE Bologna 2026')).toBeVisible();

  // a card typed in now belongs to the event
  await page.goto('/contatti/nuovo');
  await expect(page.getByLabel('Luogo o evento')).toHaveValue('SAIE Bologna 2026');
  await page.getByLabel('Nome', { exact: true }).fill('Orazio');
  await page.getByLabel('Cognome').fill('Pappalardo');
  await page.getByRole('button', { name: 'Salva contatto' }).click();
  await expect(page).toHaveURL(/\/contatti\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('link', { name: 'SAIE Bologna 2026' })).toBeVisible(); // the tag

  await page.goto('/');
  await page.getByRole('button', { name: 'Vedi' }).click();
  await expect(page.getByText('In ordine alfabetico · 1')).toBeVisible();
  await page.getByRole('button', { name: 'Termina' }).click();
  await expect(page.getByText('Evento in corso')).toHaveCount(0);

  // follow-up
  await page.goto(`/contatti/${contact.id}`);
  await page.getByLabel('Promemoria (facoltativo)').fill('Inviare il preventivo');
  await page.getByRole('button', { name: 'Tra una settimana' }).click();
  await expect(page.getByRole('heading', { name: /Ricontatta/ })).toBeVisible();
  await expect(page.getByText('Inviare il preventivo')).toBeVisible();
  await page.goto('/promemoria');
  await expect(page.getByRole('heading', { name: 'Prossimi' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Paolo De Santis/ })).toBeVisible();
  await page.getByRole('button', { name: 'Fatto: Paolo De Santis' }).click();
  await expect(page.getByText(/Nessun promemoria/)).toBeVisible();
});

test('team address book: invite a colleague, share a card, the colleague saves it', async ({ page, browser }) => {
  const headers = await register(page, 'admin', 'Anna Admin');
  const { contact } = await (
    await page.request.post('/api/contacts', {
      data: { firstName: 'Marta', lastName: 'Colombo', company: 'Cosedil S.p.A.', notes: 'nota privata', phones: [{ type: 'mobile', value: '+39 333 123 4567' }] },
      headers,
    })
  ).json();

  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Crea la rubrica del tuo team' })).toBeVisible();
  await page.getByRole('button', { name: 'Crea team' }).click(); // name defaults to Cosedil
  await expect(page.getByRole('heading', { name: 'Cosedil' })).toBeVisible();
  const link = (await page.locator('.invite-link code').textContent())!;
  expect(link).toMatch(/\/team\/invito#[\w-]{32}$/);

  // share from the contact page
  await page.goto(`/contatti/${contact.id}`);
  await page.getByRole('button', { name: 'Cosedil', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cosedil', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // the colleague, on another phone, opens the link
  const other = await browser.newContext();
  const bruno = await other.newPage();
  await register(bruno, 'bruno', 'Bruno Collega');
  await bruno.goto(new URL(link).pathname + new URL(link).hash);
  await expect(bruno.getByRole('heading', { name: 'Entra in Cosedil' })).toBeVisible();
  await bruno.getByRole('button', { name: 'Entra nel team' }).click();
  await expect(bruno.getByRole('heading', { name: 'Cosedil' })).toBeVisible();
  await bruno.getByRole('link', { name: /Marta Colombo/ }).click();
  await expect(bruno.getByText('Condiviso da Anna Admin')).toBeVisible();
  await expect(bruno.getByText('nota privata')).toHaveCount(0);
  await expect(bruno.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', 'https://wa.me/393331234567');
  await bruno.getByRole('button', { name: 'Salva nei miei' }).click();
  await expect(bruno).toHaveURL(/\/contatti\/[0-9a-f-]{36}$/);
  await expect(bruno.getByRole('heading', { name: /Ricontattare/ })).toBeVisible(); // his own copy
  await other.close();
});

test('batch scan: two cards from the gallery, read on the device, saved together', async ({ page }) => {
  test.setTimeout(240_000);
  await register(page, 'batch');
  await page.goto('/scansiona');
  await page.getByRole('button', { name: 'Raffica' }).click();
  await page.locator('input[type=file]:not([capture])').setInputFiles([CARD, CARD]);
  await page.getByRole('button', { name: /^Fine/ }).click();
  await expect(page.getByRole('heading', { name: '2 biglietti' })).toBeVisible();
  const save = page.getByRole('button', { name: 'Salva tutti' });
  await expect(save).toBeEnabled({ timeout: 200_000 });
  await expect(page.getByText(/Colombo/).first()).toBeVisible();
  await save.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('2 biglietti', { exact: false }).first()).toBeVisible();
});
