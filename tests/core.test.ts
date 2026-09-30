import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeText, normalizeEpg } from '../src/core/epg';
import { normalizeCredentials, Xtream } from '../src/core/xtream';
import { matches, normalizeLibrary, remember, toggleFavorite } from '../src/core/library';
import { publicError } from '../src/core/errors';
import { request } from '../src/runtime/http';
import { MediaGateway, lanesFor } from '../src/platform/mac/media';
import { randomBytes } from 'node:crypto';
// A server that answers with a never-ending body, the way a live stream or a long film does.
async function streamingServer() {
  const responses: http.ServerResponse[] = [];
  const server = http.createServer((_request, response) => { responses.push(response); response.writeHead(200, { 'Content-Type': 'video/mp2t' }); response.write(Buffer.alloc(1024)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { responses, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}
test('sunucu normalizasyonu, HTTP onayı ve güvenli URL', () => {
  const c = { server: 'https://example.invalid/path/player_api.php', username: ' test ', password: randomBytes(12).toString('hex') };
  assert.equal(normalizeCredentials(c, false).server, 'https://example.invalid/path');
  for (const server of ['javascript:alert(1)', 'https://user:pass@example.invalid', 'https://example.invalid?password=x', 'http://example.invalid']) assert.throws(() => normalizeCredentials({ ...c, server }, false));
  assert.equal(normalizeCredentials({ ...c, server: 'http://example.invalid/' }, true).server, 'http://example.invalid');
});
test('EPG Türkçe base64, düz metin, zaman ve sıralama', () => {
  const title = 'İstanbul’da bugün'; assert.equal(decodeText(Buffer.from(title).toString('base64')), title);
  assert.equal(decodeText('Günün haberleri'), 'Günün haberleri');
  const rows = normalizeEpg({ epg_listings: [{ title: 'Geçersiz', start_timestamp: 20, stop_timestamp: 10 }, { title, start_timestamp: 200, stop_timestamp: 300 }, { title, start_timestamp: 100, stop_timestamp: 200 }] });
  assert.deepEqual(rows.map(x => x.start), [100000, 200000]);
});
test('kitaplık URL saklamaz, geçmiş sınırlı ve favori türleri bağımsız', () => {
  const item = { id: '1', kind: 'live' as const, name: 'İstanbul', categoryId: '1', icon: 'https://example.invalid/secret' };
  let state = normalizeLibrary({}); state = toggleFavorite(state, item); state = remember(state, item, 12);
  assert.equal(state.favorites[0].icon, undefined); assert.equal(state.recent[0].position, 12);
  assert.equal(toggleFavorite(state, item).favorites.length, 0);
  assert.equal(matches('İstanbul', 'istanbul'), true);
  assert.equal(normalizeLibrary({ preferences: { volume: 10 } }).preferences.volume, 1);
});
test('kaldırılan oynatma tercihleri eski kayıttan temizlenir, kalanlar korunur', () => {
  // A library saved by an older version still carries the removed choices; they must not leak back.
  const old = normalizeLibrary({ preferences: { volume: 0.5, muted: true, resume: false, liveFormat: 'ts', agent: 'vlc', buffer: 'large', lanes: 4 } });
  assert.deepEqual(old.preferences, { volume: 0.5, muted: true, resume: false });
  assert.deepEqual(normalizeLibrary({}).preferences, { volume: 0.8, muted: false, resume: true });
});
test('paralel indirme genişliği hesabın bağlantı sınırından gelir ve bir yuva boş kalır', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(lanesFor), [1, 1, 1, 2, 3, 4, 4, 4]);
  assert.equal(lanesFor(Number.NaN) >= 1, true);
});
test('API doğrulama ve ID enjeksiyonu engeli', async () => {
  const client = new Xtream({ server: 'https://example.invalid', username: 'test', password: randomBytes(12).toString('hex') }, { json: async () => ({ user_info: { auth: 0 } }) });
  await assert.rejects(client.authenticate(), /geçersiz/);
  assert.throws(() => client.stream('live', '../1'));
  assert.equal(publicError(new Error('sensitive URL')).message.includes('sensitive'), false);
});
test('akan medya gövdesi boşta kalma zaman aşımıyla kesilmez', async () => {
  const origin = await streamingServer();
  try {
    // A player that has filled its buffer stops reading for minutes; timing the body would cut
    // healthy 4K and film streams mid segment, so only connect and headers stay bounded.
    const stream = await request(`${origin.origin}/live.ts`, {}, { streaming: true });
    assert.equal(stream.socket.timeout, 0);
    stream.destroy();
    const catalog = await request(`${origin.origin}/player_api.php`);
    assert.equal(catalog.socket.timeout, 15000);
    catalog.destroy();
  } finally { origin.close(); }
});
test('kanal değişimi açık yayın bağlantılarını hemen kapatır', async () => {
  const origin = await streamingServer();
  const gateway = new MediaGateway();
  try {
    const local = gateway.add(`${origin.origin}/live.ts`);
    const reply = await gateway.handle(new Request(`kiyi://media/${local.split('/').pop()}`));
    assert.equal(reply.status, 200);
    assert.equal(origin.responses.length, 1);
    // Without this the provider keeps the old stream running and the account's connection
    // slot stays taken, so the next channel waits for it to time out.
    const released = new Promise(resolve => origin.responses[0].on('close', resolve));
    gateway.clear();
    await released;
  } finally { origin.close(); }
});
