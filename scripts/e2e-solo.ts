// An account allowed one stream at a time: the provider turns away anything that overlaps,
// and the player reads that refusal as a dead channel. Checks that the gateway takes turns
// and waits a refusal out instead of passing it on. No provider account or media is used.
import { _electron as electron } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MediaStats } from '../src/core/models';

const fixture = await createFixture({ videoSize: '1920x1080', videoBitrate: '10M', videoDuration: 120, oneStreamOnly: true, perConnectionBps: 20e6 / 8 });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-solo-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['scripts/electron-test-main.cjs'], env });
try {
  const page = await app.firstWindow();
  await page.getByLabel('Sunucu adresi').fill(fixture.credentials.server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  await page.getByRole('button', { name: 'Filmler', exact: true }).click();
  await page.getByRole('button', { name: 'Test filmi', exact: true }).click();
  await page.getByRole('button', { name: 'Filmi oynat' }).click();
  const video = page.locator('video');
  await video.waitFor({ state: 'attached', timeout: 40000 });
  await video.evaluate((v: HTMLVideoElement) => { (window as any).__stalls = 0; v.addEventListener('waiting', () => (window as any).__stalls++); });
  const begin = Date.now();
  // Seeking is what makes a player open a new transfer while the old one is still dying,
  // which is exactly the overlap a single-slot account refuses.
  for (const at of [30, 8, 55, 20, 70, 40]) {
    await page.waitForTimeout(2500);
    await video.evaluate((v: HTMLVideoElement, to) => { v.currentTime = to; void v.play(); }, at);
  }
  await page.waitForTimeout(12000);
  const seen = await video.evaluate((v: HTMLVideoElement) => ({ played: v.currentTime, stalls: (window as any).__stalls as number }));
  const media = await page.evaluate(() => (window as any).kiyi.call('mediaStats').then((r: any) => r.data as MediaStats));
  const wall = (Date.now() - begin) / 1000;
  console.log(`  ${wall.toFixed(0)} sn boyunca sarmalarla oynatıldı · ${seen.stalls} kesinti · son konum ${seen.played.toFixed(1)} sn`);
  console.log(`  sunucu reddi ${fixture.refusedCount()} · oynatıcıya geçen hata ${media.failures}/${media.requests} · kurtarılan ${media.retries}`);
  // Same run without the turn taking and the retry: the server refused twice and both
  // refusals reached the player. Taking turns means the second slot is never even asked for.
  if (media.requests < 5) throw new Error('Yeterince medya isteği yapılmadı; test bir şey ölçmüyor.');
  if (seen.played < 30) throw new Error('Sarmalardan sonra oynatma ilerlemedi.');
  if (fixture.refusedCount() > 0 && media.retries === 0) throw new Error(`${fixture.refusedCount()} red kurtarılmadı.`);
  if (media.failures > 0) throw new Error(`${media.failures} istek oynatıcıya hata olarak geçti.`);
  console.log(`PASS: Tek yayın hakkı olan hesapta ${media.requests} istekte sunucu reddi ${fixture.refusedCount()}, oynatıcıya geçen hata 0.`);
} finally { await app.close(); await rm(data, { recursive: true, force: true }); await fixture.close(); }
