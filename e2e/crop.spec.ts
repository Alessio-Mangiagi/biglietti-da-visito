import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const CARD = join(import.meta.dirname, 'fixtures', 'card-cosedil.jpg');

// real touch sequences need the Chrome DevTools protocol: Chromium only
test('crop: the page scrolls from anywhere on the photo, corners drag without scrolling', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium' || !info.project.use.hasTouch, 'touch events via CDP');
  await page.request.post('/api/auth/register', {
    data: { email: `crop-${info.project.name}-${Date.now()}@test.it`, password: 'una-password-lunga-123', displayName: 'Crop', acceptPrivacy: true },
  });
  await page.setViewportSize({ width: 412, height: 560 }); // short screen: the page must scroll
  await page.goto('/scansiona');
  await page.locator('input[type=file]:not([capture])').setInputFiles(CARD);
  await expect(page.getByText('Bordi trovati automaticamente')).toBeVisible();

  // the navy stripe along the left edge belongs to the card (colour edges)
  const tl = (await page.getByRole('slider').first().getAttribute('aria-valuetext'))!.split(', ').map(Number);
  expect(tl[0]).toBeLessThan(226);

  const cdp = await page.context().newCDPSession(page);
  const swipe = async (from: [number, number], step: [number, number], n: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1] }] });
    for (let i = 1; i <= n; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from[0] + step[0] * i, y: from[1] + step[1] * i }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  // a swipe up in the middle of the photo scrolls the page
  const box = (await page.locator('.crop').boundingBox())!;
  const y0 = await page.evaluate(() => scrollY);
  await swipe([box.x + box.width / 2, box.y + box.height * 0.6], [0, -15], 11);
  await page.waitForTimeout(300);
  const y1 = await page.evaluate(() => scrollY);
  expect(y1).toBeGreaterThan(y0 + 40);

  // a touch next to a corner (not exactly on it) drags it, and the page stays put
  const corner = page.getByRole('slider').first();
  const h = (await corner.boundingBox())!;
  const before = await corner.getAttribute('aria-valuetext');
  await swipe([h.x + h.width / 2 + 10, h.y + h.height / 2 + 8], [3, 4], 9);
  await expect(corner).not.toHaveAttribute('aria-valuetext', before!);
  expect(Math.abs((await page.evaluate(() => scrollY)) - y1)).toBeLessThan(3);

  // "Rileva bordi" starts from the moved corners and snaps them back onto the card
  await page.getByRole('button', { name: 'Rileva bordi' }).click();
  await expect(corner).toHaveAttribute('aria-valuetext', before!);
});
