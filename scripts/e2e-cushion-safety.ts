// Safety net check: if the provider cannot even sustain the cushion, hold() must still give up
// and let the film play rather than freeze forever.
import { _electron as electron } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// A provider slower than the content's own bitrate: buffer can never reach the cushion.
const fixture = await createFixture({ videoSize: '1920x1080', videoBitrate: '10M', videoDuration: 60, perConnectionBps: 3e6 / 8 });
const data = await mkdtemp(path.join(tmpdir(), 'mrt-nh-'));
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
  let progressed = false;
  for (const deadline = Date.now() + 30000; Date.now() < deadline;) {
    const t = await video.evaluate((v: HTMLVideoElement) => v.currentTime).catch(() => 0);
    if (t > 3) { progressed = true; break; }
    await page.waitForTimeout(500);
  }
  if (!progressed) throw new Error('30 saniyede film 3 saniyeyi geçemedi; oynatıcı askıda kalmış olabilir.');
  console.log('PASS: Sürdürülemez sağlayıcıda oynatıcı askıda kalmadı, film ilerledi.');
} finally { await app.close(); await rm(data, { recursive: true, force: true }); await fixture.close(); }
