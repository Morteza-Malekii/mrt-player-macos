// Local high-resolution playback probe. No provider account or media is used.
import { _electron as electron, expect } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = await createFixture({ videoSize: '3840x2160', videoBitrate: '16M', videoDuration: 10 });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-4k-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.KIYI_TEST_PACKAGED === '1';
const app = await electron.launch(packaged ? { executablePath: path.resolve('release/MRT-Player-darwin-arm64/MRT-Player.app/Contents/MacOS/MRT-Player'), args: [], env } : { args: ['scripts/electron-test-main.cjs'], env });
try {
  const page = await app.firstWindow();
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30000 }).toBe(3840);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 30000 }).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Akış bilgileri' }).click();
  await expect(page.locator('.playback-stats')).toContainText('3840×2160');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/mac-4k-stats.png' });
  const start = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.waitForTimeout(3000);
  const result = await video.evaluate((v: HTMLVideoElement) => ({
    time: v.currentTime,
    height: v.videoHeight,
    mse: v.currentSrc.startsWith('blob:'),
    droppedFrames: v.getVideoPlaybackQuality?.().droppedVideoFrames,
    totalFrames: v.getVideoPlaybackQuality?.().totalVideoFrames
  }));
  if (!result.mse || result.height !== 2160 || result.time - start < 2) throw new Error('4K HLS oynatımı beklenen hızda ilerlemedi.');
  console.log(`PASS: ${packaged ? 'Paketli .app' : 'Electron geliştirme penceresi'} · 3840×2160 HLS (hls.js), 3 saniyede ${(result.time - start).toFixed(1)} saniye oynattı; atlanan kare: ${result.droppedFrames ?? 'bilinmiyor'}/${result.totalFrames ?? 'bilinmiyor'}.`);
} finally { await app.close(); await fixture.close(); await rm(data, { recursive: true, force: true }); }
