// Change live channels inside the player, following the list playback was started from.
// Includes search, custom order, pagination, mixed favourites, Recent and full screen.
import { _electron as electron, expect } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture({ extraChannels: 61 });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-channels-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.KIYI_TEST_PACKAGED === '1';
const app = await electron.launch(packaged ? { executablePath: path.resolve('release/MRT-Player-darwin-arm64/MRT-Player.app/Contents/MacOS/MRT-Player'), args: [], env } : { args: ['scripts/electron-test-main.cjs'], env });
try {
  const page = await app.firstWindow();
  const previous = page.getByRole('button', { name: 'Önceki kanal', exact: true });
  const next = page.getByRole('button', { name: 'Sonraki kanal', exact: true });
  const title = page.locator('.player-top strong');
  const channel = (name: string) => page.getByRole('button', { name, exact: true });
  const close = () => channel('Oynatıcıyı kapat').click();
  const playing = async (name: string) => {
    await expect(title).toHaveText(name);
    await expect(page.locator('video')).toHaveCount(1);
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(0.3);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();

  // Both directions work, with names in tooltips and a disabled previous button at the start.
  await channel('Sentetik test yayını').click();
  await playing('Sentetik test yayını');
  await expect(previous).toBeDisabled();
  await expect(next).toHaveAttribute('title', 'İstanbul test deseni');
  await next.click();
  await playing('İstanbul test deseni');
  await expect(previous).toHaveAttribute('title', 'Sentetik test yayını');
  await previous.click();
  await playing('Sentetik test yayını');
  // Ending a live stream must not trigger the series' automatic next-episode countdown.
  await page.locator('video').evaluate(v => v.dispatchEvent(new Event('ended')));
  await expect(page.locator('.up-next')).toHaveCount(0);
  await expect(title).toHaveText('Sentetik test yayını');

  // Full screen is requested for the page once; both channel changes preserve it.
  await page.evaluate(() => {
    const log: string[] = []; (window as unknown as { __channelFs: string[] }).__channelFs = log;
    const request = Element.prototype.requestFullscreen;
    Element.prototype.requestFullscreen = function (...args) { log.push(`request ${this.tagName}`); return request.apply(this, args); };
    const exit = Document.prototype.exitFullscreen;
    Document.prototype.exitFullscreen = function () { log.push('exit'); return exit.call(this); };
  });
  await channel('Tam ekran').click();
  await expect(page.locator('.player-full')).toBeVisible();
  await next.click();
  await playing('İstanbul test deseni');
  await expect(page.locator('.player-full')).toBeVisible();
  await previous.click();
  await playing('Sentetik test yayını');
  await expect(page.locator('.player-full')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __channelFs: string[] }).__channelFs)).toEqual(['request HTML']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.player-full')).toHaveCount(0);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/channels-player.png' });
  await close();
  await expect(page.locator('.watch-area')).toHaveCount(0);

  // Search controls the queue, but the 60-tile display limit does not: the 61st channel plays.
  await page.getByLabel('İçerik ara').fill('Kanal ');
  await expect(page.locator('.content-select')).toHaveCount(60);
  await channel('Kanal 60').click();
  await playing('Kanal 60');
  await expect(next).toHaveAttribute('title', 'Kanal 61');
  await next.click();
  await playing('Kanal 61');
  await expect(next).toBeDisabled();
  await previous.click();
  await playing('Kanal 60');
  await close();
  await page.getByLabel('İçerik ara').fill('Sentetik');
  await channel('Sentetik test yayını').click();
  await playing('Sentetik test yayını');
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  await close();
  await page.getByLabel('İçerik ara').fill('');

  // Custom ordering is respected rather than the provider's original order.
  await channel('Sırala').click();
  await channel('Kanal 1: başa al').click();
  await channel('Sıralamayı bitir').click();
  await channel('Kanal 1').click();
  await playing('Kanal 1');
  await expect(previous).toBeDisabled();
  await expect(next).toHaveAttribute('title', 'Sentetik test yayını');
  await next.click();
  await playing('Sentetik test yayını');
  await expect(previous).toHaveAttribute('title', 'Kanal 1');
  await close();

  // A film among favourites is skipped; only live channels take part in channel switching.
  for (const name of ['Kanal 1', 'Sentetik test yayını']) await channel(`${name} favorilere ekle`).click();
  await channel('Filmler').click();
  await expect(page.locator('.content-select')).toHaveCount(1);
  await channel('Test filmi favorilere ekle').click();
  await channel('Canlı TV').click();
  await channel('İstanbul test deseni favorilere ekle').click();
  await page.getByRole('button', { name: /^Favoriler/ }).click();
  await expect(page.locator('.content-select')).toHaveCount(4);
  await channel('Sentetik test yayını').click();
  await playing('Sentetik test yayını');
  await expect(previous).toHaveAttribute('title', 'İstanbul test deseni');
  await previous.click();
  await playing('İstanbul test deseni');
  await expect(previous).toBeDisabled();
  await next.click();
  await playing('Sentetik test yayını');
  await next.click();
  await playing('Kanal 1');
  await expect(next).toBeDisabled();
  await previous.click();
  await playing('Sentetik test yayını');
  await close();

  // Starting from Recent reorders the visible list, but must preserve the queue's neighbours.
  await channel('Son izlenenler').click();
  await expect(page.locator('.tile-live')).toHaveCount(5);
  const recent = await page.locator('.tile-live .content-select').evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')!));
  await channel(recent[1]).click();
  await playing(recent[1]);
  await expect(page.locator('.tile-live .content-select').first()).toHaveAttribute('aria-label', recent[1]);
  await expect(previous).toHaveAttribute('title', recent[0]);
  await expect(next).toHaveAttribute('title', recent[2]);
  await next.click();
  await playing(recent[2]);
  await previous.click();
  await playing(recent[1]);

  // A movie retains its own controls; channel controls do not appear there.
  await channel('Filmler').click();
  await channel('Test filmi').click();
  await channel('Filmi oynat').click();
  await playing('Test filmi');
  await expect(previous).toHaveCount(0);
  await expect(next).toHaveCount(0);
  console.log(`PASS: ${packaged ? 'Paketli .app' : 'Electron'} → önceki/sonraki kanal, sınırlar, tam ekran, arama, 60 öğe sınırının ötesi, özel sıra, karma favoriler, sabit geçmiş sırası; film ve otomatik bölüm geçişi etkilenmedi.`);
} finally { await app.close(); await fixture.close(); await rm(data, { recursive: true, force: true }); }
