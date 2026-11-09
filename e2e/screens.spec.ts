import { expect, test, type Page } from '@playwright/test';

const PEOPLE = [
  { prefix: 'Ing.', firstName: 'Marta', lastName: 'Colombo', company: 'Cosedil S.p.A.', jobTitle: 'Direttore Tecnico', phones: [{ type: 'work', value: '+39 095 712 4483' }], address: { city: 'Catania' }, tags: ['cantiere'], favorite: true },
  { firstName: 'Fabio', lastName: 'Restivo', company: 'Edil Restivo S.r.l.', jobTitle: 'Geometra', phones: [{ type: 'mobile', value: '+39 347 221 9087' }], address: { city: 'Licata' }, tags: ['fornitori'] },
  { prefix: 'Arch.', firstName: 'Giulia', lastName: 'Bianchi', company: 'Studio Bianchi', jobTitle: 'Socio fondatore', address: { city: 'Milano' }, tags: ['progettisti'] },
  { firstName: 'James', lastName: 'Whitaker', company: 'Northwind Traders Ltd', jobTitle: 'Head of Procurement', address: { city: 'London' } },
  { firstName: 'Salvatore', lastName: 'Greco', company: 'Impianti Sud', jobTitle: 'Responsabile Commerciale', address: { city: 'Catania' }, tags: ['fornitori'] },
];

async function signUp(page: Page, tag: string) {
  const email = `screens-${tag}-${Date.now()}@test.it`;
  const res = await page.request.post('/api/auth/register', {
    data: { email, password: 'una-password-lunga-123', displayName: 'Alessio Prova', acceptPrivacy: true },
  });
  expect(res.status()).toBe(201);
  const { accessToken } = await res.json();
  for (const p of PEOPLE) {
    const r = await page.request.post('/api/contacts', { data: p, headers: { authorization: `Bearer ${accessToken}` } });
    expect(r.ok()).toBe(true);
  }
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page wider than the viewport').toBeLessThanOrEqual(0);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every screen fits the phone (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    const cspErrors: string[] = [];
    page.on('console', (m) => /Content.Security.Policy|Refused to/i.test(m.text()) && cspErrors.push(m.text()));
    await page.goto('/accedi');
    await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
    await noHorizontalScroll(page);
    await page.screenshot({ path: `test-results/screens/${info.project.name}-${scheme}-login.png` });

    await signUp(page, `${info.project.name}-${scheme}`);
    await page.goto('/'); // the refresh cookie set by the API call logs the page in
    await expect(page.getByRole('heading', { name: 'Il tuo wallet' })).toBeVisible();

    const screens: Array<[string, string]> = [
      ['/', 'wallet'],
      ['/cerca?q=catania', 'search'],
      ['/il-mio-biglietto', 'mycard'],
      ['/impostazioni', 'settings'],
      ['/contatti/nuovo', 'new'],
      ['/privacy', 'privacy'],
    ];
    for (const [url, name] of screens) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await noHorizontalScroll(page);
      await page.screenshot({ path: `test-results/screens/${info.project.name}-${scheme}-${name}.png`, fullPage: name !== 'wallet' });
    }
    expect(cspErrors, 'CSP violations').toEqual([]);
  });
}
