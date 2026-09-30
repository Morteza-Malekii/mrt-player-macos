// Providers usually cap each connection, not the account: one lane starves a 4K film while
// the line sits idle. This reproduces that cap and checks that splitting the file across
// several lanes gets the picture back. The width is not a setting: it follows the account's
// own connection limit (one slot is always left free), so the two runs differ only in the
// limit the account reports. No provider account or media is used.
import { _electron as electron } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CAP = 6e6 / 8; // bytes per second, per connection — below the film's own bitrate
const WATCH = 40000;
const fixture = await createFixture({ videoSize: '3840x2160', videoBitrate: '13M', videoDuration: 60, perConnectionBps: CAP });

async function watch(accountLimit: number) {
  fixture.setMaxConnections(accountLimit);
  const data = await mkdtemp(path.join(tmpdir(), 'mrt-lanes-'));
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
    await page.waitForTimeout(WATCH);
    const seen = await video.evaluate((v: HTMLVideoElement) => ({ played: v.currentTime, stalls: (window as any).__stalls as number }));
    return { ...seen, wall: (Date.now() - begin) / 1000 };
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
}

try {
  const single = await watch(2); // two slots, one kept free: a single lane
  const split = await watch(5);  // five slots: four lanes
  const share = (r: { played: number; wall: number }) => r.played / r.wall;
  console.log(`  tek bağlantı: ${single.played.toFixed(1)}/${single.wall.toFixed(0)} sn oynadı, ${single.stalls} kesinti`);
  console.log(`  4 bağlantı:   ${split.played.toFixed(1)}/${split.wall.toFixed(0)} sn oynadı, ${split.stalls} kesinti`);
  if (share(single) > 0.75) throw new Error('Bağlantı sınırı tek bağlantıda kesinti yaratmadı; test artık bir şey ölçmüyor.');
  if (share(split) < 0.85 || split.stalls > 1) throw new Error('Paralel indirme, bağlantı başına sınırı aşamadı.');
  console.log(`PASS: Bağlantı başına ${(CAP * 8 / 1e6).toFixed(0)} Mbps sınır altında tek bağlantı takıldı, 4 bağlantı akıcı oynattı.`);
} finally { await fixture.close(); }
