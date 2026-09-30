// Posters and channel logos in the lists: off by default (no picture host is contacted until the
// viewer turns them on), then they show next to the name, fall back to the initials when a
// picture is missing, can be switched off again, and never put a provider address in the page
// or in the library file. No provider account or media is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture({ icons: true });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-posters-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;

async function open() {
  const app = await electron.launch({ args: ['scripts/electron-test-main.cjs'], env });
  const page = await app.firstWindow();
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await expect(page.getByRole('button', { name: 'Tüm içerikler', exact: true })).toBeVisible();
  return { app, page };
}
const ready = (page: Page) => page.locator('img.poster-image.ready');
const size = (page: Page) => ready(page).first().evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
const saved = (page: Page) => page.waitForTimeout(900); // preferences and favourites are saved on a short debounce

try {
  {
    const { app, page } = await open();
    try {
      // Out of the box nothing is requested: no picture element, and the picture host sees nothing,
      // however many lists are opened.
      await expect(page.getByRole('button', { name: 'Sentetik test yayını', exact: true })).toBeVisible();
      for (const name of ['Filmler', 'Diziler', 'Canlı TV']) { await page.getByRole('button', { name, exact: true }).click(); await page.waitForTimeout(400); }
      await expect(page.locator('img')).toHaveCount(0);
      expect(fixture.iconRequests()).toEqual([]);
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      await expect(page.getByLabel('Kanal ve film afişlerini göster')).not.toBeChecked();
      await expect(page.getByText('üçüncü taraf')).toBeVisible();
      await page.getByLabel('Kanal ve film afişlerini göster').check();
      await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();

      // Live: channel one has a logo, channel two's address answers 404 and falls back to initials.
      const first = page.getByRole('button', { name: 'Sentetik test yayını', exact: true }), second = page.getByRole('button', { name: 'İstanbul test deseni', exact: true });
      await expect(ready(page)).toHaveCount(1);
      await expect(first.locator('img.poster-image.ready')).toHaveCount(1);
      await expect(first.locator('.tile-initials')).toHaveCount(0);
      await expect(second.locator('.tile-initials')).toHaveText('İS');
      await expect(second.locator('img.poster-image')).toHaveCount(0);
      expect(await size(page)).toEqual([64, 96]);
      // The page only ever asks the app for pictures; the provider's address is not in it.
      const sources = await page.locator('img').evaluateAll(list => list.map(img => (img as HTMLImageElement).src));
      expect(sources.length).toBeGreaterThan(0);
      expect(sources.every(src => src.startsWith('kiyi://image/'))).toBe(true);
      expect(await page.content()).not.toContain('/icons/');
      expect(fixture.iconRequests()).toContain('/icons/1.png');
      // Pictures do not get in the way of playing.
      await first.click();
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(1);
      await expect(ready(page)).toHaveCount(1);

      // Films and series: the picture fills the poster and the name stays under it.
      await page.getByRole('button', { name: 'Filmler', exact: true }).click();
      await expect(ready(page)).toHaveCount(1);
      expect(await size(page)).toEqual([64, 96]);
      // The picture stays inside its card, and the name sits on top of it rather than under it.
      await expect(page.locator('.tile-name')).toHaveText('Test filmi');
      const fits = await page.locator('.tile-poster').first().evaluate(card => {
        const frame = card.getBoundingClientRect(), picture = card.querySelector('img.poster-image')!.getBoundingClientRect(), name = card.querySelector('.tile-name')!.getBoundingClientRect();
        const top = document.elementFromPoint(name.left + name.width / 2, name.top + name.height - 8);
        return { inside: picture.top >= frame.top - 1 && picture.bottom <= frame.bottom + 1 && picture.left >= frame.left - 1 && picture.right <= frame.right + 1, nameOnTop: !!top && !!top.closest('.tile-name, .content-select') };
      });
      expect(fits).toEqual({ inside: true, nameOnTop: true });
      await page.getByRole('button', { name: 'Test filmi favorilere ekle' }).click();
      await page.getByRole('button', { name: 'Diziler', exact: true }).click();
      await expect(ready(page)).toHaveCount(1);

      // Off: no picture element at all; on again: back.
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      await page.getByLabel('Kanal ve film afişlerini göster').uncheck();
      await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
      await expect(first).toBeVisible();
      await expect(page.locator('img.poster-image')).toHaveCount(0);
      await expect(first.locator('.tile-initials')).toHaveText('SE');
      await page.getByRole('button', { name: 'Filmler', exact: true }).click();
      await expect(page.locator('.tile-name')).toHaveText('Test filmi');
      await expect(page.locator('.tile-art svg')).toHaveCount(1); // the film icon stands in for the poster
      await expect(page.locator('img.poster-image')).toHaveCount(0);
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      await page.getByLabel('Kanal ve film afişlerini göster').check();
      await page.getByRole('button', { name: 'Filmler', exact: true }).click();
      await expect(ready(page)).toHaveCount(1);
      await saved(page);
    } finally { await app.close(); }
    // Only what the page can list without the catalogue is kept: the favourite film and the channel that was watched.
    const icons = (await readdir(data)).find(name => /^icons-[a-f0-9]{24}\.json$/.test(name));
    expect(JSON.parse(await readFile(path.join(data, icons!), 'utf8'))).toEqual({ 'live:1': expect.stringMatching(/\/icons\/1\.png$/), 'vod:3': expect.stringMatching(/\/icons\/3\.png$/) });
  }
  {
    // A new run that only opened the live list: the favourite film's poster still appears,
    // because its address was kept by the app on the side, and the library file has none.
    const { app, page } = await open();
    try {
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await expect(page.getByRole('button', { name: 'Test filmi', exact: true })).toBeVisible();
      await expect(ready(page)).toHaveCount(1);
      expect(await size(page)).toEqual([64, 96]);
      // The setting was kept. Turning it off empties the side file at once.
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      await expect(page.getByLabel('Kanal ve film afişlerini göster')).toBeChecked();
      await page.getByLabel('Kanal ve film afişlerini göster').uncheck();
      await saved(page);
    } finally { await app.close(); }
    const files = await readdir(data);
    const library = files.find(name => /^library-[a-f0-9]{24}\.json$/.test(name)), icons = files.find(name => /^icons-[a-f0-9]{24}\.json$/.test(name));
    expect(library && icons).toBeTruthy();
    expect(await readFile(path.join(data, library!), 'utf8')).not.toContain('/icons/');
    expect(JSON.parse(await readFile(path.join(data, library!), 'utf8')).preferences.posters).toBe(false);
    expect(JSON.parse(await readFile(path.join(data, icons!), 'utf8'))).toEqual({});
  }
  console.log('PASS: Afişler: varsayılan kapalı ve hiç istek yok, açılınca logo/afiş ve ad birlikte, eksik görselde baş harfler, kapatılınca görsel ve diskteki adres yok, sayfada ve kitaplıkta sağlayıcı adresi yok, favori afişi yeniden başlatmada kalıyor.');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
