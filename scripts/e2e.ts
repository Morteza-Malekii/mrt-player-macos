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
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 25000 }).toBeGreaterThan(1);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(640);
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentSrc.startsWith('blob:'))).toBe(true); // live HLS runs through hls.js (MSE), never the native parser
  await page.getByRole('button', { name: 'Akış bilgileri' }).click();
  await expect(page.locator('.playback-stats')).toContainText('HLS uyumluluk');
  await expect(page.locator('.playback-stats')).toContainText('640×360');
  // The panel has to answer "is the provider keeping up?", not just "what is on screen".
  await expect(page.locator('.playback-stats')).toContainText('Sunucu hızı');
  await expect.poll(() => page.locator('.playback-stats').innerText(), { timeout: 10000 }).toMatch(/Sunucu hızı\s*\n?\s*[\d.]+ Mbps/);
  await expect(page.locator('.playback-stats')).toContainText('Açık bağlantı');
  // The ceiling the provider ever reached, not the rate a full buffer throttles down to.
  // The test clip is a few hundred KB, under the floor a reading needs to be trustworthy, so
  // "still measuring" is the honest and expected state here; accuracy on a real transfer has
  // its own dedicated test (e2e-rate.ts).
  await expect(page.locator('.playback-stats')).toContainText('En yüksek hız');
  // A decoder that never runs is the difference between "the network is slow" and "this Mac
  // cannot play this stream", so both tracks have to report real progress on a good stream.
  await expect.poll(() => page.locator('.playback-stats').innerText(), { timeout: 10000 }).toMatch(/Ses çözümü\s*\n?\s*\d+ KB çözüldü/);
  await expect.poll(() => page.locator('.playback-stats').innerText(), { timeout: 10000 }).toMatch(/Görüntü çözümü\s*\n?\s*\d+ KB çözüldü/);
  await expect(page.locator('.playback-stats')).toContainText(/Sunucu hatası\s*\n?\s*0 \/ \d+ istek/);
  await page.getByRole('button', { name: 'Akış bilgileri' }).click();
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
