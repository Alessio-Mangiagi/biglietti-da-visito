import { expect, test, type APIRequestContext } from '@playwright/test';
import { join } from 'node:path';

const CARD = join(import.meta.dirname, 'fixtures', 'card-cosedil.jpg');
const PASSWORD = 'Prova-Deploy-2026';

/** Waits for the confirmation mail in a public Mailinator inbox and returns the link token. */
async function confirmationToken(request: APIRequestContext, inbox: string): Promise<string> {
  const base = 'https://www.mailinator.com/api/v2/domains/public';
  for (let i = 0; i < 24; i++) {
    const list = await request.get(`${base}/inboxes/${inbox}`).catch(() => null);
    const msg = list?.ok() ? ((await list.json()) as { msgs?: Array<{ id: string; subject: string }> }).msgs?.find((m) => /Conferma/.test(m.subject)) : undefined;
    if (msg) {
      for (let j = 0; j < 6; j++) {
        const body = await request.get(`${base}/messages/${msg.id}`).then((r) => r.text()).catch(() => '');
        const m = /conferma-email\?token=([A-Za-z0-9_%-]+)/.exec(body);
        if (m) return decodeURIComponent(m[1]!);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('email di conferma non arrivata entro 2 minuti');
}

test('production: sign up with e-mail confirmation, scan, save, search, delete account', async ({ page, request }, info) => {
  // short names: long Mailinator inboxes were not receiving
  const inbox = `cv${info.project.name.slice(0, 3)}${Date.now().toString(36)}`;
  const email = `${inbox}@mailinator.com`;
  const csp: string[] = [];
  page.on('console', (m) => /Content.Security.Policy|Refused to/i.test(m.text()) && csp.push(m.text()));

  // ---- sign up: no session until the e-mail is confirmed
  await page.goto('/registrati');
  await page.getByLabel('Nome e cognome').fill('Prova Deploy');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByRole('heading', { name: 'Controlla la tua email' })).toBeVisible();

  // ---- the real e-mail arrives; its link activates and signs in
  const token = await confirmationToken(request, inbox);
  await page.goto(`/conferma-email?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: 'Il tuo wallet' })).toBeVisible();

  // ---- scan with on-device OCR, under the production CSP
  await page.getByRole('link', { name: 'Scansiona biglietto' }).first().click();
  await page.locator('input[type=file]:not([capture])').setInputFiles(CARD);
  await page.getByRole('button', { name: 'Conferma' }).click();
  await page.getByRole('button', { name: 'Continua' }).click();
  await expect(page.getByRole('heading', { name: 'Controlla i dati' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByLabel('Cognome')).toHaveValue('Colombo');
  await page.getByRole('button', { name: 'Salva contatto' }).click();
  await expect(page.getByText('Contatto salvato')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Foto' })).toBeVisible(); // encrypted photo round-trip

  // ---- full reload: the session must survive it (refresh cookie)
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Foto' })).toBeVisible();

  // ---- search (pg_trgm + unaccent on Neon)
  await page.goto('/cerca?q=colmbo');
  await expect(page.getByRole('link', { name: /Marta Colombo/ })).toBeVisible();

  // ---- delete the throwaway account from the UI
  await page.goto('/impostazioni');
  await page.getByRole('button', { name: 'Elimina account' }).click();
  await page.getByLabel('Conferma con la password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Elimina definitivamente' }).click();
  await expect(page).toHaveURL(/\/accedi/);
  const login = await request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(login.status()).toBe(401);

  expect(csp, 'CSP violations in production').toEqual([]);
});
