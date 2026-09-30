// Channel change probe. A provider is not next door: every new TCP connection costs a round
// trip, so this puts a fixed connect delay in front of the local fixture and measures what a
// switch actually costs. No provider account or media is used.
import net from 'node:net';
import { _electron as electron } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CONNECT_DELAY = 150;
const fixture = await createFixture();
const upstream = new URL(fixture.credentials.server);
let connections = 0;
const proxy = net.createServer(client => {
  connections++;
  client.on('error', () => client.destroy());
  setTimeout(() => {
    const server = net.connect(Number(upstream.port), upstream.hostname);
    server.on('error', () => { server.destroy(); client.destroy(); });
    client.pipe(server); server.pipe(client);
    client.on('close', () => server.destroy()); server.on('close', () => client.destroy());
  }, CONNECT_DELAY);
});
await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
const server = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

const data = await mkdtemp(path.join(tmpdir(), 'mrt-switch-'));
const env = { ...process.env, KIYI_TEST_DATA: data, KIYI_TEST_MODE: '1' } as Record<string, string>;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['scripts/electron-test-main.cjs'], env });
try {
  const page = await app.firstWindow();
  await page.getByLabel('Sunucu adresi').fill(server);
  await page.getByLabel('Kullanıcı adı').fill(fixture.credentials.username);
  await page.getByLabel('Şifre', { exact: true }).fill(fixture.credentials.password);
  await page.getByRole('checkbox', { name: /HTTP/ }).check();
  await page.getByRole('button', { name: /^Bağlan/ }).click();
  const video = page.locator('video');
  const playing = async () => { await video.waitFor({ state: 'attached', timeout: 30000 }); for (const deadline = Date.now() + 30000; Date.now() < deadline;) { if (await video.evaluate((v: HTMLVideoElement) => v.currentTime > 0.5).catch(() => false)) return; await page.waitForTimeout(50); } throw new Error('Yayın başlamadı.'); };

  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  await playing();
  await page.waitForTimeout(1500); // let the first channel settle, as a viewer would

  const before = connections, started = Date.now();
  await page.getByRole('button', { name: 'İstanbul test deseni', exact: true }).click();
  await playing();
  const elapsed = Date.now() - started, opened = connections - before;

  // Every fresh connection adds a round trip before a single byte of video moves. Reusing the
  // pooled socket is what keeps a switch from stacking handshakes.
  if (opened > 2) throw new Error(`Kanal değişimi ${opened} yeni bağlantı açtı; havuzdaki bağlantı yeniden kullanılmıyor.`);
  if (elapsed > 5000) throw new Error(`Kanal değişimi ${elapsed} ms sürdü.`);
  console.log(`PASS: Kanal değişimi ${elapsed} ms, ${opened} yeni sunucu bağlantısı (bağlantı başına ${CONNECT_DELAY} ms gecikme benzetimi).`);
} finally { await app.close(); await rm(data, { recursive: true, force: true }); await new Promise<void>(resolve => proxy.close(() => resolve())); await fixture.close(); }
