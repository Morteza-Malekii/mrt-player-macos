// Categories are managed in Settings: each one is shown, locked behind a PIN, or hidden. Locked
// content disappears everywhere until the PIN is entered; hidden content never shows; making
// either visible again needs the PIN once one exists; it all survives a restart. No provider
// account or media is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PIN = '4821', CATEGORY = 'Test laboratuvarı', OTHER = 'Boş kategori', CHANNEL = 'Sentetik test yayını';
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
const categories = (page: Page) => page.getByRole('complementary', { name: 'Kategoriler' });
const category = (page: Page, name: string) => categories(page).getByRole('button', { name, exact: true });
const pin = (page: Page, value: string, label = 'PIN') => page.getByLabel(label, { exact: true }).fill(value);
const dialog = (page: Page) => page.getByRole('dialog');
const saved = (page: Page) => page.waitForTimeout(900); // locks and lists are saved on a short debounce
const settings = (page: Page) => page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
const live = (page: Page) => page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
// The row of one category in Settings → Listeleri yönet, and the state button inside it.
const row = (page: Page, name: string) => page.getByRole('group', { name, exact: true });
const choose = (page: Page, name: string, state: 'Görünür' | 'Kilitli' | 'Gizli') => row(page, name).getByRole('button', { name: state, exact: true }).click();
const isState = (page: Page, name: string, state: 'Görünür' | 'Kilitli' | 'Gizli') => expect(row(page, name).getByRole('button', { name: state, exact: true })).toHaveAttribute('aria-pressed', 'true');

try {
  {
    const { app, page } = await open();
    try {
      await expect(channel(page)).toBeVisible();
      // No lock pictures on the category list: its only icon is the refresh arrow. Management is in Settings.
      await expect(categories(page).getByRole('button').locator('svg')).toHaveCount(1);

      // First lock asks for a PIN; a short or mismatched one is refused.
      await settings(page);
      await isState(page, CATEGORY, 'Görünür');
      await choose(page, CATEGORY, 'Kilitli');
      await pin(page, '12'); await pin(page, '12', 'PIN’i tekrarlayın');
      await dialog(page).getByRole('button', { name: 'Kaydet' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('4 ile 8 rakam');
      await pin(page, PIN); await pin(page, '9999', 'PIN’i tekrarlayın');
      await dialog(page).getByRole('button', { name: 'Kaydet' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('aynı değil');
      await pin(page, PIN, 'PIN’i tekrarlayın');
      await dialog(page).getByRole('button', { name: 'Kaydet' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await isState(page, CATEGORY, 'Kilitli');
      await expect(page.getByText('1 kilitli · 0 gizli')).toBeVisible();

      // Locked: the list itself, the all-contents list and the sidebar all agree.
      await live(page);
      await expect(page.getByRole('heading', { name: 'Bu liste kilitli' })).toBeVisible();
      await expect(category(page, CATEGORY)).toBeVisible();
      await expect(categories(page).getByRole('button').locator('svg')).toHaveCount(1); // a locked list gets no lock icon either
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

      // Hidden: no PIN to hide, and a hidden list is gone from the category list and the search.
      await settings(page);
      await choose(page, CATEGORY, 'Gizli');
      await isState(page, CATEGORY, 'Gizli');
      await choose(page, OTHER, 'Gizli');
      await expect(page.getByText('0 kilitli · 2 gizli')).toBeVisible();
      await live(page);
      await expect(category(page, CATEGORY)).toHaveCount(0);
      await expect(category(page, OTHER)).toHaveCount(0);
      await page.getByRole('button', { name: 'Tüm içerikler', exact: true }).click();
      await expect(page.getByText('0 içerik')).toBeVisible();
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await expect(channel(page)).toHaveCount(0);

      // A PIN exists, so showing a hidden list again asks for it.
      await settings(page);
      await choose(page, CATEGORY, 'Görünür');
      await expect(dialog(page).getByRole('heading', { name: 'Listeyi göster' })).toBeVisible();
      await pin(page, '0000'); await dialog(page).getByRole('button', { name: 'Göster' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText('PIN yanlış');
      await isState(page, CATEGORY, 'Gizli');
      await pin(page, PIN); await dialog(page).getByRole('button', { name: 'Göster' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await isState(page, CATEGORY, 'Görünür');
      await live(page);
      await expect(category(page, CATEGORY)).toBeVisible();
      await expect(category(page, OTHER)).toHaveCount(0);
      await expect(channel(page)).toBeVisible();

      // Lock it again; guessing is slowed down: five wrong PINs, and even the right one has to wait.
      await settings(page);
      await choose(page, CATEGORY, 'Kilitli');
      await isState(page, CATEGORY, 'Kilitli');
      await page.getByRole('button', { name: 'Kilitli listeleri aç' }).click();
      for (let i = 0; i < 5; i++) { await pin(page, '1111'); await dialog(page).getByRole('button', { name: 'Aç' }).click(); await expect(dialog(page).getByRole('alert')).toContainText(i < 4 ? 'PIN yanlış' : 'Çok fazla'); }
      await pin(page, PIN); await dialog(page).getByRole('button', { name: 'Aç' }).click();
      await expect(dialog(page).getByRole('alert')).toContainText(/\d+ saniye sonra/);
      await page.keyboard.press('Escape');
      await expect(page.getByText('1 liste kilitli.')).toBeVisible();
      await saved(page);
    } finally { await app.close(); }
  }
  {
    // A new window: still locked, the other list still hidden, and locked means hidden everywhere.
    const { app, page } = await open();
    try {
      await expect(page.getByRole('heading', { name: 'Bu liste kilitli' })).toBeVisible();
      await expect(channel(page)).toHaveCount(0);
      await expect(category(page, OTHER)).toHaveCount(0);
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await expect(channel(page)).toHaveCount(0);
      // Removing every lock needs the PIN; a hidden list stays hidden, and with no PIN left it
      // can be shown again freely.
      await settings(page);
      await page.getByRole('button', { name: 'Tüm kilitleri kaldır' }).click();
      await pin(page, PIN); await dialog(page).getByRole('button', { name: 'Kaldır' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByText('Henüz PIN belirlenmedi.')).toBeVisible();
      await isState(page, CATEGORY, 'Görünür');
      await isState(page, OTHER, 'Gizli');
      await choose(page, OTHER, 'Görünür');
      await expect(dialog(page)).toHaveCount(0);
      await isState(page, OTHER, 'Görünür');
      await live(page);
      await expect(category(page, OTHER)).toBeVisible();
      await expect(channel(page)).toBeVisible();
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await expect(channel(page)).toBeVisible();
      await saved(page);
    } finally { await app.close(); }
  }
  console.log('PASS: Liste yönetimi: Ayarlar\'dan kilitleme ve gizleme, PIN belirleme, listede hiç kilit simgesi yok, kilitli/gizli içeriğin her yerde gizlenmesi, göstermek için PIN, yeniden kilitlemede oynatmanın durması, hatalı deneme sınırı, yeniden başlatmada kalıcılık, kilitleri kaldırma.');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
