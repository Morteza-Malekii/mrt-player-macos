import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateRawSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAVED_KEY, cleanSaved, clampSubtitleSize, describeName, fitNote, rankHits, releaseScore } from '../src/core/subtitles';
import { normalizeLibrary } from '../src/core/library';
import { SubtitleShelf } from '../src/platform/mac/shelf';
import type { SubtitleHit } from '../src/core/models';
import { SubtitleService, movieHash, type Source, type StoredKeys } from '../src/platform/mac/subtitles';
import { subtitleFromZip } from '../src/platform/mac/zip';

const hit = (over: Partial<SubtitleHit>): SubtitleHit => ({ id: 'x', provider: 'opensubtitles', language: 'en', release: 'Movie.2010.1080p.BluRay.x264-GRP', hash: false, downloads: 0, hearingImpaired: false, trusted: false, ...over });

test('provider names are reduced to a title, a year and an episode', () => {
  assert.deepEqual(describeName('TR | The Matrix (1999) 4K'), { title: 'The Matrix', year: 1999 });
  assert.deepEqual(describeName('EN - Inception (2010) 1080p BluRay x264'), { title: 'Inception', year: 2010 });
  assert.deepEqual(describeName('Breaking Bad S02E05 Breakage'), { title: 'Breaking Bad', season: 2, episode: 5 });
  assert.deepEqual(describeName('Some.Show.3x07.720p.HDTV'), { title: 'Some Show', season: 3, episode: 7 });
  assert.equal(describeName('Blade Runner 2049').title, 'Blade Runner 2049');
  assert.equal(describeName('2012 (2009)').year, 2009);
  assert.equal(describeName('Wonder Woman 1984').title, 'Wonder Woman 1984');
});

test('finds are ordered English, Persian, Turkish, and the exact-file ones lead their language', () => {
  const ranked = rankHits([
    hit({ id: 'tr', language: 'tr', downloads: 9 }), hit({ id: 'fa', language: 'fa', release: 'a' }), hit({ id: 'en-many', language: 'en', release: 'b', downloads: 500 }),
    hit({ id: 'en-exact', language: 'en', release: 'c', hash: true, downloads: 1 }), hit({ id: 'en-fit', language: 'en', release: 'Movie 1080p BluRay x264', downloads: 2 })
  ], 'Movie 2010 1080p BluRay x264');
  assert.deepEqual(ranked.map(h => h.id), ['en-exact', 'en-fit', 'en-many', 'fa', 'tr']);
  assert.equal(rankHits([hit({ id: 'a' }), hit({ id: 'b' })], '').length, 1, 'the same release is listed once');
  assert.equal(rankHits(Array.from({ length: 20 }, (_, i) => hit({ id: String(i), release: `r${i}` })), '').length, 8, 'a language is capped');
  assert.ok(releaseScore('Movie.1080p.WEB-DL.x264-AB', 'movie 1080p WEBDL') >= 2);
});

test('a subtitle clearly longer than the film is flagged, a normal one is not', () => {
  assert.equal(fitNote(7000, 7200), '');
  assert.match(fitNote(7600, 7200), /uzun/);
  assert.match(fitNote(1000, 7200), /yarısını/);
  assert.equal(fitNote(500, 60), '', 'a short clip says nothing');
});

test('the movie fingerprint is the size plus the 64-bit words of the first and last 64 KB', () => {
  const head = Buffer.alloc(65536), tail = Buffer.alloc(65536);
  head.writeBigUInt64LE(1n, 0); tail.writeBigUInt64LE(0xffffffffffffffffn, 8);
  // 131072 + 1 + (2^64 - 1) wraps around to 131072.
  assert.equal(movieHash(131072, head, tail), '0000000000020000');
  assert.equal(movieHash(100000, head, tail), undefined, 'too small to have two blocks');
});

// A zip with stored or deflated entries, written by hand.
function makeZip(files: Array<[string, string, 0 | 8]>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text, method] of files) {
    const raw = Buffer.from(text), body = method === 8 ? deflateRawSync(raw) : raw, nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(method, 10); entry.writeUInt32LE(crc32(raw), 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, body); central.push(entry, nameBytes); offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
test('the subtitle is taken out of a zip, and a season pack gives the episode asked for', () => {
  const zip = makeZip([['readme.txt', 'hi', 0], ['Show.S01E01.srt', 'ONE', 8], ['Show.S01E02.srt', 'TWO', 8], ['__MACOSX/Show.S01E02.srt', 'junk', 0]]);
  assert.equal(subtitleFromZip(zip)?.data.toString(), 'ONE');
  assert.equal(subtitleFromZip(zip, 2)?.data.toString(), 'TWO');
  assert.equal(subtitleFromZip(zip, 2)?.name, 'Show.S01E02.srt');
  assert.equal(subtitleFromZip(makeZip([['a.nfo', 'x', 0]])), undefined);
  assert.equal(subtitleFromZip(Buffer.from('not a zip at all, just text')), undefined);
});

// --- the service against two stand-in servers ---
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';
async function listen(handler: http.RequestListener) { const server = http.createServer(handler); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }; }
const memory = (keys: StoredKeys) => { let stored = keys; return { load: async () => stored, save: async (next: StoredKeys) => { stored = next; } }; };
const file = (size: number): Source => ({ size, read: async (offset, length) => { const b = Buffer.alloc(length); if (offset === 0) b.writeBigUInt64LE(1n, 0); return b; } });

test('both services are searched with the file fingerprint, ranked together, and a pick is downloaded', async () => {
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }> = [];
  const zip = makeZip([['Movie.2010.srt', SRT, 8]]);
  const os = await listen(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({ url: req.url!, headers: req.headers, body });
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/subtitles') {
      const exact = url.searchParams.has('moviehash');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: exact ? [{ attributes: { language: 'tr', moviehash_match: true, release: 'Exact.Turkish', download_count: 5, files: [{ file_id: 11, file_name: 'x.srt' }] } }]
        : [{ attributes: { language: 'en', release: 'Movie.2010.1080p.BluRay.x264', download_count: 900, from_trusted: true, files: [{ file_id: 12, file_name: 'e.srt' }] } }, { attributes: { language: 'de', release: 'German', files: [{ file_id: 13, file_name: 'd.srt' }] } }] }));
    } else if (url.pathname === '/download') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ link: `${os.url}/file/12`, remaining: 4 })); }
    else if (url.pathname === '/file/12') res.end(SRT);
    else { res.statusCode = 404; res.end(); }
  });
  const sd = await listen((req, res) => {
    seen.push({ url: req.url!, headers: req.headers, body: '' });
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/subtitles') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: true, subtitles: [{ release_name: 'Movie.2010.WEB', language: 'FA', url: '/subtitle/1-2.zip', hi: false }, { release_name: 'Evil', language: 'EN', url: '//evil.example/x.zip' }] })); }
    else if (url.pathname === '/subtitle/1-2.zip') res.end(zip);
    else { res.statusCode = 404; res.end(); }
  });
  try {
    const service = new SubtitleService(memory({ opensubtitles: { key: 'OSKEY' }, subdl: { key: 'SDKEY' } }), async () => file(200000), { openSubtitles: os.url, subdl: sd.url, subdlFiles: sd.url });
    const result = await service.search({ title: 'Movie', year: 2010, tmdb: 603, hint: 'Movie 2010 1080p BluRay x264', source: 'kiyi://media/abc' });
    assert.deepEqual(result.notes, []);
    assert.deepEqual(result.hits.map(h => `${h.language}:${h.release}`), ['en:Movie.2010.1080p.BluRay.x264', 'fa:Movie.2010.WEB', 'tr:Exact.Turkish']);
    assert.equal(result.hits[2].hash, true);
    const search = seen.filter(s => s.url.startsWith('/subtitles') && s.headers['api-key']);
    assert.equal(search.length, 2, 'one search by fingerprint, one by film number');
    assert.ok(search.some(s => s.url.includes('moviehash=0000000000030d41')), 'the fingerprint of a 200000-byte file whose first word is 1');
    assert.ok(search.some(s => s.url.includes('tmdb_id=603') && s.url.includes('languages=en%2Cfa%2Ctr')));
    assert.equal(search[0].headers['api-key'], 'OSKEY');
    assert.ok(seen.some(s => s.url.includes('api_key=SDKEY') && s.url.includes('languages=EN%2CFA%2CTR') && s.url.includes('tmdb_id=603')));
    assert.ok(!JSON.stringify(result).includes('KEY'), 'no key reaches the page');
    assert.equal(result.hits.some(h => h.release === 'Evil'), false, 'a link to another host is dropped');
    const english = await service.get(result.hits[0].id);
    assert.equal(Buffer.from(english.data, 'base64').toString(), SRT);
    assert.equal(english.name, 'e.srt');
    const persian = await service.get(result.hits[1].id);
    assert.equal(Buffer.from(persian.data, 'base64').toString(), SRT);
    assert.equal(persian.name, 'Movie.2010.srt');
    await assert.rejects(service.get('nope'), /listede değil/);
  } finally { os.server.close(); sd.server.close(); }
});

test('without a key the search says so, one failing service does not hide the other, and keys can be cleared', async () => {
  const bad = await listen((_req, res) => { res.statusCode = 403; res.end('{}'); });
  const good = await listen((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: false, error: "Can't find movie" })); });
  try {
    const keys = memory({});
    const service = new SubtitleService(keys, async () => undefined, { openSubtitles: bad.url, subdl: good.url, subdlFiles: good.url });
    await assert.rejects(service.search({ title: 'X', hint: 'X' }), /API anahtarı/);
    assert.deepEqual(await service.save({ opensubtitlesKey: 'a', subdlKey: 'b' }), { opensubtitles: true, opensubtitlesLogin: false, subdl: true });
    const result = await service.search({ title: 'X', hint: 'X' });
    assert.equal(result.hits.length, 0);
    assert.equal(result.notes.length, 1);
    assert.match(result.notes[0], /^OpenSubtitles: API anahtarı reddedildi/);
    assert.deepEqual(await service.save({ opensubtitlesKey: '', subdlKey: '' }), { opensubtitles: false, opensubtitlesLogin: false, subdl: false });
    await assert.rejects(service.save({ subdlKey: 'has space' }), /geçersiz/);
  } finally { bad.server.close(); good.server.close(); }
});

test('a saved subtitle set is checked: bad files, picks that name nothing, odd shifts and doubled slots are cleaned', () => {
  const good = { files: [{ name: 'a.srt', text: '1\n00:00:01,000 --> 00:00:02,000\nHi' }, { name: 'b.srt', text: 'x' }], main: { file: 'a.srt' }, second: { track: 3 }, shift: { main: 1.26, second: -9999 } };
  assert.deepEqual(cleanSaved(good), { files: good.files, main: { file: 'a.srt' }, second: { track: 3 }, shift: { main: 1.3, second: -3600 } });
  const odd = cleanSaved({ files: [{ name: '', text: 'x' }, { name: 'ok.srt', text: 'x' }, { name: 'ok.srt', text: 'again' }, { name: 'big.srt', text: 'x'.repeat(2 * 1024 * 1024 + 1) }, { name: 5, text: 'x' }, null], main: { file: 'missing.srt' }, second: { track: -1 }, shift: 'no' })!;
  assert.deepEqual(odd.files, [{ name: 'ok.srt', text: 'x' }]);
  assert.deepEqual([odd.main, odd.second, odd.shift], ['off', 'off', { main: 0, second: 0 }]);
  assert.equal(cleanSaved({ files: [{ name: 'a.srt', text: 'x' }], main: { file: 'a.srt' }, second: { file: 'a.srt' } })!.second, 'off', 'never the same subtitle twice');
  assert.equal(cleanSaved({ files: Array.from({ length: 20 }, (_, i) => ({ name: `f${i}.srt`, text: 'x' })) })!.files.length, 8);
  for (const bad of [null, 'text', 7, {}, { files: 'x' }]) assert.equal(cleanSaved(bad), null);
  for (const key of ['vod:123', 'series:episode:4567', 'local:ab12-cd34']) assert.ok(SAVED_KEY.test(key), key);
  for (const key of ['../x', 'vod:', 'live:1/2', 'other:1', 'vod:123\n', '']) assert.equal(SAVED_KEY.test(key), false, key);
});

test('the shelf keeps one set per account and film, in a hashed file name, and forgets them all on request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-')), shelf = new SubtitleShelf(path.join(dir, 'saves'));
  try {
    const set = cleanSaved({ files: [{ name: 'a.srt', text: 'Merhaba' }], main: { file: 'a.srt' }, second: 'off', shift: { main: 0.5, second: 0 } })!;
    assert.equal(await shelf.read('p1', 'vod:1'), null);
    await shelf.write('p1', 'vod:1', set); await shelf.write('p2', 'vod:1', { ...set, shift: { main: 2, second: 0 } });
    assert.deepEqual(await shelf.read('p1', 'vod:1'), set);
    assert.equal((await shelf.read('p2', 'vod:1'))!.shift.main, 2, 'another account has its own');
    assert.equal(await shelf.read('p1', 'vod:2'), null, 'another film has none');
    const names = fs.readdirSync(path.join(dir, 'saves'));
    assert.equal(names.length, 2); assert.ok(names.every(n => /^subtitles-[a-f0-9]{32}\.json$/.test(n)), 'no film or account in a file name');
    await shelf.delete('p1', 'vod:1'); assert.equal(await shelf.read('p1', 'vod:1'), null);
    await shelf.clear(); assert.deepEqual(fs.readdirSync(path.join(dir, 'saves')), []);
    await shelf.clear();
    fs.writeFileSync(path.join(dir, 'saves', `subtitles-${'0'.repeat(32)}.json`), '{ not json');
    assert.equal(await new SubtitleShelf(path.join(dir, 'saves')).read('x', 'vod:1'), null, 'a damaged file reads as nothing');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('subtitle size and font are kept only when they are valid and not the default', () => {
  assert.equal(clampSubtitleSize(134), 130); assert.equal(clampSubtitleSize(5), 50); assert.equal(clampSubtitleSize(999), 300);
  assert.deepEqual(normalizeLibrary({ preferences: { subtitleSize: 160, subtitleFont: 'serif' } }).preferences, { ...normalizeLibrary({}).preferences, subtitleSize: 160, subtitleFont: 'serif' });
  assert.equal(normalizeLibrary({ preferences: { subtitleSize: 1000 } }).preferences.subtitleSize, 300);
  for (const preferences of [{ subtitleSize: 100, subtitleFont: 'system' }, { subtitleSize: 'big', subtitleFont: 'Comic Sans' }, { subtitleSize: NaN, subtitleFont: '__proto__' }, { subtitleFont: 'toString' }]) {
    const out = normalizeLibrary({ preferences }).preferences;
    assert.equal('subtitleSize' in out, false, JSON.stringify(preferences)); assert.equal('subtitleFont' in out, false, JSON.stringify(preferences));
  }
});
