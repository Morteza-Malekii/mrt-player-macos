import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DownloadManager, safeName } from '../src/platform/mac/downloads';
import type { Download } from '../src/core/models';
import { normalizeLibrary } from '../src/core/library';
const body = Buffer.from(Array.from({ length: 300000 }, (_, i) => i % 251));
async function server(handler?: http.RequestListener) {
  const s = http.createServer(handler || ((req, res) => {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    if (m) { const from = Number(m[1]); res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Length': body.length - from, 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` }); res.end(body.subarray(from)); }
    else { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length }); res.end(body); }
  }));
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  return { origin: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => { s.closeAllConnections(); s.close(); } };
}
const wait = async (manager: DownloadManager, id: string, done: (d: Download) => boolean) => {
  for (let i = 0; i < 200; i++) { const row = manager.list().find(d => d.id === id)!; if (done(row)) return row; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('timeout');
};
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mrt-dl-'));
test('dosya adı güvenli hale getirilir', () => {
  assert.equal(safeName('../../etc/passwd'), 'etc passwd');
  assert.equal(safeName('A: B/C*?'), 'A B C');
  assert.equal(safeName('...'), 'indirme');
  assert.equal(safeName('x'.repeat(500)).length, 120);
});
test('film indirilir, aynı ad çakışmaz ve .part kalmaz', async () => {
  const s = await server(), dir = temp(), manager = new DownloadManager(() => dir);
  try {
    const a = manager.start(`${s.origin}/a.mp4`, 'Film', 'mp4'), b = manager.start(`${s.origin}/b.mp4`, 'Film', 'mp4');
    assert.equal(a.name, 'Film.mp4'); assert.equal(b.name, 'Film (2).mp4');
    const done = await wait(manager, b.id, d => d.state === 'done');
    assert.equal(done.total, body.length);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'Film.mp4')), body);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'Film (2).mp4')), body);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['Film (2).mp4', 'Film.mp4']);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('hata sayfası ve 403 başarısız sayılır, tekrar denemede kaldığı yerden devam edilir', async () => {
  let mode: 'html' | 'deny' | 'cut' | 'ok' = 'html';
  const s = await server((req, res) => {
    if (mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>hata</html>'); return; }
    if (mode === 'deny') { res.writeHead(403); res.end(); return; }
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || ''), from = m ? Number(m[1]) : 0;
    if (mode === 'cut') { res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length - from, ...(m ? { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}) }); res.write(body.subarray(from, from + 100000)); setTimeout(() => res.destroy(), 20); return; }
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Length': body.length - from, 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` }); res.end(body.subarray(from));
  });
  const dir = temp(), manager = new DownloadManager(() => dir);
  try {
    const job = manager.start(`${s.origin}/x.mp4`, 'Dizi', 'mp4');
    assert.match((await wait(manager, job.id, d => d.state === 'failed')).error || '', /hata sayfası/);
    mode = 'deny'; manager.retry(job.id);
    assert.match((await wait(manager, job.id, d => d.state === 'failed' && /reddetti/.test(d.error || ''))).error || '', /reddetti/);
    mode = 'cut'; manager.retry(job.id);
    await wait(manager, job.id, d => d.state === 'failed' && /yarıda/.test(d.error || ''));
    assert.ok(fs.statSync(path.join(dir, 'Dizi.mp4.part')).size > 0);
    mode = 'ok'; manager.retry(job.id);
    await wait(manager, job.id, d => d.state === 'done');
    assert.deepEqual(fs.readFileSync(path.join(dir, 'Dizi.mp4')), body);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('iptal akışı keser ve yarım dosyayı siler; clear hepsini bitirir', async () => {
  const open: http.ServerResponse[] = [];
  const s = await server((_req, res) => { open.push(res); res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': 10_000_000 }); res.write(Buffer.alloc(50000)); });
  const dir = temp(), manager = new DownloadManager(() => dir);
  try {
    const job = manager.start(`${s.origin}/big.mp4`, 'Büyük', 'mp4'), queued = manager.start(`${s.origin}/q.mp4`, 'Sıradaki', 'mp4');
    await wait(manager, job.id, d => d.state === 'active' && d.received > 0);
    assert.equal(manager.list().find(d => d.id === queued.id)!.state, 'queued');
    manager.cancel(job.id);
    await wait(manager, job.id, d => d.state === 'canceled');
    await wait(manager, queued.id, d => d.state === 'active');
    manager.clear();
    assert.deepEqual(manager.list(), []);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { for (const r of open) r.destroy(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('biten indirmeler yeniden açılışta döner, kaybolan dosya düşer, başka hesaba karışmaz', async () => {
  const s = await server(), dir = temp(), index = path.join(dir, 'downloads.json'), folder = path.join(dir, 'files');
  try {
    const first = new DownloadManager(() => folder, undefined, undefined, index);
    first.use('hesap-a');
    const a = first.start(`${s.origin}/1.mp4`, 'Birinci', 'mp4'), b = first.start(`${s.origin}/2.mp4`, 'İkinci', 'mp4');
    await wait(first, b.id, d => d.state === 'done');
    await new Promise(r => setTimeout(r, 100));
    const second = new DownloadManager(() => folder, undefined, undefined, index);
    second.use('hesap-a');
    assert.deepEqual(second.list().map(d => [d.id, d.name, d.state]).sort(), [[a.id, 'Birinci.mp4', 'done'], [b.id, 'İkinci.mp4', 'done']].sort());
    const other = new DownloadManager(() => folder, undefined, undefined, index);
    other.use('hesap-b'); assert.deepEqual(other.list(), []);
    fs.rmSync(path.join(folder, 'Birinci.mp4'));
    const third = new DownloadManager(() => folder, undefined, undefined, index);
    third.use('hesap-a'); assert.deepEqual(third.list().map(d => d.name), ['İkinci.mp4']);
    // A hand-edited index must not be able to point outside the folder.
    fs.writeFileSync(index, JSON.stringify({ v: 1, items: [{ id: 'aaaaaaaaaaaaaaaa', profile: 'hesap-a', file: '../x.mp4' }, { id: 'zz', profile: 'hesap-a', file: 'İkinci.mp4' }] }));
    const fourth = new DownloadManager(() => folder, undefined, undefined, index);
    fourth.use('hesap-a'); assert.deepEqual(fourth.list(), []);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('yerel oynatma: tam dosya, Range, sondan Range, hatalı Range, bilinmeyen kimlik; çöpe taşıma', async () => {
  const s = await server(), dir = temp(), trashed: string[] = [], manager = new DownloadManager(() => dir, undefined, async file => { trashed.push(file); fs.rmSync(file); });
  try {
    const job = manager.start(`${s.origin}/a.mp4`, 'Yerel', 'mp4');
    assert.throws(() => manager.open(job.id), /bulunamadı/);
    await wait(manager, job.id, d => d.state === 'done');
    const url = manager.open(job.id), get = (headers: Record<string, string> = {}, method = 'GET', id = job.id) => manager.serve(new Request(url.replace(job.id, id), { method, headers }));
    let r = await get(); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'video/mp4'); assert.deepEqual(Buffer.from(await r.arrayBuffer()), body);
    r = await get({ Range: 'bytes=100-199' }); assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes 100-199/${body.length}`); assert.deepEqual(Buffer.from(await r.arrayBuffer()), body.subarray(100, 200));
    r = await get({ Range: 'bytes=-50' }); assert.deepEqual(Buffer.from(await r.arrayBuffer()), body.subarray(body.length - 50));
    r = await get({ Range: `bytes=${body.length + 5}-` }); assert.equal(r.status, 416);
    r = await get({}, 'HEAD'); assert.equal(r.status, 200); assert.equal(r.headers.get('content-length'), String(body.length));
    assert.equal((await get({}, 'GET', 'ffffffffffffffff')).status, 404);
    assert.equal((await get({}, 'POST')).status, 404);
    await manager.trash(job.id);
    assert.deepEqual(trashed, [path.join(dir, 'Yerel.mp4')]); assert.deepEqual(manager.list(), []);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('dosya boyutu ilk bayt istenerek bulunur; sayfa, hata ve ulaşılamayan sunucu 0 verir', async () => {
  let mode: 'range' | 'whole' | 'html' | 'deny' = 'range', asked = '';
  const s = await server((req, res) => {
    asked = String(req.headers.range || '');
    if (mode === 'range') { res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Length': 1, 'Content-Range': `bytes 0-0/${body.length}` }); res.end(body.subarray(0, 1)); }
    else if (mode === 'whole') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length }); res.write(body.subarray(0, 1000)); }
    else if (mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': 5 }); res.end('<b>x</b>'); }
    else { res.writeHead(403); res.end(); }
  });
  const manager = new DownloadManager(() => temp());
  try {
    assert.equal(await manager.size(`${s.origin}/a.mp4`), body.length); assert.equal(asked, 'bytes=0-0');
    mode = 'whole'; assert.equal(await manager.size(`${s.origin}/a.mp4`), body.length);
    mode = 'html'; assert.equal(await manager.size(`${s.origin}/a.mp4`), 0);
    mode = 'deny'; assert.equal(await manager.size(`${s.origin}/a.mp4`), 0);
  } finally { s.close(); }
  assert.equal(await manager.size('http://127.0.0.1:1/a.mp4'), 0);
});
test('aynı film ikinci kez indirilmez: kimlik aynı kalır, dosya tek, başarısız olan yeniden başlar, kaynak yeniden açılışta korunur', async () => {
  let deny = true;
  const s = await server((req, res) => {
    if (deny) { res.writeHead(403); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length }); res.end(body);
  });
  const dir = temp(), index = path.join(dir, 'downloads.json'), folder = path.join(dir, 'files'), manager = new DownloadManager(() => folder, undefined, undefined, index);
  try {
    manager.use('hesap');
    const first = manager.start(`${s.origin}/a.mp4`, 'Film', 'mp4', 'vod:7');
    assert.equal(first.source, 'vod:7');
    await wait(manager, first.id, d => d.state === 'failed');
    deny = false;
    const again = manager.start(`${s.origin}/a.mp4`, 'Film', 'mp4', 'vod:7');
    assert.equal(again.id, first.id); assert.ok(['queued', 'active'].includes(again.state));
    await wait(manager, first.id, d => d.state === 'done');
    const third = manager.start(`${s.origin}/a.mp4`, 'Film', 'mp4', 'vod:7');
    assert.equal(third.id, first.id); assert.equal(third.state, 'done');
    // Another film, or the same id under another kind, is a different download; a malformed key is ignored.
    const other = manager.start(`${s.origin}/b.mp4`, 'Film', 'mp4', 'series:7'), junk = manager.start(`${s.origin}/c.mp4`, 'Film', 'mp4', '../x');
    assert.notEqual(other.id, first.id); assert.equal(junk.source, undefined);
    await wait(manager, junk.id, d => d.state === 'done');
    assert.deepEqual(fs.readdirSync(folder).sort(), ['Film (2).mp4', 'Film (3).mp4', 'Film.mp4']);
    await new Promise(r => setTimeout(r, 100));
    const restarted = new DownloadManager(() => folder, undefined, undefined, index);
    restarted.use('hesap');
    assert.deepEqual(restarted.list().map(d => d.source).sort(), ['series:7', 'vod:7', undefined]);
    assert.equal(restarted.start(`${s.origin}/a.mp4`, 'Film', 'mp4', 'vod:7').state, 'done');
    assert.equal(fs.readdirSync(folder).length, 3);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('yeniden deneme: aralıklar sırayla uygulanır, bağlantı gelince kaldığı yerden biter', async () => {
  let failing = 3;
  const s = await server((req, res) => {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || ''), from = m ? Number(m[1]) : 0;
    if (failing > 0) { failing--; res.writeHead(503); res.end(); return; }
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': body.length - from, ...(m ? { 'Content-Range': `bytes ${from}-${body.length - 1}/${body.length}` } : {}) }); res.end(body.subarray(from));
  });
  const dir = temp(), manager = new DownloadManager(() => dir, undefined, undefined, undefined, [40, 80, 160]);
  try {
    manager.configure({ autoRetry: true });
    const job = manager.start(`${s.origin}/a.mp4`, 'Deneme', 'mp4');
    const seen: number[] = [];
    for (let i = 0; i < 400; i++) { const row = manager.list()[0]; if (row.state === 'waiting' && !seen.includes(row.retry!.n)) { seen.push(row.retry!.n); assert.equal(row.retry!.max, 8); assert.match(row.error || '', /503/); } if (row.state === 'done') break; await new Promise(r => setTimeout(r, 10)); }
    assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(manager.list()[0].state, 'done'); assert.equal(manager.list()[0].retry, undefined);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'Deneme.mp4')), body); assert.equal(job.state === 'queued' || job.state === 'active', true);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('yeniden deneme: kalıcı hatalar denenmez; kapalıyken hiç denenmez', async () => {
  let status = 404, hits = 0;
  const s = await server((_req, res) => { hits++; res.writeHead(status); res.end(); });
  const dir = temp(), manager = new DownloadManager(() => dir, undefined, undefined, undefined, [20]);
  try {
    const off = manager.start(`${s.origin}/a.mp4`, 'Kapalı', 'mp4'); status = 503;
    const closed = manager.start(`${s.origin}/b.mp4`, 'Kapalı2', 'mp4');
    await wait(manager, closed.id, d => d.state === 'failed'); await new Promise(r => setTimeout(r, 120));
    assert.equal(manager.list().find(d => d.id === closed.id)!.state, 'failed'); void off;
    manager.configure({ autoRetry: true }); hits = 0; status = 404;
    const gone = manager.start(`${s.origin}/c.mp4`, 'Yok', 'mp4');
    await wait(manager, gone.id, d => d.state === 'failed'); await new Promise(r => setTimeout(r, 120));
    assert.equal(hits, 1); assert.match(manager.list().find(d => d.id === gone.id)!.error || '', /404/);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('yeniden deneme: en fazla 8 kez; bekleme iptal ve kapatılabilir', async () => {
  let hits = 0;
  const s = await server((_req, res) => { hits++; res.writeHead(503); res.end(); });
  const dir = temp(), manager = new DownloadManager(() => dir, undefined, undefined, undefined, [5]);
  try {
    manager.configure({ autoRetry: true });
    const job = manager.start(`${s.origin}/a.mp4`, 'Sınır', 'mp4');
    await wait(manager, job.id, d => d.state === 'failed');
    assert.equal(hits, 9); // the first try and eight more
    // Waiting can be ended by cancel, and by switching the setting off.
    const slow = new DownloadManager(() => dir, undefined, undefined, undefined, [60000]);
    slow.configure({ autoRetry: true });
    const a = slow.start(`${s.origin}/b.mp4`, 'Bekle', 'mp4'), b = slow.start(`${s.origin}/c.mp4`, 'Bekle2', 'mp4');
    await wait(slow, a.id, d => d.state === 'waiting'); await wait(slow, b.id, d => d.state === 'waiting');
    slow.cancel(a.id); assert.equal(slow.list().find(d => d.id === a.id)!.state, 'canceled');
    slow.configure({ autoRetry: false });
    const row = slow.list().find(d => d.id === b.id)!; assert.equal(row.state, 'failed'); assert.equal(row.retry, undefined);
    slow.retry(b.id); assert.ok(['queued', 'active', 'waiting', 'failed'].includes(slow.list().find(d => d.id === b.id)!.state));
    slow.clear();
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('kitaplık: otomatik yeniden deneme varsayılan kapalı, yalnızca true ile açılır', () => {
  assert.equal(normalizeLibrary({}).preferences.autoRetry, false);
  assert.equal(normalizeLibrary({ preferences: { autoRetry: true } }).preferences.autoRetry, true);
  for (const value of ['true', 1, null]) assert.equal(normalizeLibrary({ preferences: { autoRetry: value } }).preferences.autoRetry, false);
});

test('yeniden deneme: her denemede 1 MB ilerleyen indirme sayaç sıfırlandığı için 8 denemeden fazla kesilse de biter', async () => {
  const big = Buffer.alloc(12 * 1024 * 1024, 7);
  let cuts = 0;
  const s = await server((req, res) => {
    const m = /^bytes=(\d+)-$/.exec(req.headers.range || ''), from = m ? Number(m[1]) : 0, rest = big.length - from, send = Math.min(rest, 1.2 * 1024 * 1024);
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': rest, ...(m ? { 'Content-Range': `bytes ${from}-${big.length - 1}/${big.length}` } : {}) });
    res.write(big.subarray(from, from + send));
    if (send < rest) { cuts++; setTimeout(() => res.destroy(), 20); } else res.end();
  });
  const dir = temp(), manager = new DownloadManager(() => dir, undefined, undefined, undefined, [5]);
  try {
    manager.configure({ autoRetry: true });
    const job = manager.start(`${s.origin}/big.mp4`, 'Büyük', 'mp4');
    await wait(manager, job.id, d => d.state === 'done' || d.state === 'failed');
    assert.equal(manager.list()[0].state, 'done'); assert.ok(cuts > 8, `cuts=${cuts}`);
    assert.equal(fs.statSync(path.join(dir, 'Büyük.mp4')).size, big.length);
  } finally { s.close(); fs.rmSync(dir, { recursive: true }); }
});
