// Watching a series: the next episode is one press away. A "Sonraki ›" button and the N key start it; when an
// episode ends a short countdown starts it by itself and can be cancelled; closing the player of an episode leads
// back to that series' episodes, on the season just watched with the episode marked, not to the list of all series;
// the same holds for an episode started from the history, and full screen carries over to the next episode.
// The fixture's series has two episodes, in two seasons. No provider account is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture();
const data = await mkdtemp(path.join(tmpdir(), 'mrt-episodes-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const title = (page: Page) => page.locator('.player-top strong');
const playing = (page: Page) => expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.3);
const dialog = (page: Page) => page.getByRole('dialog');
const next = (page: Page) => page.getByRole('button', { name: 'Sonraki bölüm' });
const finish = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = Math.max(0, v.duration - 0.6); });
async function openSeries(page: Page) {
  await page.getByRole('button', { name: 'Diziler', exact: true }).click();
  await page.getByRole('button', { name: 'Test dizisi', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

const app = await electron.launch({ args: ['scripts/electron-test-main.cjs'], env });
const page = await app.firstWindow();
try {
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await expect(page.getByRole('button', { name: 'Tüm içerikler', exact: true })).toBeVisible();

  // The button: from the first episode (season 1) to the one in season 2; the last episode has none.
  await openSeries(page);
  await page.getByRole('button', { name: /^\d+ Birinci test/ }).click();
  await playing(page);
  await expect(title(page)).toHaveText('Birinci test');
  await expect(next(page)).toBeVisible();
  await next(page).click();
  await expect(title(page)).toHaveText('İkinci test');
  await playing(page);
  await expect(next(page)).toHaveCount(0);

  // Closing the player shows that series' episodes, on the season just watched, with the episode marked.
  await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByLabel('Sezon')).toHaveValue('2');
  await expect(dialog(page).getByRole('button', { name: /^\d+ İkinci test/ })).toContainText('Son izlenen');
  await expect(page.locator('.section-title h2')).toHaveText('Test laboratuvarı'); // the catalogue is still behind it, untouched
  await page.screenshot({ path: 'test-results/episodes-list.png' });

  // The N key, and the countdown when an episode ends: it starts the next one by itself.
  await dialog(page).getByLabel('Sezon').selectOption('1');
  await dialog(page).getByRole('button', { name: /^\d+ Birinci test/ }).click();
  await playing(page);
  await page.locator('.player').focus();
  await page.keyboard.press('n');
  await expect(title(page)).toHaveText('İkinci test');
  await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
  await dialog(page).getByLabel('Sezon').selectOption('1');
  await dialog(page).getByRole('button', { name: /^\d+ Birinci test/ }).click();
  await playing(page);
  await finish(page);
  await expect(page.getByRole('status').filter({ hasText: 'içinde başlıyor' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('status').filter({ hasText: 'İkinci test' })).toBeVisible();
  await page.screenshot({ path: 'test-results/episodes-countdown.png' });
  await expect(title(page)).toHaveText('İkinci test', { timeout: 15000 }); // nothing pressed: it starts by itself
  await playing(page);

  // The countdown can be cancelled, and the episode then stays where it ended.
  await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
  await dialog(page).getByLabel('Sezon').selectOption('1');
  await dialog(page).getByRole('button', { name: /^\d+ Birinci test/ }).click();
  await playing(page);
  await finish(page);
  await expect(page.getByRole('button', { name: 'İptal' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'İptal' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'içinde başlıyor' })).toHaveCount(0);
  await page.waitForTimeout(6500);
  await expect(title(page)).toHaveText('Birinci test');

  // Full screen carries over to the next episode. The test window never completes a native full screen (the request
  // stays pending, for any element), so this checks what the page asks for: the whole page is requested once, and
  // moving to the next episode neither leaves full screen nor asks again.
  await page.evaluate(() => {
    const log: string[] = []; (window as unknown as { __fs: string[] }).__fs = log;
    const request = Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = function (...args) { log.push(`request ${(this as Element).tagName}`); return request.apply(this, args); };
    const exit = Document.prototype.exitFullscreen; Document.prototype.exitFullscreen = function () { log.push('exit'); return exit.call(this); };
  });
  const asked = () => page.evaluate(() => (window as unknown as { __fs: string[] }).__fs);
  await page.getByRole('button', { name: 'Tam ekran', exact: true }).click();
  await expect(page.locator('.player-full')).toBeVisible();
  expect(await asked()).toEqual(['request HTML']);
  await next(page).click();
  await expect(title(page)).toHaveText('İkinci test');
  await expect(page.locator('.player-full')).toBeVisible();
  expect(await asked()).toEqual(['request HTML']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.player-full')).toHaveCount(0);
  await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);

  // An episode started from the history also has its next one and leads back to its series.
  await page.getByRole('button', { name: 'Son izlenenler', exact: true }).click();
  await page.getByRole('button', { name: 'Birinci test', exact: true }).click();
  await playing(page);
  await expect(next(page)).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: /^\d+ Birinci test/ })).toContainText('Son izlenen');

  // A film has no next button, and closing it does not open a series page.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Filmler', exact: true }).click();
  await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
  await page.getByRole('button', { name: 'Filmi oynat' }).click();
  await playing(page);
  await expect(next(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
  await expect(dialog(page)).toHaveCount(0);
  console.log('PASS: Diziler: Sonraki düğmesi ve N tuşu sonraki bölümü açar (sezon geçişi dahil), bölüm bitince geri sayımla kendiliğinden geçer ve iptal edilebilir, oynatıcıyı kapatınca o dizinin bölüm listesi (son izlenen işaretli) açılır, geçmişten açılan bölümde de böyle, tam ekran sonraki bölümde sürer, film etkilenmez.');
} finally { await app.close(); await fixture.close(); await rm(data, { recursive: true, force: true }); }
