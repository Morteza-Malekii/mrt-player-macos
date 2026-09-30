// The "highest speed" reading has to reflect the provider's real throughput, not the wall
// clock time a player spends idle with a full buffer — that mismatch (a big cushion next to a
// low reported speed) is what made the fault look unsolved after the earlier fix. This checks
// both directions: the number must not collapse to zero for a real in-progress transfer, and
// it must not inflate far past the provider's actual cap. No provider account or media is used.
import { _electron as electron } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MediaStats } from '../src/core/models';

const CAP = 8e6 / 8; // bytes/s — well above the content's own bitrate, so the buffer fills and goes idle
const fixture = await createFixture({ videoSize: '1920x1080', videoBitrate: '3M', videoDuration: 90, perConnectionBps: CAP });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-rate-'));
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
  // Content bitrate (3 Mbps) is well under the cap, so the buffer fills and the player spends
  // most of this window idle: exactly the shape that produced the contradiction.
  await page.waitForTimeout(20000);
  const media = await page.evaluate(() => (window as any).kiyi.call('mediaStats').then((r: any) => r.data as MediaStats));
  const mbps = media.peakBps * 8 / 1e6, capMbps = CAP * 8 / 1e6;
  console.log(`en yüksek hız: ${mbps.toFixed(1)} Mbps (gerçek sınır ${capMbps.toFixed(1)} Mbps)`);
  if (mbps < capMbps * 0.5) throw new Error(`Ölçüm gerçek hızın çok altında: ${mbps.toFixed(1)} Mbps. Boşta kalan süre hıza karışıyor olabilir.`);
  if (mbps > capMbps * 1.5) throw new Error(`Ölçüm gerçek hızın çok üstünde: ${mbps.toFixed(1)} Mbps. Ölçüm zamanlaması bozulmuş olabilir.`);
  console.log('PASS: En yüksek hız, tamponun dolup boşta kaldığı süreye rağmen sağlayıcının gerçek tavanına yakın ölçüldü.');
} finally { await app.close(); await rm(data, { recursive: true, force: true }); await fixture.close(); }
