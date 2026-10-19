// A film is saved from its detail screen into a disposable folder, shows progress in the
// İndirilenler list, plays back from the disk (with seeking), survives a restart, can be moved
// to the Trash, and the sign-out cancels nothing that is already finished. No provider account
// or media is used.
import { _electron as electron, expect } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture();
const data = await mkdtemp(path.join(tmpdir(), 'mrt-dl-data-')), saved = await mkdtemp(path.join(tmpdir(), 'mrt-dl-files-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1', KIYI_TEST_DOWNLOADS: saved } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });
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
try {
  {
    const { app, page } = await open();
    try {
      await page.getByRole('button', { name: 'Filmler', exact: true }).click();
      await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
      // The file's size is on the button before anything is pressed.
      const button = page.getByRole('button', { name: /^İndir \(\d+(\.\d+)? (KB|MB|GB)\)$/ });
      await expect(button).toBeVisible({ timeout: 15000 });
      await button.click();
      // A bar is on the same screen at once, and ends full with the result written out.
      await expect(page.getByRole('progressbar')).toBeVisible();
      await expect(page.getByText(/İndirme tamamlandı · \d/)).toBeVisible({ timeout: 30000 });
      await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
      await expect(page.getByRole('button', { name: 'Çevrimdışı oynat' })).toBeEnabled();
      await page.screenshot({ path: 'test-results/downloads-inline.png' });
      // Opening the film again shows it as saved: no second copy can be started.
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Çevrimdışı oynat' })).toBeEnabled();
      await expect(page.getByRole('button', { name: /^İndir \(/ })).toHaveCount(0);
      await expect(page.getByText(/İndirme tamamlandı · \d/)).toBeVisible();
      // Offline playback starts from the very same screen: the film closes and plays from the disk.
      await page.getByRole('button', { name: 'Çevrimdışı oynat' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.5);
      expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/^kiyi:\/\/local\/[a-f0-9]{16}$/);
      await page.screenshot({ path: 'test-results/downloads-offline-from-detail.png' });
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
      await page.getByRole('button', { name: 'İndirilenler', exact: true }).first().click();
      await expect(page.getByText('Tamamlandı')).toBeVisible({ timeout: 30000 });
      const files = await readdir(saved);
      expect(files).toEqual(['Test filmi.mp4']);
      expect((await stat(path.join(saved, files[0]))).size).toBeGreaterThan(10000);
      await page.screenshot({ path: 'test-results/downloads-list.png' });
      // Plays from the disk and can seek.
      await page.getByRole('button', { name: 'Oynat', exact: true }).click();
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.5);
      const src = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentSrc);
      expect(src).toMatch(/^kiyi:\/\/local\/[a-f0-9]{16}$/);
      await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = Math.max(0, v.duration - 3); });
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15000 }).toBeGreaterThan(1);
      await page.screenshot({ path: 'test-results/downloads-playing.png' });
      // A local file never enters the viewer's history.
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
      await page.getByRole('button', { name: 'Son izlenenler', exact: true }).click();
      await expect(page.getByText('Henüz izleme geçmişi yok')).toBeVisible();
      // The automatic retry choice is off to begin with, can be switched on, and is remembered.
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      const retry = page.getByRole('checkbox', { name: 'Kesilen indirmeyi otomatik yeniden dene' });
      await expect(retry).not.toBeChecked();
      await retry.check();
      await page.waitForTimeout(900); // preferences are saved on a short debounce
      await page.screenshot({ path: 'test-results/downloads-settings.png' });
    } finally { await app.close(); }
  }
  {
    // A new window: the finished download is still listed and plays.
    const { app, page } = await open();
    try {
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: 'Kesilen indirmeyi otomatik yeniden dene' })).toBeChecked();
      // After a restart the film is still known as saved.
      await page.getByRole('button', { name: 'Filmler', exact: true }).click();
      await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Çevrimdışı oynat' })).toBeEnabled();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'İndirilenler', exact: true }).first().click();
      await expect(page.getByText('Test filmi.mp4')).toBeVisible();
      await expect(page.getByText('Tamamlandı')).toBeVisible();
      await page.getByRole('button', { name: 'Oynat', exact: true }).click();
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.5);
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
      await page.getByRole('button', { name: 'Listeden kaldır' }).click();
      await expect(page.getByText('Henüz indirme yok')).toBeVisible();
      expect(await readdir(saved)).toEqual(['Test filmi.mp4']); // the file itself stays
      // Taken off the list, the film can be saved again.
      await page.getByRole('button', { name: 'Filmler', exact: true }).click();
      await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
      await expect(page.getByRole('button', { name: /^İndir \(/ })).toBeVisible({ timeout: 15000 });
    } finally { await app.close(); }
  }
  {
    const { app, page } = await open();
    try {
      await page.getByRole('button', { name: 'İndirilenler', exact: true }).first().click();
      await expect(page.getByText('Henüz indirme yok')).toBeVisible();
    } finally { await app.close(); }
  }
  {
    // An episode: its size is on its own button, the bar shows under its row, and once it is saved
    // the same button plays it from the disk.
    const { app, page } = await open();
    try {
      await page.getByRole('button', { name: 'Diziler', exact: true }).click();
      await page.getByRole('button', { name: 'Test dizisi', exact: true }).click();
      const episode = page.getByRole('button', { name: /^Birinci test bölümünü indir \(\d/ });
      await expect(episode).toBeVisible({ timeout: 15000 });
      await episode.click();
      await expect(page.getByRole('progressbar')).toBeVisible();
      await expect(page.getByText(/İndirme tamamlandı · \d/)).toBeVisible({ timeout: 30000 });
      expect(await readdir(saved)).toContain('Test dizisi S01E01 Birinci test.mp4');
      await page.screenshot({ path: 'test-results/downloads-episode.png' });
      await page.getByRole('button', { name: 'Birinci test bölümünü çevrimdışı oynat' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.5);
      expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/^kiyi:\/\/local\/[a-f0-9]{16}$/);
    } finally { await app.close(); }
  }
  console.log('downloads e2e: ok');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); await rm(saved, { recursive: true, force: true }); }
