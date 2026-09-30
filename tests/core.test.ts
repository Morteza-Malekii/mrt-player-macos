import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodeText, normalizeEpg } from '../src/core/epg';
import { imageUrl, normalizeCredentials, Xtream } from '../src/core/xtream';
import { matches, normalizeLibrary, remember, toggleFavorite } from '../src/core/library';
import { publicError } from '../src/core/errors';
import { categoryState, checkPin, isLockedItem, lockKey, makePin, validPin, withCategoryState } from '../src/core/lock';
import { request } from '../src/runtime/http';
import { MediaGateway, lanesFor } from '../src/platform/mac/media';
import { ImageGateway } from '../src/platform/mac/images';
import { Session, type LibraryStore, type Vault } from '../src/runtime/session';
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
  assert.deepEqual(old.preferences, { volume: 0.5, muted: true, resume: false, posters: false });
  assert.deepEqual(normalizeLibrary({}).preferences, { volume: 0.8, muted: false, resume: true, posters: false });
});
test('paralel indirme genişliği hesabın bağlantı sınırından gelir ve bir yuva boş kalır', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map(lanesFor), [1, 1, 1, 2, 3, 4, 4, 4]);
  assert.equal(lanesFor(Number.NaN) >= 1, true);
});
test('PIN: doğru PIN geçer, yanlışı ve bozuk kaydı reddeder, hash düz PIN içermez', async () => {
  const record = await makePin('4821');
  assert.equal(await checkPin('4821', record), true);
  assert.equal(await checkPin('4822', record), false);
  assert.equal(await checkPin('abcd', record), false);
  assert.equal(JSON.stringify(record).includes('4821'), false);
  const again = await makePin('4821');
  assert.notEqual(again.salt, record.salt); assert.notEqual(again.hash, record.hash);
  assert.deepEqual(['123', '1234', '12345678', '123456789', '12a4', ''].map(validPin), [false, true, true, false, false, false]);
});
test('liste kilidi: PIN olmadan kilit tutulmaz, bozuk kayıt ve anahtarlar atılır, tür ayrımı korunur', async () => {
  const pin = await makePin('9031');
  const kept = normalizeLibrary({ locks: { pin, categories: ['live:5', 'live:5', 'vod:5', 'series:x', 'nope:1', 7, 'live:12345678901234567890123'] } });
  assert.deepEqual(kept.locks, { pin, categories: ['live:5', 'vod:5'] });
  assert.deepEqual(normalizeLibrary({ locks: { categories: ['live:5'] } }).locks, { categories: [] });
  assert.deepEqual(normalizeLibrary({ locks: { pin: { salt: 'x', hash: 'y' }, categories: ['live:5'] } }).locks, { categories: [] });
  assert.deepEqual(normalizeLibrary({}).locks, { categories: [] });
  // Film 5 and live 5 are different lists; an episode saved without a category is never matched.
  assert.equal(isLockedItem(kept.locks, { kind: 'live', categoryId: '5' }), true);
  assert.equal(isLockedItem(kept.locks, { kind: 'series', categoryId: '5' }), false);
  assert.equal(isLockedItem(kept.locks, { kind: 'vod', categoryId: '' }), false);
  assert.equal(lockKey('vod', '5'), 'vod:5');
  // Favourites and history survive being rewritten next to locks.
  const item = { id: '1', kind: 'live' as const, name: 'A', categoryId: '5' };
  assert.deepEqual(toggleFavorite(kept, item).locks, kept.locks);
  assert.deepEqual(remember(kept, item, 3).locks, kept.locks);
});
test('afiş adresi: yalnızca düz http(s); canlı/film stream_icon, dizi cover alanından okunur', async () => {
  assert.equal(imageUrl('https://cdn.example.invalid/a.png'), 'https://cdn.example.invalid/a.png');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:image/png;base64,AAAA', 'https://user:pw@example.invalid/a.png', '/relative/a.png', '', 7, null, 'https://x.invalid/' + 'a'.repeat(2100)]) assert.equal(imageUrl(bad), undefined);
  const client = new Xtream({ server: 'https://example.invalid', username: 'u', password: randomBytes(8).toString('hex') }, { json: async () => [{ stream_id: 1, name: 'A', category_id: '1', stream_icon: 'https://cdn.example.invalid/a.png' }, { stream_id: 2, name: 'B', category_id: '1', stream_icon: 'javascript:x' }, { series_id: 3, name: 'C', category_id: '1', cover: 'http://cdn.example.invalid/c.jpg' }] });
  assert.deepEqual((await client.items('live')).map(x => x.icon), ['https://cdn.example.invalid/a.png', undefined, 'http://cdn.example.invalid/c.jpg']);
});
test('afişler tercihi varsayılan kapalı, yalnızca açıkça true olunca açılır', () => {
  assert.equal(normalizeLibrary({}).preferences.posters, false);
  assert.equal(normalizeLibrary({ preferences: { posters: true } }).preferences.posters, true);
  for (const value of [false, 'true', 1, null, 'yes']) assert.equal(normalizeLibrary({ preferences: { posters: value } }).preferences.posters, false);
});
// A server with pictures of every kind the gateway has to handle, counting what it is asked.
async function pictureServer() {
  const hits: string[] = []; let active = 0, peak = 0;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const server = http.createServer((req, res) => {
    hits.push(req.url!);
    if (req.url === '/ok.png') { res.writeHead(200, { 'Content-Type': 'image/png' }).end(png); return; }
    if (req.url === '/page.png') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script>alert(1)</script>'); return; }
    if (req.url === '/vector.png') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg"/>'); return; }
    if (req.url === '/huge.png') { res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.alloc(5 * 1024 * 1024)); return; }
    if (req.url!.startsWith('/slow/')) { active++; peak = Math.max(peak, active); setTimeout(() => { active--; res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(png); }, 80); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { hits, peak: () => peak, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); } };
}
test('afiş vekili: yalnızca gerçek raster görsel geçer, önbelleğe alır, yokluğu hatırlar, eşzamanlılığı sınırlar', async () => {
  const origin = await pictureServer(), gateway = new ImageGateway();
  const table: Record<string, string> = { '1': '/ok.png', '2': '/page.png', '3': '/vector.png', '4': '/huge.png', '5': '/missing.png' };
  const lookup = (kind: string, id: string) => kind === 'live' && table[id] ? origin.origin + table[id] : id.startsWith('9') ? `${origin.origin}/slow/${id}` : undefined;
  const ask = (path: string, method = 'GET') => gateway.handle(new Request(`kiyi://image/${path}`, { method }), lookup);
  try {
    const ok = await ask('live/1');
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/png'); assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.equal((await ok.arrayBuffer()).byteLength > 20, true);
    // HTML, SVG, an oversize file and a missing one are all refused as plain 404s.
    for (const id of ['2', '3', '4', '5']) assert.equal((await ask(`live/${id}`)).status, 404, id);
    // Unknown ids, other kinds and odd paths never reach the network.
    for (const path of ['live/77', 'vod/1', 'live/abc', 'nope/1', 'live']) assert.equal((await ask(path)).status, 404, path);
    assert.equal((await ask('live/1', 'HEAD')).status, 404);
    // A second ask for a cached picture, and for a known-missing one, does not ask the server again.
    const before = origin.hits.length;
    assert.equal((await ask('live/1')).status, 200); assert.equal((await ask('live/5')).status, 404); assert.equal((await ask('live/2')).status, 404);
    assert.equal(origin.hits.length, before);
    // Twelve different pictures at once: all arrive, never more than four are in flight.
    const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => ask(`live/${900 + i}`)));
    assert.deepEqual(replies.map(r => r.status), Array(12).fill(200));
    assert.equal(origin.peak() <= 4 && origin.peak() >= 2, true, `peak ${origin.peak()}`);
  } finally { origin.close(); }
});
test('oturum: afiş kapalıyken hiçbir şey sunulmaz ve diske yazılmaz; açılınca adres sayfaya çıkmaz, favorinin afişi yeniden başlatmada kalır, kapanınca silinir', async () => {
  const secret = 'https://cdn.example.invalid/logo-1.png';
  const api = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x'), action = url.searchParams.get('action');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(!action ? { user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 9999), max_connections: '2' } } : [{ stream_id: 1, name: 'Kanal', category_id: '1', stream_icon: secret }, { stream_id: 2, name: 'Logosuz', category_id: '1' }]));
  });
  await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
  const disk = new Map<string, Record<string, string>>(); let library = normalizeLibrary({});
  const vault: Vault = { exists: async () => false, save: async () => {}, load: async () => { throw new Error('unused'); }, clear: async () => {} };
  const store: LibraryStore = { read: async () => library, write: async (_p, value) => { library = value; }, clear: async () => { disk.clear(); }, readIcons: async profile => disk.get(profile) || {}, writeIcons: async (profile, icons) => { disk.set(profile, icons); } };
  const login = { server: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, username: 'u', password: randomBytes(8).toString('hex'), remember: false, allowHttp: true };
  const item = { id: '1', kind: 'live' as const, name: 'Kanal', categoryId: '1' };
  const withPosters = (on: boolean) => ({ ...library, preferences: { ...library.preferences, posters: on } });
  try {
    const first = new Session(vault, store, 'mac');
    assert.equal(first.posterUrl('live', '1'), undefined, 'no session yet');
    await first.call('login', login);
    const reply = await first.call('items', { kind: 'live' });
    assert.equal(reply.ok, true);
    assert.equal(JSON.stringify(reply).includes('cdn.example'), false, 'the page must never see a poster address');
    assert.equal((reply.data as Array<{ icon?: string }>).every(row => row.icon === undefined), true);
    // Default: off. The catalogue named a picture, but nothing is served and nothing is written.
    await first.call('library');
    assert.equal(first.posterUrl('live', '1'), undefined, 'off by default');
    await first.call('saveLibrary', { library: toggleFavorite(library, item) });
    assert.equal(disk.size, 0, 'no address is written while posters are off');
    // Turned on: served, and the favourite's address is kept on the side only.
    await first.call('saveLibrary', { library: withPosters(true) });
    assert.equal(first.posterUrl('live', '1'), secret); assert.equal(first.posterUrl('live', '2'), undefined);
    assert.equal(JSON.stringify(library).includes('cdn.example'), false, 'the library itself holds no address');
    assert.deepEqual([...disk.values()], [{ 'live:1': secret }]);
    // A new run, catalogue never opened: loading the library brings the favourite's poster back.
    const second = new Session(vault, store, 'mac');
    await second.call('login', login); await second.call('library');
    assert.equal(second.posterUrl('live', '1'), secret);
    // Turned off again: served no more, and the saved address is wiped.
    await second.call('saveLibrary', { library: withPosters(false) });
    assert.equal(second.posterUrl('live', '1'), undefined); assert.deepEqual([...disk.values()], [{}]);
    await second.call('saveLibrary', { library: withPosters(true) });
    await second.call('logout');
    assert.equal(second.posterUrl('live', '1'), undefined, 'cleared with the session');
  } finally { api.closeAllConnections(); api.close(); }
});
test('liste durumu: görünür, kilitli veya gizli; aynı anda ikisi olmaz, gizli kilide baskındır, geçersiz anahtar atılır', async () => {
  const pin = await makePin('7302');
  let library = normalizeLibrary({ locks: { pin }, hidden: ['live:1', 'live:1', 'vod:2', 'nope:3', 'series:x', 5] });
  assert.deepEqual(library.hidden, ['live:1', 'vod:2']);
  // A category named in both lists is hidden, never both.
  const both = normalizeLibrary({ locks: { pin, categories: ['live:1', 'live:9'] }, hidden: ['live:1'] });
  assert.deepEqual(both.locks.categories, ['live:9']); assert.deepEqual(both.hidden, ['live:1']);
  assert.deepEqual(['1', '9', '4'].map(id => categoryState(both, 'live', id)), ['hidden', 'locked', 'shown']);
  assert.equal(categoryState(both, 'vod', '1'), 'shown', 'kinds are separate lists');
  // Moving through all three states leaves exactly one of them set each time, and keeps the PIN.
  library = normalizeLibrary({});
  library = withCategoryState(library, 'live', '5', 'locked', pin);
  assert.deepEqual([library.locks.categories, library.hidden, library.locks.pin], [['live:5'], [], pin]);
  library = withCategoryState(library, 'live', '5', 'hidden');
  assert.deepEqual([library.locks.categories, library.hidden, library.locks.pin], [[], ['live:5'], pin]);
  library = withCategoryState(library, 'live', '5', 'shown');
  assert.deepEqual([library.locks.categories, library.hidden], [[], []]);
  assert.equal(normalizeLibrary(library).locks.pin?.hash, pin.hash);
  // Favourites and history survive being saved beside hidden categories.
  const item = { id: '1', kind: 'live' as const, name: 'A', categoryId: '5' };
  assert.deepEqual(toggleFavorite(normalizeLibrary({ hidden: ['live:5'] }), item).hidden, ['live:5']);
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
