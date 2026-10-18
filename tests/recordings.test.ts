import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import ffmpeg from 'ffmpeg-static';
import { DownloadManager } from '../src/platform/mac/downloads';
import { RecordingManager, parsePlaylist } from '../src/platform/mac/recordings';
import type { Recording } from '../src/core/models';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mrt-rec-media-'));
let pattern: Buffer, segments: string[];
before(() => {
  const run = (...args: string[]) => execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  run('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '25', '-c:a', 'aac', '-f', 'mpegts', path.join(root, 'pattern.ts'));
  run('-i', path.join(root, 'pattern.ts'), '-c', 'copy', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0', '-hls_segment_filename', path.join(root, 'seg%d.ts'), path.join(root, 'index.m3u8'));
  pattern = fs.readFileSync(path.join(root, 'pattern.ts'));
  segments = fs.readdirSync(root).filter(name => /^seg\d+\.ts$/.test(name));
});
after(() => fs.rmSync(root, { recursive: true, force: true }));
type Mode = 'live' | 'drop' | 'hls' | 'playlist-as-ts' | 'refuse';
async function server(mode: () => Mode) {
  const held: http.ServerResponse[] = [];
  let tsHits = 0;
  const media = () => fs.readFileSync(path.join(root, 'index.m3u8'), 'utf8');
  const s = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname.endsWith('.m3u8') && url.pathname.startsWith('/live/')) { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\n/hls/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900\n/hls/index.m3u8\n`); return; }
    if (url.pathname === '/hls/index.m3u8') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(media()); return; }
    const seg = /^\/hls\/(seg\d+\.ts)$/.exec(url.pathname);
    if (seg) { res.writeHead(200, { 'Content-Type': 'video/mp2t' }); res.end(fs.readFileSync(path.join(root, seg[1]))); return; }
    if (url.pathname.startsWith('/live/') && url.pathname.endsWith('.ts')) {
      tsHits++;
      const m = mode();
      if (m === 'refuse') { res.writeHead(503); res.end(); return; }
      if (m === 'hls') { res.writeHead(404); res.end(); return; }
      if (m === 'playlist-as-ts') { res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' }); res.end(media().replace(/^(seg\d+\.ts)$/gm, '/hls/$1')); return; }
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      if (m === 'drop' && tsHits === 1) { res.write(pattern.subarray(0, 100000)); setTimeout(() => res.destroy(), 50); return; }
      res.write(pattern); held.push(res); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { origin, hits: () => tsHits, close: () => { for (const r of held) r.destroy(); s.closeAllConnections(); s.close(); } };
}
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mrt-rec-'));
function make(dir: string, origin: string, over: Partial<ConstructorParameters<typeof RecordingManager>[0]> = {}) {
  const folder = path.join(dir, 'files'), index = path.join(dir, 'recordings.json');
  const downloads = new DownloadManager(() => folder, undefined, undefined, path.join(dir, 'downloads.json'));
  downloads.use('p');
  const rec = new RecordingManager({ folder: () => folder, index, downloads, ffmpeg: ffmpeg!, tickMs: 50, ...over });
  rec.bind('p', (id, hls) => `${origin}/live/${id}.${hls ? 'm3u8' : 'ts'}`);
  return { folder, downloads, rec, index };
}
async function until(check: () => boolean, ms = 20000) { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 25)); } }
const rows = (rec: RecordingManager) => rec.list();
const valid = (file: string) => execFileSync(ffmpeg!, ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: 'pipe' });
test('yayın listesi: ana liste en iyi kaliteyi seçer, medya listesi numaralanır, şifreli ve fMP4 reddedilir', () => {
  const master = parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nhttps://cdn.example/hi.m3u8\n', 'https://a.example/x/index.m3u8');
  assert.equal(master.variant, 'https://cdn.example/hi.m3u8');
  const media = parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:7\n#EXTINF:4,\ns7.ts\n#EXTINF:4,\n/abs/s8.ts\n', 'https://a.example/x/index.m3u8');
  assert.deepEqual(media.segments, [{ seq: 7, url: 'https://a.example/x/s7.ts' }, { seq: 8, url: 'https://a.example/abs/s8.ts' }]);
  assert.equal(media.target, 4); assert.equal(media.ended, false);
  assert.ok(parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n', 'https://a/b.m3u8').unsupported);
  assert.ok(parsePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\na.m4s\n', 'https://a/b.m3u8').unsupported);
  assert.equal(parsePlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\na.ts\n', 'https://a/b.m3u8').unsupported, undefined);
  assert.throws(() => parsePlaylist('<html>', 'https://a/b.m3u8'), /geçerli/);
});
test('kayıt: .ts akışı yazılır, durdurulunca MP4 olur, indirilenlere girer, ham dosya silinir', async () => {
  const s = await server(() => 'live'), dir = temp(), { rec, downloads, folder } = make(dir, s.origin);
  try {
    const row = rec.start('7', 'Haber / Kanalı');
    assert.equal(row.state, 'recording'); assert.match(row.name, /^Haber Kanalı \d{4}-\d\d-\d\d \d\d\.\d\d$/);
    await until(() => rows(rec)[0].bytes >= pattern.length);
    assert.equal(rec.start('7', 'Haber / Kanalı').id, row.id); // the same channel is not recorded twice
    rec.stop(row.id);
    await until(() => rows(rec)[0].state === 'done');
    const done = rows(rec)[0];
    assert.equal(done.id, row.id); assert.match(done.name, /\.mp4$/); assert.ok(done.fileId);
    const file = path.join(folder, done.name); valid(file);
    assert.deepEqual(fs.readdirSync(folder), [done.name]);
    assert.equal(downloads.list()[0].source, `rec:${row.id}`);
    assert.equal(rows(rec).length, 1);
  } finally { rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('kayıt: HLS-only kanal (.ts 404) ana liste ve segmentlerle kaydedilir ve MP4 olur', async () => {
  const s = await server(() => 'hls'), dir = temp(), { rec, folder } = make(dir, s.origin);
  try {
    rec.start('8', 'Sadece HLS');
    await until(() => rows(rec)[0].state === 'done');
    valid(path.join(folder, rows(rec)[0].name));
    assert.ok(s.hits() >= 1);
  } finally { rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('kayıt: .ts adresine yayın listesi dönerse HLS gibi kaydedilir', async () => {
  const s = await server(() => 'playlist-as-ts'), dir = temp(), { rec, folder } = make(dir, s.origin);
  try {
    rec.start('9', 'Liste');
    await until(() => rows(rec)[0].state === 'done');
    valid(path.join(folder, rows(rec)[0].name));
  } finally { rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('kayıt: bağlantı kopunca yeniden bağlanır ve aynı dosyaya devam eder', async () => {
  const s = await server(() => 'drop'), dir = temp(), { rec, folder } = make(dir, s.origin);
  try {
    const row = rec.start('10', 'Kopan');
    await until(() => s.hits() >= 2 && rows(rec)[0].bytes >= 100000 + pattern.length, 30000);
    rec.stop(row.id);
    await until(() => rows(rec)[0].state === 'done');
    valid(path.join(folder, rows(rec)[0].name));
  } finally { rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('kayıt: süre dolunca kendiliğinden durur; veri gelmeyen kanal başarısız olur ve dosya bırakmaz', async () => {
  const s = await server(() => 'live'), dir = temp(), { rec, folder } = make(dir, s.origin);
  try {
    rec.start('11', 'Süreli', 0.03); // 1.8 s
    await until(() => rows(rec)[0].state === 'done');
  } finally { rec.shutdown(); s.close(); }
  const dead = await server(() => 'refuse'), d2 = temp(), second = make(d2, dead.origin, { backoffMs: 20 });
  try {
    second.rec.start('12', 'Ölü');
    await until(() => rows(second.rec)[0].state === 'failed');
    assert.match(rows(second.rec)[0].error || '', /503|veri|alın/);
    assert.deepEqual(fs.existsSync(second.folder) ? fs.readdirSync(second.folder) : [], []);
  } finally { second.rec.shutdown(); dead.close(); fs.rmSync(dir, { recursive: true }); fs.rmSync(d2, { recursive: true }); void folder; }
});
test('planlı kayıt: zamanı gelince başlar, bitince durur ve MP4 olur; geçmiş zamanda planlanamaz', async () => {
  const s = await server(() => 'live'), dir = temp(), { rec, folder } = make(dir, s.origin);
  try {
    const now = Date.now();
    assert.throws(() => rec.schedule('13', 'Plan', now - 5000, now - 1000), /gelecekte/);
    assert.throws(() => rec.schedule('13', 'Plan', now, now + 13 * 3600000), /12 saat/);
    assert.throws(() => rec.schedule('13', 'Plan', now + 20 * 86400000, now + 20 * 86400000 + 1000), /gün/);
    const row = rec.schedule('13', 'Plan', now + 600, now + 3000);
    assert.equal(row.state, 'scheduled');
    await until(() => rows(rec)[0].state === 'recording');
    await until(() => rows(rec)[0].state === 'done');
    valid(path.join(folder, rows(rec)[0].name));
  } finally { rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('planlar hesaba bağlı kalır: yeniden açılışta bekleyen plan sürer, geçmiş plan kaçırıldı olur', async () => {
  const s = await server(() => 'live'), dir = temp(), first = make(dir, s.origin);
  try {
    const soon = first.rec.schedule('14', 'Gelecek', Date.now() + 60000, Date.now() + 120000), late = first.rec.schedule('15', 'Kaçacak', Date.now() + 500, Date.now() + 900);
    first.rec.bind('', undefined); // signed out before either time: nothing is lost
    assert.equal(first.rec.list().length, 0);
    await new Promise(r => setTimeout(r, 1200));
    const again = new RecordingManager({ folder: () => first.folder, index: first.index, downloads: first.downloads, ffmpeg: ffmpeg!, tickMs: 50 });
    again.bind('p', (id, hls) => `${s.origin}/live/${id}.${hls ? 'm3u8' : 'ts'}`);
    const byId = Object.fromEntries(again.list().map(r => [r.id, r]));
    assert.equal(byId[soon.id].state, 'scheduled'); assert.equal(byId[late.id].state, 'missed'); assert.match(byId[late.id].error || '', /geçti/);
    // Another account sees none of them.
    const other = new RecordingManager({ folder: () => first.folder, index: first.index, downloads: first.downloads, ffmpeg: ffmpeg!, tickMs: 50 });
    other.bind('q', () => ''); assert.deepEqual(other.list().filter(r => r.state !== 'done'), []);
    again.remove(late.id); again.remove(soon.id);
    assert.deepEqual(again.list(), []); again.shutdown(); other.shutdown();
  } finally { first.rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('çıkış yapınca süren kayıt durur, ham dosya kalır ve sonraki girişte MP4 olur', async () => {
  const s = await server(() => 'live'), dir = temp(), first = make(dir, s.origin);
  try {
    first.rec.start('16', 'Yarım');
    await until(() => first.rec.list()[0].bytes >= pattern.length);
    first.rec.bind('', undefined);
    assert.equal(first.rec.list().length, 0);
    assert.equal(fs.readdirSync(first.folder).filter(f => f.endsWith('.ts')).length, 1);
    const again = new RecordingManager({ folder: () => first.folder, index: first.index, downloads: first.downloads, ffmpeg: ffmpeg!, tickMs: 50 });
    again.bind('p', () => '');
    await until(() => again.list()[0]?.state === 'done');
    valid(path.join(first.folder, again.list()[0].name));
    assert.deepEqual(fs.readdirSync(first.folder).filter(f => f.endsWith('.ts')), []);
    again.shutdown();
  } finally { first.rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
test('dönüştürücü yoksa kayıt başarısız görünür ama ham dosya durur; en fazla 3 kanal aynı anda', async () => {
  const s = await server(() => 'live'), dir = temp(), { rec, folder } = make(dir, s.origin, { ffmpeg: path.join(dir, 'yok') });
  try {
    for (const id of ['21', '22', '23']) rec.start(id, `K${id}`);
    assert.throws(() => rec.start('24', 'K24'), /en fazla 3/i);
    await until(() => rec.list().every(r => r.bytes > 0));
    const first = rec.list()[0];
    rec.stop(first.id);
    await until(() => rec.list().find(r => r.id === first.id)!.state === 'failed');
    const failed = rec.list().find(r => r.id === first.id)!;
    assert.match(failed.error || '', /bulunamadı/); assert.equal(failed.hasFile, true);
    assert.equal(fs.readdirSync(folder).filter(f => f.endsWith('.ts')).length, 3);
    rec.remove(first.id); assert.equal(rec.list().some(r => r.id === first.id), false);
    assert.equal(fs.readdirSync(folder).filter(f => f.endsWith('.ts')).length, 3); // removing the row keeps the file
  } finally { rec.shutdown(); s.close(); fs.rmSync(dir, { recursive: true }); }
});
void ({} as Recording);
