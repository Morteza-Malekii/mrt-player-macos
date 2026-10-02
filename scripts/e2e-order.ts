// The viewer's own order: categories are arranged in Settings and follow through to the lists and
// the first list shown; channels are arranged inside a list, favourites too; nothing moves while a
// search narrows the list; it all survives a restart and can be reset. No provider account or
// media is used.
import { _electron as electron, expect, type Page } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture({ extraChannels: 4 }); // Sentetik test yayını, İstanbul test deseni, Kanal 1..4
const data = await mkdtemp(path.join(tmpdir(), 'mrt-order-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const PROVIDER = ['Sentetik test yayını', 'İstanbul test deseni', 'Kanal 1', 'Kanal 2', 'Kanal 3', 'Kanal 4'];

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
const names = (page: Page) => page.locator('.tile-name').allInnerTexts();
const tileOrder = (page: Page, expected: string[]) => expect.poll(() => names(page)).toEqual(expected);
const categoryOrder = (page: Page) => page.getByRole('complementary', { name: 'Kategoriler' }).getByRole('button').allInnerTexts();
const saved = (page: Page) => page.waitForTimeout(900); // the order is saved on a short debounce
const go = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
const move = (page: Page, channel: string, how: 'başa al' | 'öne al' | 'geriye al') => page.getByRole('button', { name: `${channel}: ${how}`, exact: true }).click();
const managerRows = (page: Page) => page.locator('.manager-row .manager-name').allInnerTexts();

try {
  {
    const { app, page } = await open();
    try {
      await tileOrder(page, PROVIDER);
      // Arrange mode: the cards stop playing, and the buttons at the ends are disabled.
      await page.getByRole('button', { name: 'Sırala', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Sentetik test yayını: başa al' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Kanal 4: geriye al' })).toBeDisabled();
      // A click on the card itself (away from its buttons) does not start a channel.
      await page.getByRole('button', { name: 'Kanal 2', exact: true }).click({ position: { x: 6, y: 6 }, force: true });
      await page.waitForTimeout(500);
      await expect(page.locator('video')).toHaveCount(0);
      await move(page, 'Kanal 3', 'başa al');
      await tileOrder(page, ['Kanal 3', ...PROVIDER.filter(n => n !== 'Kanal 3')]);
      await move(page, 'Sentetik test yayını', 'geriye al');
      await move(page, 'Kanal 4', 'öne al');
      await tileOrder(page, ['Kanal 3', 'İstanbul test deseni', 'Sentetik test yayını', 'Kanal 1', 'Kanal 4', 'Kanal 2']);
      // Searching narrows what is on screen, so arranging is off until the search is cleared.
      await page.getByLabel('İçerik ara').fill('Kanal');
      await expect(page.getByRole('button', { name: /Sırala|Sıralamayı bitir/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Kanal 4: öne al' })).toHaveCount(0);
      await page.getByLabel('İçerik ara').fill('');
      await page.getByRole('button', { name: 'Sırala', exact: true }).click();
      await page.getByRole('button', { name: 'Sıralamayı bitir', exact: true }).click(); // and it stops again on demand
      await expect(page.getByRole('button', { name: 'Kanal 3: başa al' })).toHaveCount(0);

      // Categories are arranged in Settings and the lists follow.
      await go(page, 'Ayarlar');
      await expect.poll(() => managerRows(page)).toEqual(['Test laboratuvarı', 'Boş kategori']);
      await page.getByRole('group', { name: 'Boş kategori', exact: true }).getByRole('button', { name: 'Başa al' }).click();
      await expect.poll(() => managerRows(page)).toEqual(['Boş kategori', 'Test laboratuvarı']);
      await expect(page.getByRole('group', { name: 'Boş kategori', exact: true }).getByRole('button', { name: 'Yukarı taşı' })).toBeDisabled();
      await expect(page.getByRole('group', { name: 'Test laboratuvarı', exact: true }).getByRole('button', { name: 'Aşağı taşı' })).toBeDisabled();
      await page.getByRole('group', { name: 'Boş kategori', exact: true }).getByRole('button', { name: 'Aşağı taşı' }).click();
      await expect.poll(() => managerRows(page)).toEqual(['Test laboratuvarı', 'Boş kategori']);
      await page.getByRole('group', { name: 'Test laboratuvarı', exact: true }).getByRole('button', { name: 'Aşağı taşı' }).click();
      await expect.poll(() => managerRows(page)).toEqual(['Boş kategori', 'Test laboratuvarı']);
      // Moving needs the whole list, so the arrows are gone while a search is typed.
      await page.getByLabel('Listelerde ara').fill('Test');
      await expect(page.locator('.manager-move')).toHaveCount(0);
      await page.getByLabel('Listelerde ara').fill('');
      await go(page, 'Canlı TV');
      await expect.poll(async () => (await categoryOrder(page)).slice(0, 4)).toEqual(['Tüm içerikler', 'Boş kategori', 'Test laboratuvarı', 'Listeyi yenile']);
      await expect(page.getByRole('heading', { name: 'Boş kategori' })).toBeVisible(); // the first list is the one that opens
      await go(page, 'Test laboratuvarı');
      await tileOrder(page, ['Kanal 3', 'İstanbul test deseni', 'Sentetik test yayını', 'Kanal 1', 'Kanal 4', 'Kanal 2']);

      // Favourites are arranged too: newest first, then the viewer's order.
      await page.getByRole('button', { name: 'Kanal 1 favorilere ekle' }).click();
      await page.getByRole('button', { name: 'Kanal 2 favorilere ekle' }).click();
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await tileOrder(page, ['Kanal 2', 'Kanal 1']);
      await page.getByRole('button', { name: 'Sırala', exact: true }).click();
      await move(page, 'Kanal 1', 'başa al');
      await tileOrder(page, ['Kanal 1', 'Kanal 2']);
      await saved(page);
    } finally { await app.close(); }
  }
  {
    // A new window: everything is still where the viewer put it.
    const { app, page } = await open();
    try {
      await expect(page.getByRole('heading', { name: 'Boş kategori' })).toBeVisible();
      await expect.poll(async () => (await categoryOrder(page)).slice(0, 3)).toEqual(['Tüm içerikler', 'Boş kategori', 'Test laboratuvarı']);
      await go(page, 'Test laboratuvarı');
      await tileOrder(page, ['Kanal 3', 'İstanbul test deseni', 'Sentetik test yayını', 'Kanal 1', 'Kanal 4', 'Kanal 2']);
      await page.getByRole('button', { name: /^Favoriler/ }).click();
      await tileOrder(page, ['Kanal 1', 'Kanal 2']);
      // Resetting puts a list back in the provider's order.
      await go(page, 'Canlı TV');
      await go(page, 'Test laboratuvarı');
      await page.getByRole('button', { name: 'Sırala', exact: true }).click();
      await page.getByRole('button', { name: 'Sırayı sıfırla', exact: true }).click();
      await tileOrder(page, PROVIDER);
      await go(page, 'Ayarlar');
      await page.getByRole('button', { name: 'Sırayı sıfırla', exact: true }).click();
      await expect.poll(() => managerRows(page)).toEqual(['Test laboratuvarı', 'Boş kategori']);
      await expect(page.getByRole('button', { name: 'Sırayı sıfırla', exact: true })).toHaveCount(0);
      await saved(page);
    } finally { await app.close(); }
  }
  console.log('PASS: Sıralama: kanalların sırası (başa al, öne, geriye), arama sırasında kapalı, liste sırası Ayarlar\'da ve ilk açılan liste, favorilerde sıra, yeniden başlatmada kalıcılık, sıfırlama.');
} finally { await fixture.close(); await rm(data, { recursive: true, force: true }); }
