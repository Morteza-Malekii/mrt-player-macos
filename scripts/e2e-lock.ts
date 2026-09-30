// List locks: a category can be locked with a PIN, its channels then disappear everywhere
// (category, all contents, favourites), a PIN opens them for the window, and the lock survives
// a restart. No provider account or media is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PIN = '4821', CATEGORY = 'Test laboratuvarı', CHANNEL = 'Sentetik test yayını';
const fixture = await createFixture();
const data = await mkdtemp(path.join(tmpdir(), 'mrt-lock-'));
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
const channel = (page: Page) => page.getByRole('button', { name: CHANNEL, exact: true });
const pin = (page: Page, value: string, label = 'PIN') => page.getByLabel(label, { exact: true }).fill(value);
const dialog = (page: Page) => page.getByRole('dialog');
const saved = (page: Page) => page.waitForTimeout(900); // preferences and locks are saved on a short debounce

try {
  {
    const { app, page } = await open();
    try {
      await expect(channel(page)).toBeVisible();
      // First lock asks for a PIN; a short or mismatched one is refused.
      await page.getByRole('button', { name: `${CATEGORY} listesini kilitle` }).click();
      await pin(page, '12'); await pin(page, '12', 'PIN’i tekrarlayın');
      await dialog(page).getByRole('button', { name: 'Kaydet' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('4 ile 8 rakam');
      await pin(page, PIN); await pin(page, '9999', 'PIN’i tekrarlayın');
      await dialog(page).getByRole('button', { name: 'Kaydet' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('aynı değil');
      await pin(page, PIN, 'PIN’i tekrarlayın');
      await dialog(page).getByRole('button', { name: 'Kaydet' }).click();
      await expect(dialog(page)).toHaveCount(0);

      // Locked: the list itself, the all-contents list and the sidebar all agree.
      await expect(page.getByRole('heading', { name: 'Bu liste kilitli' })).toBeVisible();
      await expect(channel(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Tüm içerikler', exact: true }).click();
      await expect(page.getByText('0 içerik')).toBeVisible();
      await expect(channel(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Kilitli listeleri aç' })).toBeVisible();

      // Escape closes the dialog and nothing else; a wrong PIN is refused; the right one opens it.
      await page.getByRole('button', { name: 'Kilitli listeleri aç' }).click();
      await expect(dialog(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Kilitli listeleri aç' }).click();
      await pin(page, '0000'); await dialog(page).getByRole('button', { name: 'Aç' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('PIN yanlış');
      await pin(page, PIN); await dialog(page).getByRole('button', { name: 'Aç' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(channel(page)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Listeleri yeniden kilitle' })).toBeVisible();

      // Watch it and favourite it, then lock again: playback stops and the favourite disappears.
      await channel(page).click();
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(1);
      await page.getByRole('button', { name: `${CHANNEL} favorilere ekle` }).click();
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await expect(channel(page)).toBeVisible();
      await page.getByRole('button', { name: 'Listeleri yeniden kilitle' }).click();
      await expect(channel(page)).toHaveCount(0);
      await expect(page.locator('video')).toHaveCount(0);
      await page.getByRole('button', { name: /^Son izlenenler/ }).click();
      await expect(channel(page)).toHaveCount(0);

      // Guessing is slowed down: five wrong PINs, and even the right one has to wait.
      await page.getByRole('button', { name: 'Kilitli listeleri aç' }).click();
      for (let i = 0; i < 5; i++) { await pin(page, '1111'); await dialog(page).getByRole('button', { name: 'Aç' }).click(); await expect(dialog(page).getByRole('alert')).toContainText(i < 4 ? 'PIN yanlış' : 'Çok fazla'); }
      await pin(page, PIN); await dialog(page).getByRole('button', { name: 'Aç' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText(/\d+ saniye sonra/);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      await expect(page.getByText('1 liste kilitli.')).toBeVisible();
      await saved(page);
    } finally { await app.close(); }
  }
  {
    // A new window: still locked (the PIN and the lock were saved), and locked means hidden.
    const { app, page } = await open();
    try {
      await expect(page.getByRole('heading', { name: 'Bu liste kilitli' })).toBeVisible();
      await expect(channel(page)).toHaveCount(0);
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await expect(channel(page)).toHaveCount(0);
      // Removing every lock needs the PIN, and afterwards the list opens without one.
      await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      await page.getByRole('button', { name: 'Tüm kilitleri kaldır' }).click();
      await pin(page, PIN); await dialog(page).getByRole('button', { name: 'Kaldır' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByText('Henüz PIN belirlenmedi.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Kilitli listeleri aç' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
      await expect(channel(page)).toBeVisible();
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await expect(channel(page)).toBeVisible();
      await saved(page);
    } finally { await app.close(); }
  }
  console.log('PASS: Liste kilidi: PIN belirleme, gizleme (liste, tüm içerikler, favoriler, geçmiş), yeniden kilitlemede oynatmanın durması, hatalı deneme sınırı, yeniden başlatmada kalıcılık, kilitleri kaldırma.');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
