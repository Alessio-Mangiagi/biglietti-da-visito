import { expect, test } from '@playwright/test';

const NAMES = [
  ['Giulia', 'Bianchi', 'Studio Bianchi'],
  ['Marta', 'Colombo', 'Cosedil S.p.A.'],
  ['Paolo', 'De Santis', 'Studio Legale Martini'],
  ['Salvatore', 'Greco', 'Impianti Sud'],
  ['Orazio', 'Pappalardo', 'Tecnostrade S.r.l.'],
  ['Fabio', 'Restivo', 'Edil Restivo S.r.l.'],
  ['Antonio', 'Russo', 'Calcestruzzi Etnei'],
  ['James', 'Whitaker', 'Northwind Traders'],
];

test('the rotary card file turns by drag, keys and buttons and opens the front card', async ({ page }, info) => {
  const res = await page.request.post('/api/auth/register', {
    data: { email: `rolo-${info.project.name}-${Date.now()}@test.it`, password: 'una-password-lunga-123', displayName: 'Rolo Prova', acceptPrivacy: true },
  });
  const { accessToken } = await res.json();
  for (const [firstName, lastName, company] of NAMES) {
    await page.request.post('/api/contacts', { data: { firstName, lastName, company, jobTitle: 'Responsabile', address: { city: 'Catania' } }, headers: { authorization: `Bearer ${accessToken}` } });
  }
  await page.goto('/');
  const front = (name: RegExp) => page.getByRole('button', { name });
  await expect(front(/Giulia Bianchi.*Apri il contatto/)).toBeVisible();
  await expect(page.getByText('1 di 8')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/rolodex/${info.project.name}-1-inizio.png` });

  // finger drag upwards: two cards
  const drum = page.getByRole('group', { name: /Biglietti: trascina/ });
  await drum.scrollIntoViewIfNeeded();
      const box = (await drum.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 6 });
  await page.screenshot({ path: `test-results/rolodex/${info.project.name}-2-trascinamento.png` });
  await page.mouse.move(x, y - 115, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByText('3 di 8')).toBeVisible();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `test-results/rolodex/${info.project.name}-3-dopo.png` });

  // keyboard and buttons
  await drum.focus();
  await page.keyboard.press('End');
  await expect(page.getByText('8 di 8')).toBeVisible();
  await page.getByRole('button', { name: 'Biglietto precedente' }).click();
  await expect(page.getByText('7 di 8')).toBeVisible();
  await drum.focus();
  await page.keyboard.press('Home');
  await expect(page.getByText('1 di 8')).toBeVisible();

  // swipe the front card sideways: it goes to the back, the next one comes forward
  const fbox = (await front(/Giulia Bianchi.*Apri il contatto/).boundingBox())!;
  const cy = fbox.y + fbox.height / 2;
  await page.mouse.move(fbox.x + fbox.width / 2, cy);
  await page.mouse.down();
  await page.mouse.move(fbox.x + fbox.width / 2 - 70, cy + 4, { steps: 5 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `test-results/rolodex/${info.project.name}-4-swipe.png` }).catch(() => {});
  await page.mouse.move(fbox.x + fbox.width / 2 - 200, cy + 8, { steps: 5 });
  await page.mouse.up();
  await expect(front(/Marta Colombo.*Apri il contatto/)).toBeVisible();
  await expect(page.getByText('1 di 8')).toBeVisible();
  await drum.focus();
  await page.keyboard.press('End');
  await expect(front(/Giulia Bianchi.*Apri il contatto/)).toBeVisible(); // now the last card
  // ← / → do the same from the keyboard
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(front(/Paolo De Santis.*Apri il contatto/)).toBeVisible();
  await page.keyboard.press('Home');
  await expect(front(/Paolo De Santis.*Apri il contatto/)).toBeVisible();

  // order now: De Santis … Whitaker, Bianchi, Colombo — tapping the front card opens it
  await page.keyboard.press('End');
  await expect(page.getByText('8 di 8')).toBeVisible();
  await expect(front(/Marta Colombo.*Apri il contatto/)).toBeVisible();
  await page.waitForTimeout(500);
  await front(/Marta Colombo.*Apri il contatto/).click();
  await expect(page).toHaveURL(/\/contatti\//);
  await expect(page.getByRole('button', { name: 'Rubrica' })).toBeVisible();
});
