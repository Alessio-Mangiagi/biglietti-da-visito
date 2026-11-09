import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** WCAG 2.1 AA checks (contrast, labels, landmarks, names) on the main screens, light and dark. */
async function audit(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(summary, `axe on ${name}`).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`accessibility (${scheme})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'android-chromium', 'axe once is enough');
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/accedi');
    await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
    await audit(page, 'login');

    const res = await page.request.post('/api/auth/register', {
      data: { email: `a11y-${scheme}-${Date.now()}@test.it`, password: 'una-password-lunga-123', displayName: 'Ada Prova', acceptPrivacy: true },
    });
    const { accessToken } = await res.json();
    await page.request.post('/api/contacts', {
      data: { firstName: 'Marta', lastName: 'Colombo', company: 'Cosedil S.p.A.', jobTitle: 'Direttore Tecnico', tags: ['cantiere'], favorite: true },
      headers: { authorization: `Bearer ${accessToken}` },
    });

    for (const [url, name] of [
      ['/', 'wallet'],
      ['/cerca?q=marta', 'search'],
      ['/contatti/nuovo', 'new contact'],
      ['/il-mio-biglietto', 'my card'],
      ['/impostazioni', 'settings'],
      ['/privacy', 'privacy'],
    ] as const) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await audit(page, name);
    }
    await page.goto('/');
    await page.getByRole('link', { name: /Marta Colombo/ }).click();
    await expect(page.getByRole('button', { name: 'Rubrica' })).toBeVisible();
    await audit(page, 'detail');
  });
}
