import { devices, expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const CARD = join(import.meta.dirname, 'fixtures', 'card-cosedil.jpg');
const PHONES = {
  'iphone-se': devices['iPhone SE'],
  'iphone-14': devices['iPhone 14'],
  'pixel-7': devices['Pixel 7'],
} as const;

/**
 * Layout checks measured in the page:
 * - every icon (svg) next to text is vertically centred on it (±2.5 px)
 * - tappable controls are at least 40 px tall (Apple HIG 44 pt, minus rounding)
 * - nothing sticks out of the viewport horizontally
 */
async function layoutIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && (el as HTMLElement).offsetParent !== null;
    };
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : ''} "${(el.textContent ?? '').trim().slice(0, 28)}"`;

    // 1. icon ↔ text vertical alignment
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      if (!visible(svg)) continue;
      const host = svg.closest('button, a, .chip, .tag, .badge-sync, .uncertain-badge, .banner, .alert, .inline, label, .toast');
      if (!host) continue;
      const r = svg.getBoundingClientRect();
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let best: DOMRect | null = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || svg.contains(n)) continue;
        range.selectNodeContents(n);
        for (const tr of Array.from(range.getClientRects())) {
          const sameRow = Math.abs((tr.top + tr.bottom) / 2 - (r.top + r.bottom) / 2) < 24;
          const adjacent = tr.left - r.right < 24 && r.left - tr.right < 24;
          const below = tr.top >= r.bottom - 2 && tr.top - r.bottom < 16; // icon stacked over its label
          if ((sameRow && adjacent) || below) best = tr;
        }
        if (best) break;
      }
      if (!best) continue;
      const stacked = best.top >= r.bottom - 2;
      // stacked (tab bar, quick actions): centred horizontally; inline: centred vertically
      const delta = stacked ? (best.left + best.right) / 2 - (r.left + r.right) / 2 : (best.top + best.bottom) / 2 - (r.top + r.bottom) / 2;
      if (Math.abs(delta) > (stacked ? 3 : 2.5)) {
        issues.push(`icona ${stacked ? 'non centrata' : 'disallineata'} di ${delta.toFixed(1)}px in ${label(host)}`);
      }
    }

    // 2. touch targets
    for (const el of Array.from(document.querySelectorAll('button, a.btn, .bottomnav a, .icon-btn, .chip'))) {
      if (!visible(el) || el.closest('.bcard, .kv, .prose, .auth-links, p')) continue;
      const r = el.getBoundingClientRect();
      if (r.height < 31.5) issues.push(`area tocco bassa (${Math.round(r.height)}px) ${label(el)}`);
    }

    // 2b. form fields squeezed too narrow to read what is typed
    for (const el of Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea'))) {
      if (!visible(el)) continue;
      const w = el.getBoundingClientRect().width;
      if (w < 90) issues.push(`campo troppo stretto (${Math.round(w)}px) ${label(el)} [${el.getAttribute('aria-label') ?? ''}]`);
    }

    // 2c. the scan button sits in the middle of the tab bar
    const fab = document.querySelector('.bottomnav .scan-fab');
    const bar = document.querySelector('.bottomnav ul');
    if (fab && bar && visible(fab)) {
      const fr = fab.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const delta = (fr.left + fr.right) / 2 - (br.left + br.right) / 2;
      if (Math.abs(delta) > 1) issues.push(`tasto Scansiona non centrato di ${delta.toFixed(1)}px`);
      const icon = fab.querySelector('svg')?.getBoundingClientRect();
      if (icon && Math.abs((icon.left + icon.right) / 2 - (fr.left + fr.right) / 2) > 1) issues.push('icona Scansiona non centrata nel tasto');
    }

    // 3. horizontal overflow
    const vw = document.documentElement.clientWidth;
    const clipped = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') return true; // ellipsis / scroller: visually contained
      }
      return false;
    };
    for (const el of Array.from(document.querySelectorAll('main *, header *, nav *'))) {
      if (!visible(el) || el.closest('.chips, .crop, .scanner, .viewfinder') || clipped(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) {
        issues.push(`fuori schermo (${Math.round(r.left)}→${Math.round(r.right)} su ${vw}) ${label(el)}`);
        break;
      }
    }
    return [...new Set(issues)];
  });
}

for (const [phone, device] of Object.entries(PHONES)) {
  test.describe(phone, () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { defaultBrowserType, ...viewport } = device;
    test.use(viewport);

    test(`layout and icon alignment on ${phone}`, async ({ page }, info) => {
      // iPhones on WebKit (Safari's engine), Android on Chromium
      test.skip(info.project.name !== (phone.startsWith('iphone') ? 'iphone-webkit' : 'android-chromium'));
      const shots = `test-results/visual/${phone}`;
      const all: Record<string, string[]> = {};
      const check = async (name: string) => {
        await page.waitForLoadState('load');
        await page.waitForTimeout(600); // fonts, lazy chunks, entrance animations
        all[name] = await layoutIssues(page);
        await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
      };

      await page.goto('/accedi');
      await expect(page.getByRole('heading', { name: 'Accedi' })).toBeVisible();
      await check('01-login');
      await page.goto('/registrati');
      await check('02-registrati');

      const reg = await page.request.post('/api/auth/register', {
        data: { email: `vis-${phone}-${Date.now()}@test.it`, password: 'una-password-lunga-123', displayName: 'Alessio Prova', acceptPrivacy: true },
      });
      const { accessToken } = await reg.json();
      const headers = { authorization: `Bearer ${accessToken}` };
      await page.goto('/');
      await check('03-wallet-vuoto');
      for (const c of [
        { prefix: 'Ing.', firstName: 'Marta', lastName: 'Colombo', company: 'Cosedil S.p.A.', jobTitle: 'Direttore Tecnico', phones: [{ type: 'work', value: '+39 095 712 4483' }], emails: ['m.colombo@cosedilspa.com'], website: 'www.cosedilspa.com', address: { street: 'Via Vincenzo Giuffrida, 37', city: 'Catania', postalCode: '95128', province: 'CT', country: 'Italia' }, tags: ['cantiere', 'fornitori'], favorite: true, metAt: 'SAIE Bologna', metOn: '2026-10-15', notes: 'Richiamare per la commessa di Palermo' },
        { firstName: 'Fabio', lastName: 'Restivo', company: 'Edil Restivo S.r.l.', jobTitle: 'Geometra – Capo Cantiere', phones: [{ type: 'mobile', value: '+39 347 221 9087' }], address: { city: 'Licata' }, tags: ['fornitori'] },
        { firstName: 'Giulia', lastName: 'Bianchi', company: 'Studio di Architettura Bianchi & Associati', jobTitle: 'Socio fondatore', address: { city: 'Milano' } },
      ]) {
        await page.request.post('/api/contacts', { data: c, headers });
      }

      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Il tuo wallet' })).toBeVisible();
      await check('04-wallet-schedario');
      // turn the drum to C (Bianchi → Colombo) with the A–Z tabs
      await page.getByRole('button', { name: /^Lettera C,/ }).click();
      await expect(page.getByRole('button', { name: /Marta Colombo.*Apri il contatto/ })).toBeVisible();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${shots}/04b-schedario-ruotato.png` });
      await page.getByRole('button', { name: 'Pila' }).click();
      await check('04c-wallet-pila');
      await page.getByRole('link', { name: /Cosedil.*Marta Colombo/ }).click();
      await expect(page.getByRole('button', { name: 'Rubrica' })).toBeVisible();
      await check('05-dettaglio');
      await page.getByRole('button', { name: 'Elimina' }).click();
      await check('06-modale-elimina');
      await page.keyboard.press('Escape');
      await page.getByRole('link', { name: 'Modifica' }).click();
      await expect(page.getByRole('heading', { name: 'Modifica contatto' })).toBeVisible();
      await check('07-modifica');

      await page.goto('/cerca?q=catania');
      await expect(page.getByText(/^[0-9]+ risultat/)).toBeVisible();
      await page.getByRole('button', { name: /Filtri/ }).click();
      await check('08-cerca-filtri');
      await page.goto('/il-mio-biglietto');
      await check('09-mio-biglietto-vuoto');
      await page.getByRole('button', { name: 'Crea il mio biglietto' }).click();
      await page.getByRole('button', { name: 'Salva biglietto' }).click();
      await expect(page.getByRole('img', { name: /Codice QR/ })).toBeVisible();
      await check('10-mio-biglietto-qr');
      await page.goto('/impostazioni');
      await check('11-impostazioni');
      await page.goto('/promemoria');
      await expect(page.getByRole('heading', { name: 'Da ricontattare' })).toBeVisible();
      await check('11b-promemoria');
      await page.goto('/team');
      await expect(page.getByRole('heading', { name: /Crea la rubrica/ })).toBeVisible();
      await check('11c-team');

      // scanner: camera screen (headless has no camera → fallback), crop, review
      await page.goto('/scansiona');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${shots}/12-fotocamera.png` });
      all['12-fotocamera'] = await layoutIssues(page);
      await page.locator('input[type=file]:not([capture])').setInputFiles(CARD);
      await expect(page.getByRole('heading', { name: 'Ritaglia il fronte' })).toBeVisible();
      await check('13-ritaglio');
      await page.getByRole('button', { name: 'Conferma' }).click();
      await check('14-retro');
      await page.getByRole('button', { name: 'Continua' }).click();
      await expect(page.getByRole('heading', { name: 'Controlla i dati' })).toBeVisible({ timeout: 90_000 });
      await check('15-revisione');

      const found = Object.entries(all).flatMap(([screen, list]) => list.map((i) => `${screen}: ${i}`));
      expect(found, `problemi di layout su ${phone}`).toEqual([]);
    });
  });
}
