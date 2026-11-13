// Reading a film's own tracks and subtitles from the bytes the player streams (platform/mac/container.ts,
// inspector.ts), the names shown for them (core/tracks.ts) and the converter's command line (remux.ts).
// The films are made here with the same FFmpeg the app ships; nothing comes from a provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import ffmpeg from 'ffmpeg-static';
import { MatroskaReader, Mp4Reader, assText, sniff, type ContainerHeader, type TextCue } from '../src/platform/mac/container';
import { MediaInspector, keyOf } from '../src/platform/mac/inspector';
import { MediaGateway } from '../src/platform/mac/media';
import { remuxArgs } from '../src/platform/mac/remux';
import { mediaTrackNames, nativeIndex, startingTrack } from '../src/core/tracks';

const dir = fs.mkdtempSync(path.join(tmpdir(), 'mrt-container-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const run = (args: string[]) => execFileSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const srt = (name: string, lines: Array<[number, number, string]>) => { const file = path.join(dir, name); fs.writeFileSync(file, lines.map(([a, b, text], i) => `${i + 1}\n${stamp(a)} --> ${stamp(b)}\n${text}\n`).join('\n')); return file; };
const stamp = (s: number) => `00:00:${String(Math.floor(s)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`;
// 20 seconds, a keyframe every second: a dub in AAC (English, default), one in 5.1 E-AC-3 (Turkish, named),
// an English subtitle named SDH and a forced Turkish one in ASS with styling that must not show.
const english = srt('en.srt', [[1, 3, 'Hello <i>one</i>'], [9, 11, 'Hello two'], [17, 19, 'Hello three']]);
const turkish = srt('tr.srt', [[2, 4, '{\\an8}Merhaba bir'], [10, 12, 'Merhaba iki\nikinci satır'], [18, 19.5, 'Merhaba üç']]);
const mkv = path.join(dir, 'film.mkv'), mp4 = path.join(dir, 'film.mp4'), tail = path.join(dir, 'tail.mp4');
run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-i', english, '-i', turkish, '-t', '20',
  '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3', '-map', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p',
  '-c:a:0', 'aac', '-c:a:1', 'eac3', '-ac:a:1', '6', '-c:s:0', 'srt', '-c:s:1', 'ass',
  '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=tur', '-metadata:s:a:1', 'title=Dublaj', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=SDH', '-metadata:s:s:1', 'language=tur',
  '-disposition:a:0', 'default', '-disposition:a:1', '0', '-disposition:s:0', '0', '-disposition:s:1', 'forced', mkv]);
run(['-i', mkv, '-map', '0:v', '-map', '0:a', '-map', '0:s:0', '-c:v', 'copy', '-c:a:0', 'copy', '-c:a:1', 'ac3', '-c:s', 'mov_text', '-movflags', '+faststart', mp4]);
run(['-i', mp4, '-map', '0', '-c', 'copy', tail]);
const bytes = (file: string) => new Uint8Array(fs.readFileSync(file));

// Feeds a byte range in uneven pieces, as a network delivers it.
function feed(data: Uint8Array, from: number, make: (offset: number, shared: { header?: ContainerHeader; onHeader(h: ContainerHeader): void; onCue(c: TextCue): void }) => { push(chunk: Uint8Array): void }, header?: ContainerHeader) {
  const out = { header, cues: [] as TextCue[] };
  const reader = make(from, { get header() { return out.header; }, onHeader: h => { out.header ??= h; }, onCue: c => out.cues.push(c) });
  let at = from, size = 1;
  while (at < data.length) { const n = Math.min(size, data.length - at); reader.push(data.slice(at, at + n)); at += n; size = (size * 7 + 13) % 70000 + 1; }
  return out;
}

test('Matroska: başlıktan bütün sesler ve altyazılar, dil, ad, varsayılan ve kanal sayısıyla okunur', () => {
  const data = bytes(mkv);
  assert.equal(sniff(data.subarray(0, 16)), 'matroska');
  const { header } = feed(data, 0, (o, s) => new MatroskaReader(o, s));
  assert.ok(header);
  assert.equal(header.format, 'matroska');
  assert.ok(Math.abs(header.duration - 20) < 0.2, String(header.duration));
  assert.deepEqual(header.tracks.map(t => [t.index, t.type, t.codec, t.language, t.name, t.default, t.forced, t.channels]), [
    [0, 'video', 'avc', 'und', '', false, false, undefined],
    [1, 'audio', 'aac', 'eng', '', true, false, 1],
    [2, 'audio', 'eac3', 'tur', 'Dublaj', false, false, 6],
    [3, 'subtitle', 'srt', 'eng', 'SDH', false, false, undefined],
    [4, 'subtitle', 'ass', 'tur', '', false, true, undefined]
  ]);
});

test('Matroska: dosyadaki altyazı satırları zamanıyla ve biçem etiketleri olmadan çıkar; ortadan başlayan okuma kümeyi bulur', () => {
  const data = bytes(mkv);
  const whole = feed(data, 0, (o, s) => new MatroskaReader(o, s));
  const en = whole.cues.filter(c => c.track === 4), tr = whole.cues.filter(c => c.track === 5);
  assert.deepEqual(en.map(c => [c.start, c.end, c.text]), [[1, 3, 'Hello <i>one</i>'], [9, 11, 'Hello two'], [17, 19, 'Hello three']]);
  assert.deepEqual(tr.map(c => [c.start, c.end, c.text]), [[2, 4, 'Merhaba bir'], [10, 12, 'Merhaba iki\nikinci satır'], [18, 19.5, 'Merhaba üç']]);
  // A seek: the player asks for the file from somewhere in the middle. Only what follows is read, and it
  // is read right, with the track list learned from the start of the file.
  const middle = feed(data, Math.floor(data.length * 0.6), (o, s) => new MatroskaReader(o, s), whole.header);
  assert.ok(middle.cues.length >= 2 && middle.cues.length < whole.cues.length, String(middle.cues.length));
  for (const cue of middle.cues) assert.ok(whole.cues.some(c => c.track === cue.track && c.start === cue.start && c.text === cue.text));
  assert.ok(middle.cues.some(c => c.text === 'Merhaba üç'));
  // Without the track list nothing is guessed.
  assert.deepEqual(feed(data, Math.floor(data.length * 0.6), (o, s) => new MatroskaReader(o, s)).cues, []);
});

test('MP4: başlık kutusu nerede olursa olsun izler okunur, AC-3 ses ve MP4 altyazısı listelenir', () => {
  for (const file of [mp4, tail]) {
    const data = bytes(file);
    assert.equal(sniff(data.subarray(0, 16)), 'mp4');
    const fromStart = feed(data, 0, (_o, s) => new Mp4Reader(s));
    assert.ok(fromStart.header, file);
    const header = fromStart.header!;
    assert.ok(Math.abs(header.duration - 20) < 0.2);
    assert.deepEqual(header.tracks.map(t => [t.index, t.type, t.codec, t.language, t.default, t.channels]), [
      [0, 'video', 'avc', 'und', true, undefined], [1, 'audio', 'aac', 'eng', true, 1], [2, 'audio', 'ac3', 'tur', false, 6], [3, 'subtitle', 'tx3g', 'eng', true, undefined]
    ]);
  }
  // A range that starts inside the picture data is not taken for a header.
  const data = bytes(mp4);
  assert.equal(feed(data, Math.floor(data.length / 2), (_o, s) => new Mp4Reader(s)).header, undefined);
});

test('ASS satırı: yalnızca metin, satır sonu ve boşluk; çizim komutu atlanır', () => {
  assert.equal(assText('3,0,Default,,0,0,0,,{\\i1}Merhaba{\\i0}, dünya\\Nikinci\\hsatır'), 'Merhaba, dünya\nikinci satır');
  assert.equal(assText('4,0,Sign,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}'), '');
  assert.equal(assText('kısa,satır'), '');
});

test('izleyici: izlenen dosya okunur, sayfa izleri ve satırları alır, tekrar okunan satır bir kez tutulur', () => {
  const data = bytes(mkv), inspector = new MediaInspector(() => true), url = 'kiyi://media/' + 'a'.repeat(48);
  assert.equal(keyOf(url), 'media/' + 'a'.repeat(48));
  assert.equal(keyOf('kiyi://image/live/1'), undefined);
  assert.equal(inspector.reader(keyOf(url)!, 0), undefined); // not watched: a live channel is never read
  inspector.watch(keyOf(url)!);
  assert.equal(inspector.tracks(url), null);
  for (const from of [0, Math.floor(data.length * 0.6)]) {
    const sink = inspector.reader(keyOf(url)!, from)!;
    for (let at = from; at < data.length; at += 65536) sink(data.slice(at, at + 65536));
  }
  const info = inspector.tracks(url)!;
  assert.equal(info.video, 'avc');
  assert.deepEqual(info.tracks.map(t => [t.kind, t.order, t.codec, t.text]), [['audio', 0, 'aac', false], ['audio', 1, 'eac3', false], ['subtitle', 0, 'srt', true], ['subtitle', 1, 'ass', true]]);
  const batch = inspector.cues(url, 5, 0);
  assert.deepEqual(batch.cues.map(c => c.text), ['Merhaba bir', 'Merhaba iki\nikinci satır', 'Merhaba üç']);
  assert.equal(batch.next, 3);
  assert.deepEqual(inspector.cues(url, 5, 3), { cues: [], next: 3 });
  // Without the converter the picture is not offered for conversion.
  const plain = new MediaInspector(() => false); plain.watch(keyOf(url)!); const s = plain.reader(keyOf(url)!, 0)!; s(data.slice(0, 200000));
  assert.equal(plain.tracks(url)!.video, undefined);
  inspector.clear();
  assert.equal(inspector.tracks(url), null);
});

test('medya geçidi: oynatıcıya giden baytlar izleyiciye de gider, oynatıcının aldığı dosya değişmez', async () => {
  const data = fs.readFileSync(mkv);
  const server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || ''), start = m ? Number(m[1]) : 0;
    res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': data.length - start, ...(m ? { 'Content-Range': `bytes ${start}-${data.length - 1}/${data.length}` } : {}) });
    res.end(data.subarray(start));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const inspector = new MediaInspector(() => true), gateway = new MediaGateway(inspector.reader);
    const local = gateway.add(`http://127.0.0.1:${(server.address() as AddressInfo).port}/movie/u/p/1.mkv`);
    inspector.watch(keyOf(local)!);
    const reply = await gateway.handle(new Request(local));
    assert.deepEqual(Buffer.from(await reply.arrayBuffer()), data);
    assert.equal(inspector.tracks(local)!.tracks.length, 4);
    assert.equal(inspector.cues(local, 4, 0).cues.length, 3);
    // A seek (a ranged request) is read from its own offset, and the same lines are not kept twice.
    const tail = await gateway.handle(new Request(local, { headers: { Range: `bytes=${Math.floor(data.length / 2)}-` } }));
    assert.equal((await tail.arrayBuffer()).byteLength, data.length - Math.floor(data.length / 2));
    assert.equal(inspector.cues(local, 4, 0).cues.length, 3);
  } finally { server.closeAllConnections(); server.close(); }
});

test('iz adları: dil, dosyadaki ad, çok kanal ve zorunlu; aynı adlar numaralanır', () => {
  const t = (language: string, name = '', extra: Partial<{ channels: number; forced: boolean; order: number }> = {}) => ({ language, name, channels: extra.channels, forced: !!extra.forced, order: extra.order || 0 });
  assert.deepEqual(mediaTrackNames([t('eng'), t('spa', 'Latin American'), t('fre', 'Canadian', { channels: 6 }), t('eng', 'SDH'), t('eng', 'English'), t('tur', 'Türkçe'), t('und', '', { order: 6 }), t('und', 'Commentary'), t('ger', 'Forced', { forced: true }), t('gre', '', { forced: true })]),
    ['İngilizce 1', 'İspanyolca · Latin American', 'Fransızca · Canadian · 5.1', 'İngilizce · SDH', 'İngilizce 2', 'Türkçe', 'Parça 7', 'Commentary', 'Almanca · Forced', 'Yunanca · zorunlu']);
  assert.deepEqual(mediaTrackNames([t('eng', '', { channels: 2 }), t('eng', '', { channels: 8 })]), ['İngilizce', 'İngilizce · 7.1']);
});

test('dublaj eşlemesi: Chromium’un listesindeki karşılığı, yoksa -1; başlangıç dublajı tercih veya varsayılan', () => {
  const natives = [{ id: '2', language: 'eng' }, { id: '4', language: 'por' }];
  assert.equal(nativeIndex({ id: 2, index: 1, language: 'eng' }, natives), 0);
  assert.equal(nativeIndex({ id: 3, index: 2, language: 'tur' }, natives), -1); // E-AC-3: Chromium does not list it
  assert.equal(nativeIndex({ id: 4, index: 3, language: 'pt' }, natives), 1);
  assert.equal(nativeIndex({ id: 2, index: 1, language: 'ger' }, natives), -1); // same number, other language: not the same track
  const audio = [{ language: 'eng', default: false, n: 1 }, { language: 'tur', default: true, n: 2 }, { language: 'fre', default: false, n: 3 }];
  assert.equal(startingTrack(audio, 'fr')?.n, 3);
  assert.equal(startingTrack(audio, 'fa')?.n, 2);
  assert.equal(startingTrack(audio, undefined)?.n, 2);
  assert.equal(startingTrack([{ language: 'eng', default: false, n: 1 }], undefined)?.n, 1);
});

test('dönüştürücü komutu: görüntü kopyalanır, ses AAC olur, ileri konumda dosyanın kendi zamanı korunur', () => {
  const start = remuxArgs('http://127.0.0.1:1/x', { remote: true, at: 0.4, audio: 1, codec: 'eac3', channels: 6, video: 'hevc' }).join(' ');
  assert.match(start, /-reconnect 1 .* -i http:\/\/127\.0\.0\.1:1\/x -map 0:V:0 -map 0:a:1 -c:v copy -tag:v hvc1 -c:a aac -ac 6 -b:a 384k -sn/);
  assert.doesNotMatch(start, /-ss|-copyts/);
  const later = remuxArgs('/tmp/film.mkv', { remote: false, at: 1234.5, audio: 0, codec: 'aac', video: 'avc' }).join(' ');
  assert.match(later, /^-hide_banner .* -ss 1234\.500 -copyts -i \/tmp\/film\.mkv .* -c:a copy .* -avoid_negative_ts disabled .* frag_keyframe\+empty_moov\+default_base_moof\+frag_discont .* pipe:1$/);
  assert.doesNotMatch(later, /reconnect|-tag:v/);
  assert.match(remuxArgs('x', { remote: false, at: 0, audio: 0, codec: 'truehd', channels: 8, video: 'avc' }).join(' '), /-c:a aac -ac 6 -b:a 384k/);
  assert.match(remuxArgs('x', { remote: false, at: 0, audio: 0, codec: 'dts', channels: 3, video: 'avc' }).join(' '), /-c:a aac -ac 2 -b:a 192k/);
  assert.match(remuxArgs('x', { remote: false, at: 0, audio: 0, codec: 'ac3', channels: 2, video: 'avc' }).join(' '), /-c:a aac -b:a 192k -sn/);
});
