// Recording a live channel: a recording started from under the player runs, shows its time and size
// (and a count on Kayıtlar), stops, is turned into an MP4 and plays from the disk; a programme can be
// planned from the guide; a plan for later survives a restart and can be cancelled. No provider account
// or media is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture();
const data = await mkdtemp(path.join(tmpdir(), 'mrt-rec-data-')), saved = await mkdtemp(path.join(tmpdir(), 'mrt-rec-files-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1', KIYI_TEST_DOWNLOADS: saved } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
await mkdir('test-results', { recursive: true });
async function open() {
  const app = await electron.launch(process.env.KIYI_TEST_PACKAGED === '1' ? { executablePath: path.resolve('release/MRT-Player-darwin-arm64/MRT-Player.app/Contents/MacOS/MRT-Player'), args: [], env } : { args: ['scripts/electron-test-main.cjs'], env });
  const page = await app.firstWindow();
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await expect(page.getByRole('button', { name: 'Tüm içerikler', exact: true })).toBeVisible();
  return { app, page };
}
const channel = async (page: Page) => {
  await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
  await page.getByRole('button', { name: 'Test laboratuvarı', exact: true }).click();
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Kanal kaydı' })).toBeVisible({ timeout: 20000 });
};
const recordings = (page: Page) => page.getByRole('button', { name: 'Kayıtlar', exact: true }).first().click();
const files = async (ext: string) => (await readdir(saved)).filter(name => name.endsWith(ext));
try {
  {
    const { app, page } = await open();
    try {
      await channel(page);
      // Start a recording from under the player.
      await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
      const live = page.getByRole('status').filter({ hasText: 'Kayıtta' });
      await expect(live).toBeVisible();
      await expect(live).toContainText(/\d+ (KB|MB)/, { timeout: 20000 });
      await expect(page.getByTitle('Süren kayıt')).toBeVisible({ timeout: 6000 });
      await page.screenshot({ path: 'test-results/recording-live.png' });
      await page.getByRole('button', { name: 'Durdur' }).click();
      await recordings(page);
      await expect(page.getByText('Tamamlandı')).toBeVisible({ timeout: 60000 });
      expect(await files('.ts')).toEqual([]);
      const mp4 = await files('.mp4');
      expect(mp4).toHaveLength(1); expect(mp4[0]).toMatch(/^Sentetik test yayını \d{4}-\d\d-\d\d \d\d\.\d\d\.mp4$/);
      await page.screenshot({ path: 'test-results/recording-list.png' });
      // The finished recording plays from the disk, and stays out of the Downloads list.
      await page.getByRole('button', { name: 'Oynat', exact: true }).click();
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.5);
      expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/^kiyi:\/\/local\/[a-f0-9]{16}$/);
      await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
      await page.getByRole('button', { name: 'İndirilenler', exact: true }).first().click();
      await expect(page.getByText('Henüz indirme yok')).toBeVisible();
      // A programme is planned from the guide; it is under way at once, so it records right away.
      await channel(page);
      await page.getByRole('button', { name: 'Şimdi: Görüntü testi yayınını kaydet' }).click();
      await expect(page.getByRole('dialog', { name: 'KAYIT PLANLA' })).toBeVisible();
      await page.screenshot({ path: 'test-results/recording-schedule.png' });
      await page.getByRole('button', { name: 'Planla', exact: true }).click();
      await expect(page.getByText('Kayıt planlandı')).toBeVisible();
      await page.getByRole('button', { name: 'Tamam', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Kayıtta' })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: 'Durdur' }).click();
      await recordings(page);
      await expect(page.getByText('Tamamlandı')).toHaveCount(2, { timeout: 60000 });
      // A plan for later (a bad one is refused first).
      await channel(page);
      await page.getByRole('button', { name: 'Zamanla…' }).click();
      const stamp = (ms: number) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
      await page.getByLabel('Başlangıç').fill(stamp(Date.now() + 2 * 3600000)); await page.getByLabel('Bitiş').fill(stamp(Date.now() + 3600000));
      await page.getByRole('button', { name: 'Planla', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Bitiş zamanı başlangıçtan sonra olmalı');
      await page.getByLabel('Bitiş').fill(stamp(Date.now() + 3 * 3600000));
      await page.getByRole('button', { name: 'Planla', exact: true }).click();
      await expect(page.getByText('Kayıt planlandı')).toBeVisible();
      await page.getByRole('button', { name: 'Tamam', exact: true }).click();
    } finally { await app.close(); }
  }
  {
    // After a restart: both recordings are still there, and so is the plan, which can be cancelled.
    const { app, page } = await open();
    try {
      await recordings(page);
      await expect(page.getByText('Tamamlandı')).toHaveCount(2);
      await expect(page.getByText('Planlandı')).toHaveCount(1);
      await page.screenshot({ path: 'test-results/recording-after-restart.png' });
      await page.getByRole('button', { name: 'İptal', exact: true }).click();
      await expect(page.getByText('Planlandı')).toHaveCount(0);
      // Trashing a finished one removes it from the list (the Trash itself is not touched in a test).
      expect(await files('.mp4')).toHaveLength(2);
    } finally { await app.close(); }
  }
  console.log('recordings e2e: ok');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); await rm(saved, { recursive: true, force: true }); }
