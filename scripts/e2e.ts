import { checkMvp } from './ui-checks';
import { _electron as electron, expect } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const fixture = await createFixture(), data = await mkdtemp(path.join(tmpdir(), 'kiyi-e2e-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.KIYI_TEST_PACKAGED === '1';
const app = await electron.launch(packaged ? { executablePath: path.resolve('release/MRT-Player-darwin-arm64/MRT-Player.app/Contents/MacOS/MRT-Player'), args: [], env } : { args: ['scripts/electron-test-main.cjs'], env });
try {
  const page = await app.firstWindow();
  await expect(page.locator('.brand').first()).toContainText('MRT-Player');
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await expect.poll(() => fixture.catalogRequests().find(row => row.action === 'get_live_streams')?.category).toBe('1');
  await page.getByRole('button', { name: 'Test laboratuvarı', exact: true }).click();
  // Opening a category is browsing: every channel gets the available width until one is chosen.
  const expectBrowsing = async () => {
    await expect(page.locator('.watch-area')).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.locator('.browse-columns')).not.toHaveClass(/with-player/);
    const widths = await page.locator('.content-list').evaluate(list => ({ list: list.getBoundingClientRect().width, available: list.parentElement!.getBoundingClientRect().width }));
    expect(Math.abs(widths.list - widths.available)).toBeLessThan(2);
  };
  await expectBrowsing();
  await expect(page.locator('.content-select')).toHaveCount(2);
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(1);
  await page.getByRole('button', { name: 'Oynatıcıyı kapat' }).click();
  await expectBrowsing();
  await expect(page.locator('.category.selected')).toHaveText('Test laboratuvarı');
  await expect(page.locator('.content-select')).toHaveCount(2);
  // Choosing another category, including "all", also ends the previous playback.
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(1);
  await page.getByRole('button', { name: 'Boş kategori', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bu kategori boş' })).toBeVisible();
  await expectBrowsing();
  await page.getByRole('button', { name: 'Tüm içerikler', exact: true }).click();
  await expect(page.locator('.content-select')).toHaveCount(2);
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(1);
  await page.getByRole('button', { name: 'Tüm içerikler', exact: true }).click();
  await expectBrowsing();
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect(page.locator('video')).toHaveCount(1);
  await page.getByRole('button', { name: 'Filmler', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Test filmi', exact: true })).toBeVisible();
  await expectBrowsing();
  await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(1);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentSrc.startsWith('blob:'))).toBe(true); // live HLS runs through hls.js (MSE), never the native parser
  await expect(page.getByRole('button', { name: 'Akış bilgileri' })).toHaveCount(0);
  await expect(page.locator('.playback-stats')).toHaveCount(0);
  // Decoder progress is checked directly now that stream information is no longer in the UI.
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => {
    const decoded = v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
    return (decoded.webkitAudioDecodedByteCount || 0) > 0 && (decoded.webkitVideoDecodedByteCount || 0) > 0;
  }), { timeout: 10000 }).toBe(true);
  // The choices that used to live on the settings page are now fixed defaults. The page must
  // not offer them any more, and the defaults must actually be in effect.
  await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  for (const label of ['Canlı yayın biçimi', 'Sunucuya bildirilen oynatıcı', 'Tampon', 'Paralel indirme']) await expect(page.getByLabel(label)).toHaveCount(0);
  await page.getByRole('button', { name: 'Canlı TV', exact: true }).click();
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(1);
  // Every request to the provider, catalogue and media alike, announces the same well-known player.
  expect(fixture.userAgents().length).toBeGreaterThan(0);
  expect(fixture.userAgents().every(value => value.startsWith('VLC/'))).toBe(true);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/mac-prototype.png' });
  await checkMvp(page, 'mac');
  console.log(`PASS: ${packaged ? 'Paketli .app' : 'Electron geliştirme penceresi'} → giriş, katalog, HLS/VOD video, EPG, favori, geçmiş ve kontroller.`);
} finally { await app.close(); await fixture.close(); await rm(data, { recursive: true, force: true }); }
