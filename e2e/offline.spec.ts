import { expect, test } from '@playwright/test';

test('a contact saved offline is queued and synced when the network returns', async ({ page, context }, info) => {
  const email = `offline-${info.project.name}-${Date.now()}@test.it`;
  const res = await page.request.post('/api/auth/register', {
    data: { email, password: 'una-password-lunga-123', displayName: 'Offline Prova', acceptPrivacy: true },
  });
  expect(res.status()).toBe(201);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Il tuo wallet' })).toBeVisible();

  // in-app navigation, then the connection drops
  await page.getByRole('link', { name: 'Inserisci a mano' }).click();
  await expect(page.getByRole('heading', { name: 'Nuovo contatto' })).toBeVisible();
  await context.setOffline(true);
  await page.getByLabel('Nome', { exact: true }).fill('Paolo');
  await page.getByLabel('Cognome').fill('Senzarete');
  await page.getByLabel('Azienda').fill('Cantiere Galleria');
  await page.getByRole('button', { name: 'Salva contatto' }).click();
  await expect(page.getByText('Salvato sul dispositivo')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Da sincronizzare' })).toBeVisible();
  await expect(page.getByText('Sei offline')).toBeVisible();

  // back online: the outbox flushes and the card joins the wallet
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('heading', { name: 'Da sincronizzare' })).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: /Paolo Senzarete, Cantiere Galleria/ })).toBeVisible();
});
