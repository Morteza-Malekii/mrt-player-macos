// A provider that surges and sags drains a shallow buffer again and again. Checks that the
// default playback (the deep buffer is not a setting any more) waits for a real cushion
// instead of resuming into the next shortage. A shallow buffer used to stall three or more
// times in this same window, so a couple of stalls at most is the bar. No provider account or
// media is used.
import { _electron as electron } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WATCH = 70000;
const fixture = await createFixture({ videoSize: '1920x1080', videoBitrate: '10M', videoDuration: 150, perConnectionBps: 10e6 / 8, uneven: true });

async function watch() {
  const data = await mkdtemp(path.join(tmpdir(), 'mrt-cushion-'));
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
    await page.waitForTimeout(WATCH);
    return await video.evaluate((v: HTMLVideoElement) => ({ played: v.currentTime, stalls: (window as any).__stalls as number }));
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
}

try {
  const result = await watch();
  console.log(`  varsayılan tampon: ${result.stalls} kesinti, ${result.played.toFixed(1)} sn oynadı`);
  if (result.played < 30) throw new Error(`Dalgalı sağlayıcıda film ${WATCH / 1000} saniyede yalnızca ${result.played.toFixed(1)} saniye oynadı.`);
  if (result.stalls > 2) throw new Error(`Varsayılan tampon kesintiyi sınırlayamadı (${result.stalls} kesinti).`);
  console.log(`PASS: Dalgalı sağlayıcıda ${result.stalls} kesinti, ${result.played.toFixed(1)} sn oynadı.`);
} finally { await fixture.close(); }
