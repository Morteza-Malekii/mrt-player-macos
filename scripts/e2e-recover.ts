// A dropped upstream must not turn into an error screen. The proxy in front of the local
// fixture cuts every live socket the way a provider does when it rotates or overloads, and
// the run checks that the channel comes back by itself. No provider account or media is used.
import net from 'node:net';
import { _electron as electron } from '@playwright/test';
import { createFixture } from './fixture';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Loopback is not a network: without a ceiling the player swallows the whole fixture before
// anything can be cut, and the run would prove nothing. This keeps it living hand to mouth.
const RATE = 1.4 * 1024 * 1024;
const fixture = await createFixture({ videoSize: '1280x720', videoBitrate: '8M', videoDuration: 120, live: true });
const upstream = new URL(fixture.credentials.server);
const sockets = new Set<net.Socket>();
let blocked = false;
const proxy = net.createServer(client => {
  if (blocked) { client.destroy(); return; }
  sockets.add(client);
  client.on('error', () => client.destroy());
  const server = net.connect(Number(upstream.port), upstream.hostname);
  server.on('error', () => { server.destroy(); client.destroy(); });
  client.pipe(server);
  server.on('data', chunk => { client.write(chunk); server.pause(); setTimeout(() => server.resume(), (chunk.length / RATE) * 1000); });
  server.on('end', () => client.end());
  client.on('close', () => { sockets.delete(client); server.destroy(); }); server.on('close', () => client.destroy());
});
await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
const server = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
const cut = () => { for (const socket of sockets) socket.destroy(); sockets.clear(); };

const data = await mkdtemp(path.join(tmpdir(), 'mrt-recover-'));
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
  await page.getByRole('button', { name: 'Sentetik test yayını', exact: true }).click();
  const video = page.locator('video');
  const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime).catch(() => 0);
  const advances = async (from: number, within: number) => { for (const deadline = Date.now() + within; Date.now() < deadline;) { if (await time() > from + 0.5) return true; await page.waitForTimeout(100); } return false; };
  await video.waitFor({ state: 'attached', timeout: 30000 });
  if (!await advances(0.5, 30000)) throw new Error('Yayın hiç başlamadı.');

  let errors = 0;
  for (let round = 1; round <= 2; round++) {
    const at = await time();
    cut();
    if (!await advances(at, 20000)) throw new Error(`${round}. kesintiden sonra yayın kendi kendine dönmedi.`);
    if (await page.locator('.player-status .error').isVisible().catch(() => false)) errors++;
  }
  // An outage that never ends must not leave the viewer watching a spinner for ever: take the
  // server away for good and check that the player ends up saying something actionable.
  const failure = page.locator('.player-status .error, .watch-placeholder .error').first();
  blocked = true; cut();
  let reported = false;
  for (let i = 0; i < 50 && !reported; i++) { await page.waitForTimeout(1000); reported = await failure.isVisible().catch(() => false); }
  if (!reported) throw new Error('Kalıcı kesintide kullanıcıya hiçbir şey söylenmedi.');
  console.log(`PASS: İki tek seferlik kesinti otomatik toparlandı (${errors} hata ekranı), sürekli kesintide kullanıcı bilgilendirildi.`);
} finally { await app.close(); await rm(data, { recursive: true, force: true }); await new Promise<void>(resolve => proxy.close(() => resolve())); await fixture.close(); }
