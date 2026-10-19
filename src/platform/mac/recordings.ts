import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import type { IncomingMessage } from 'http';
import { collect, request } from '../../runtime/http';
import { AppError } from '../../core/errors';
import type { Recording, RecordingState } from '../../core/models';
import type { RecordingHost } from '../../runtime/session';
import { safeName, type DownloadManager } from './downloads';
// ---------------------------------------------------------------------------------------------
// Capturing a channel. The raw transport stream is what a provider sends for `.ts`, and what an HLS
// channel's segments are made of, so both end up as one growing `.ts` file.
// ---------------------------------------------------------------------------------------------
const SYNC = 0x47;
class Refused extends AppError { constructor(public status: number) { super('HTTP_STATUS', status === 403 || status === 429 ? 'Sunucu bağlantıyı reddetti. Hesabın eşzamanlı bağlantı sınırı dolu olabilir.' : `Sunucu yayını vermedi (${status}).`); } }
class Capture {
  stopped = false;
  bytes = 0;
  current?: IncomingMessage;
  private wake?: () => void;
  stop() { this.stopped = true; this.current?.destroy(); this.wake?.(); }
  sleep(ms: number) { return new Promise<void>(resolve => { const timer = setTimeout(done, ms); const self = this; function done() { clearTimeout(timer); self.wake = undefined; resolve(); } this.wake = done; }); }
}
export interface Media { variant?: string; segments: { seq: number; url: string }[]; target: number; ended: boolean; unsupported?: string }
// A master playlist names a media playlist per quality: the best one is taken. A media playlist lists
// numbered segments. Encrypted segments and fragmented MP4 are not something a plain copy can handle.
export function parsePlaylist(text: string, base: string): Media {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(line => line.trim());
  if (!lines[0]?.startsWith('#EXTM3U')) throw new AppError('FORMAT', 'Sunucu geçerli bir yayın listesi vermedi.');
  if (lines.some(line => line.startsWith('#EXT-X-STREAM-INF'))) {
    let best: { bandwidth: number; url: string } | undefined;
    lines.forEach((line, i) => {
      if (!line.startsWith('#EXT-X-STREAM-INF')) return;
      const uri = lines.slice(i + 1).find(next => next && !next.startsWith('#'));
      const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] || 0);
      if (uri && (!best || bandwidth > best.bandwidth)) best = { bandwidth, url: new URL(uri, base).href };
    });
    if (!best) throw new AppError('FORMAT', 'Yayın listesinde oynatılabilir bir kalite yok.');
    return { variant: best.url, segments: [], target: 6, ended: false };
  }
  let seq = 0, target = 6, ended = false, unsupported: string | undefined;
  const segments: Media['segments'] = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(line.slice(22)) || 0;
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) target = Number(line.slice(22)) || 6;
    else if (line.startsWith('#EXT-X-ENDLIST')) ended = true;
    else if (line.startsWith('#EXT-X-KEY:') && !/METHOD=NONE/.test(line)) unsupported = 'Şifreli yayınlar kaydedilemez.';
    else if (line.startsWith('#EXT-X-MAP')) unsupported = 'Bu yayın biçimi (fMP4) kaydedilemiyor.';
    else if (line && !line.startsWith('#')) segments.push({ seq: seq++, url: new URL(line, base).href });
  }
  return { segments, target, ended, unsupported };
}
async function fetchText(cap: Capture, url: string): Promise<string> {
  const response = await request(url, {}, { streaming: true });
  cap.current = response;
  if (response.statusCode !== 200) { response.resume(); throw new Refused(response.statusCode || 0); }
  return (await collect(response, 2 * 1024 * 1024)).toString('utf8');
}
// Plain transport stream: writes everything until the server closes or we stop. A server that answers
// with a playlist instead is an HLS channel, and its text is handed back.
async function captureTs(cap: Capture, url: string, write: (chunk: Buffer) => void): Promise<{ playlist?: string }> {
  const response = await request(url, {}, { streaming: true });
  cap.current = response;
  if (response.statusCode !== 200) { response.resume(); throw new Refused(response.statusCode || 0); }
  if (/^(text\/html|application\/json)/i.test(String(response.headers['content-type'] || ''))) { response.resume(); throw new AppError('FORMAT', 'Sunucu yayın yerine bir sayfa gönderdi.'); }
  let first = true, text: Buffer[] | undefined, size = 0;
  try {
    for await (const chunk of response as AsyncIterable<Buffer>) {
      if (first) {
        first = false;
        if (chunk[0] === 0x23) text = []; // '#': the server sent a playlist, not a stream
        else if (chunk[0] !== SYNC) throw new AppError('FORMAT', 'Sunucu tanınmayan bir yayın biçimi gönderdi.');
      }
      if (text) { size += chunk.length; if (size > 2 * 1024 * 1024) throw new AppError('FORMAT', 'Sunucu tanınmayan bir yayın biçimi gönderdi.'); text.push(chunk); continue; }
      write(chunk);
    }
  } catch (error) { if (!cap.stopped) throw error; }
  return text ? { playlist: Buffer.concat(text).toString('utf8') } : {};
}
async function captureHls(cap: Capture, progress: { last: number }, startUrl: string, firstText: string | undefined, write: (chunk: Buffer) => void): Promise<void> {
  let mediaUrl = startUrl, text = firstText;
  while (!cap.stopped) {
    const playlist = parsePlaylist(text ?? await fetchText(cap, mediaUrl), mediaUrl);
    text = undefined;
    if (playlist.variant) { mediaUrl = playlist.variant; continue; }
    if (playlist.unsupported) throw new AppError('FORMAT', playlist.unsupported);
    // A live list is joined near its end, not replayed from the start; a finished one is taken whole.
    let fresh = playlist.segments.filter(segment => segment.seq > progress.last);
    if (progress.last < 0 && !playlist.ended) fresh = fresh.slice(-2);
    for (const segment of fresh) {
      if (cap.stopped) return;
      let body: Buffer | undefined;
      for (let attempt = 0; attempt < 3 && !body && !cap.stopped; attempt++) {
        try {
          const response = await request(segment.url, {}, { streaming: true });
          cap.current = response;
          if (response.statusCode !== 200) { response.resume(); throw new Refused(response.statusCode || 0); }
          body = await collect(response, 128 * 1024 * 1024);
        } catch (error) { if (cap.stopped) return; if (attempt === 2) { body = undefined; break; } await cap.sleep(500 * (attempt + 1)); }
      }
      progress.last = segment.seq;
      if (!body) continue; // a segment that cannot be had leaves a gap rather than ending the recording
      if (cap.bytes === 0 && body[0] !== SYNC) throw new AppError('FORMAT', 'Bu yayın biçimi kaydedilemiyor.');
      write(body);
    }
    if (playlist.ended) return;
    await cap.sleep(Math.max(1000, playlist.target * 500));
  }
}
const FATAL_DISK = ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EDQUOT', 'EBADF'];
// Keeps a channel coming in until stopped. A dropped connection is picked up again at once (a live
// stream drops all the time) and what is written simply continues; only a channel that never
// delivers anything, or keeps failing for a long stretch, ends the recording.
export async function runCapture(cap: Capture, source: (hls: boolean) => string, write: (chunk: Buffer) => void, backoff = 1500): Promise<void> {
  let hls = false, playlist: string | undefined, quiet = 0, seen = cap.bytes;
  const progress = { last: -1 };
  while (!cap.stopped) {
    try {
      if (!hls) {
        const result = await captureTs(cap, source(false), write);
        if (result.playlist) { hls = true; playlist = result.playlist; continue; }
      } else {
        const text = playlist; playlist = undefined;
        await captureHls(cap, progress, source(true), text, write);
        if (!cap.stopped) return; // the playlist ended by itself
      }
      quiet = cap.bytes > seen ? 0 : quiet + 1;
    } catch (error) {
      if (cap.stopped) return;
      if (FATAL_DISK.includes((error as NodeJS.ErrnoException)?.code || '')) throw error;
      if (cap.bytes === 0 && !hls && ((error instanceof Refused && ![403, 408, 429, 500, 502, 503, 504].includes(error.status)) || (error instanceof AppError && error.code === 'FORMAT'))) { hls = true; playlist = undefined; continue; }
      if (error instanceof AppError && error.code === 'FORMAT') throw error;
      quiet = cap.bytes > seen ? 1 : quiet + 1;
      if (quiet > 10) { if (cap.bytes === 0) throw error; return; }
    }
    seen = cap.bytes;
    if (cap.stopped) return;
    await cap.sleep(Math.min(backoff * 7, backoff * Math.max(1, quiet)));
  }
}
// ---------------------------------------------------------------------------------------------
// The recordings themselves.
// ---------------------------------------------------------------------------------------------
interface Row { info: Recording; profile: string; file?: string; until?: number; cap?: Capture; fd?: number; child?: ChildProcess; detached?: boolean; note?: string }
interface Entry { id: string; profile: string; streamId: string; channel: string; name: string; state: RecordingState; start?: number; end?: number; file?: string; error?: string }
const MAX_AT_ONCE = 3, MAX_HOURS = 12, MAX_AHEAD_DAYS = 14, MAX_SCHEDULED = 50, LOW_SPACE = 300 * 1024 * 1024, START_SPACE = 1024 * 1024 * 1024;
const stamp = (ms: number) => { const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`; };
export interface RecordingOptions { folder: () => string; index?: string; downloads: DownloadManager; ffmpeg?: string; show?: (file: string) => void; keepAwake?: (on: boolean) => void; tickMs?: number; backoffMs?: number }
export class RecordingManager implements RecordingHost {
  private rows = new Map<string, Row>();
  private others: Entry[] = [];
  private profile = '';
  private source?: (streamId: string, hls: boolean) => string;
  private queue: Promise<unknown> = Promise.resolve();
  private writing: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ticks = 0;
  constructor(private options: RecordingOptions) {
    this.timer = setInterval(() => this.tick(), options.tickMs ?? 5000);
    this.timer.unref?.();
  }
  private get folder() { return this.options.folder(); }
  list = (): Recording[] => {
    const finished: Recording[] = this.options.downloads.list().filter(d => d.source?.startsWith('rec:')).map(d => ({ id: d.source!.slice(4), streamId: '', channel: '', name: d.name, state: 'done' as const, bytes: d.total, fileId: d.id }));
    return [...[...this.rows.values()].map(row => ({ ...row.info, hasFile: !!row.file, error: row.info.error ?? row.note })), ...finished];
  };
  start = (streamId: string, channel: string, minutes?: number): Recording => {
    if (!this.source) throw new AppError('LOCKED', 'Oturum kilitlendi. Lütfen tekrar giriş yapın.');
    const now = Date.now(), until = minutes ? now + minutes * 60000 : undefined;
    const same = [...this.rows.values()].find(row => row.info.state === 'recording' && row.info.streamId === streamId);
    if (same) { if (until !== undefined || !minutes) { same.until = until; same.info.end = until; } return { ...same.info }; }
    const row = this.row(streamId, channel, 'recording');
    row.until = until; row.info.end = until;
    try { this.begin(row); } catch (error) { this.rows.delete(row.info.id); throw error; }
    return { ...row.info };
  };
  schedule = (streamId: string, channel: string, start: number, end: number): Recording => {
    const now = Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now) throw new AppError('INVALID', 'Bitiş zamanı başlangıçtan sonra ve gelecekte olmalı.');
    if (end - start > MAX_HOURS * 3600000) throw new AppError('INVALID', `Bir kayıt en fazla ${MAX_HOURS} saat olabilir.`);
    if (start > now + MAX_AHEAD_DAYS * 86400000) throw new AppError('INVALID', `En fazla ${MAX_AHEAD_DAYS} gün sonrası planlanabilir.`);
    if ([...this.rows.values()].filter(row => row.info.state === 'scheduled').length >= MAX_SCHEDULED) throw new AppError('LIMIT', 'Çok fazla planlı kayıt var.');
    const row = this.row(streamId, channel, 'scheduled', Math.max(start, now), end);
    row.info.name = `${safeName(channel)} ${stamp(Math.max(start, now))}`;
    this.persist(); this.awake();
    // Already under way: no need to wait for the next beat.
    if (start <= now) this.tick();
    return { ...row.info };
  };
  stop = (id: string) => {
    const row = this.rows.get(id);
    if (row?.info.state === 'recording') row.cap?.stop();
  };
  remove = (id: string) => {
    const row = this.rows.get(id);
    if (!row) return;
    if (row.info.state === 'recording') { row.cap?.stop(); return; }
    if (row.info.state === 'converting') return;
    this.rows.delete(id); this.persist(); this.awake();
  };
  retry = (id: string) => {
    const row = this.rows.get(id);
    if (!row || row.info.state !== 'failed' || !row.file) return;
    row.info.state = 'converting'; row.info.error = undefined; row.note = undefined;
    this.persist(); this.convert(row);
  };
  reveal = (id: string) => {
    const row = this.rows.get(id);
    if (row?.file) this.options.show?.(path.join(this.folder, row.file));
  };
  // Called with an account when it signs in, and with none when it signs out. Signing out ends what is
  // running (the raw file is kept and turned into an MP4 at the next sign-in); the plan stays with its account.
  bind = (profile: string, source?: (streamId: string, hls: boolean) => string) => {
    this.release();
    this.profile = profile; this.source = source;
    if (!source || !profile) return;
    this.load();
    this.awake();
  };
  shutdown = () => { this.release(); if (this.timer) clearInterval(this.timer); };
  // --- internals -------------------------------------------------------------------------------
  private row(streamId: string, channel: string, state: RecordingState, start?: number, end?: number): Row {
    const id = randomBytes(8).toString('hex'), now = Date.now();
    const row: Row = { profile: this.profile, info: { id, streamId, channel, name: `${safeName(channel)} ${stamp(now)}`, state, start, end, bytes: 0 } };
    this.rows.set(id, row);
    return row;
  }
  private unique(base: string, ext: string) {
    let target = path.join(this.folder, `${base}.${ext}`);
    for (let n = 2; this.options.downloads.isTaken(target) || fs.existsSync(target) || [...this.rows.values()].some(row => row.file && path.join(this.folder, row.file) === target); n++) target = path.join(this.folder, `${base} (${n}).${ext}`);
    return target;
  }
  private awake() { this.options.keepAwake?.([...this.rows.values()].some(row => row.info.state === 'recording' || row.info.state === 'scheduled' || row.info.state === 'converting')); }
  // Begins writing. Throws (before anything is left behind) when there is no room or no way to write.
  private begin(row: Row) {
    if ([...this.rows.values()].filter(r => r !== row && r.info.state === 'recording').length >= MAX_AT_ONCE) throw new AppError('LIMIT', `En fazla ${MAX_AT_ONCE} kanal aynı anda kaydedilebilir.`);
    fs.mkdirSync(this.folder, { recursive: true, mode: 0o755 });
    try { const space = fs.statfsSync(this.folder); if (space.bavail * space.bsize < START_SPACE) throw new AppError('DISK', 'Diskte yeterli boş alan yok.'); } catch (error) { if (error instanceof AppError) throw error; }
    const target = this.unique(row.info.name, 'ts');
    row.file = path.basename(target);
    row.info.name = path.basename(target, '.ts');
    row.fd = fs.openSync(target, 'a');
    row.info.state = 'recording'; row.info.startedAt = Date.now(); row.info.bytes = 0;
    const cap = row.cap = new Capture(), source = this.source!;
    // Synchronous writes: each chunk is on disk before the next is read, so stopping or quitting never
    // leaves a buffer behind, and a full disk surfaces at once.
    const write = (chunk: Buffer) => { if (row.fd === undefined) throw Object.assign(new Error('closed'), { code: 'EBADF' }); fs.writeSync(row.fd, chunk); cap.bytes += chunk.length; row.info.bytes = cap.bytes; };
    this.awake();
    runCapture(cap, hls => source(row.info.streamId, hls), write, this.options.backoffMs).then(() => this.finish(row), error => this.finish(row, error));
  }
  private finish(row: Row, error?: unknown) {
    if (row.detached) return;
    if (row.fd !== undefined) { try { fs.closeSync(row.fd); } catch { /* already closed */ } row.fd = undefined; }
    row.cap = undefined; row.until = undefined;
    const message = error instanceof AppError ? error.message : error ? (FATAL_DISK.includes((error as NodeJS.ErrnoException).code || '') ? 'Diske yazılamadı; disk dolmuş olabilir.' : 'Yayın alınamadı.') : undefined;
    if (row.info.bytes === 0) {
      if (row.file) fs.rmSync(path.join(this.folder, row.file), { force: true });
      row.file = undefined; row.info.state = 'failed'; row.info.error = message || 'Kanaldan hiç veri alınamadı.';
      this.persist(); this.awake(); return;
    }
    row.note = message; row.info.state = 'converting';
    this.persist(); this.awake();
    this.convert(row);
  }
  private convert(row: Row) {
    this.queue = this.queue.then(() => this.run(row)).catch(() => {});
  }
  private async run(row: Row) {
    if (row.detached || row.info.state !== 'converting' || !row.file) return;
    const input = path.join(this.folder, row.file);
    if (!fs.existsSync(input)) { row.info.state = 'failed'; row.info.error = 'Ham kayıt dosyası bulunamadı.'; row.file = undefined; this.persist(); this.awake(); return; }
    const target = this.unique(row.info.name, 'mp4'), part = `${target}.part`;
    const attempt = (audio: string[]) => new Promise<void>((resolve, reject) => {
      if (!this.options.ffmpeg || !fs.existsSync(this.options.ffmpeg)) { reject(new AppError('FFMPEG', 'MP4 dönüştürücü bulunamadı. Ham kayıt (.ts) Finder’da duruyor.')); return; }
      // Only the picture and sound are carried over; teletext and data streams would stop an MP4 being written.
      const child = spawn(this.options.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-fflags', '+genpts', '-i', input, '-map', '0:v:0?', '-map', '0:a?', '-sn', '-dn', '-c:v', 'copy', ...audio, '-movflags', '+faststart', '-f', 'mp4', part], { stdio: ['ignore', 'ignore', 'ignore'] });
      row.child = child;
      child.on('error', () => reject(new AppError('FFMPEG', 'MP4 dönüştürücü çalıştırılamadı.')));
      child.on('close', code => { row.child = undefined; code === 0 ? resolve() : reject(new AppError('FFMPEG', 'MP4’e dönüştürülemedi. Ham kayıt (.ts) Finder’da duruyor.')); });
    });
    try {
      // Sound that MP4 cannot hold as it is (MP2, say) is re-encoded as AAC; the picture never is.
      try { await attempt(['-c:a', 'copy']); } catch (error) { if (row.detached) return; if (error instanceof AppError && !/dönüştürülemedi/.test(error.message)) throw error; await attempt(['-c:a', 'aac', '-b:a', '192k']); }
      if (row.detached) { fs.rm(part, { force: true }, () => {}); return; }
      if (!fs.existsSync(part) || fs.statSync(part).size === 0) throw new AppError('FFMPEG', 'MP4 dosyası boş çıktı. Ham kayıt (.ts) Finder’da duruyor.');
      fs.renameSync(part, target);
      this.options.downloads.adopt(target, `rec:${row.info.id}`);
      fs.rm(input, { force: true }, () => {});
      this.rows.delete(row.info.id);
    } catch (error) {
      fs.rm(part, { force: true }, () => {});
      if (row.detached) return;
      row.info.state = 'failed'; row.info.error = error instanceof AppError ? error.message : 'MP4’e dönüştürülemedi.';
    }
    this.persist(); this.awake();
  }
  // Once every few seconds: plans start and end on time, and a recording is stopped when its time
  // is up or the disk is nearly full. A timer beat (rather than one timeout per plan) also copes
  // with the Mac having slept through a start.
  private tick() {
    const now = Date.now(); this.ticks++;
    for (const row of [...this.rows.values()]) {
      const { info } = row;
      if (info.state === 'scheduled' && info.start !== undefined && info.end !== undefined && now >= info.start) {
        if (now >= info.end) { info.state = 'missed'; info.error = 'Kayıt zamanı geçti; uygulama o sırada açık değildi.'; this.persist(); this.awake(); continue; }
        if (!this.source) continue;
        const same = [...this.rows.values()].find(r => r.info.state === 'recording' && r.info.streamId === info.streamId);
        if (same) { same.until = same.until === undefined ? undefined : Math.max(same.until, info.end); same.info.end = same.until; this.rows.delete(info.id); this.persist(); continue; }
        row.until = info.end;
        try { this.begin(row); } catch (error) { info.state = 'failed'; info.error = error instanceof AppError ? error.message : 'Kayıt başlatılamadı.'; }
        this.persist();
      } else if (info.state === 'recording') {
        if (row.until !== undefined && now >= row.until) row.cap?.stop();
        else if (this.ticks % 6 === 0) {
          try { const space = fs.statfsSync(this.folder); if (space.bavail * space.bsize < LOW_SPACE) { row.note = 'Disk dolmak üzere olduğu için kayıt durduruldu.'; row.cap?.stop(); } } catch { /* cannot tell: keep going */ }
        }
      }
    }
  }
  private load() {
    this.others = [];
    if (!this.options.index) return;
    let items: unknown[] = [];
    try { const saved = JSON.parse(fs.readFileSync(this.options.index, 'utf8')); if (Array.isArray(saved?.items)) items = saved.items; } catch { /* nothing saved yet */ }
    const now = Date.now();
    for (const raw of items) {
      const e = raw as Partial<Entry>;
      if (typeof e?.id !== 'string' || !/^[a-f0-9]{16}$/.test(e.id) || typeof e.profile !== 'string' || typeof e.streamId !== 'string' || !/^\d{1,20}$/.test(e.streamId) || typeof e.channel !== 'string' || typeof e.name !== 'string') continue;
      if (e.profile !== this.profile) { this.others.push(e as Entry); continue; }
      if (!['scheduled', 'converting', 'failed', 'missed'].includes(String(e.state))) continue;
      if (e.file !== undefined && (typeof e.file !== 'string' || e.file !== path.basename(e.file))) continue;
      const row: Row = { profile: e.profile, file: e.file, info: { id: e.id, streamId: e.streamId, channel: e.channel.slice(0, 120), name: e.name.slice(0, 200), state: e.state as RecordingState, start: Number.isFinite(e.start) ? e.start : undefined, end: Number.isFinite(e.end) ? e.end : undefined, bytes: 0, error: typeof e.error === 'string' ? e.error.slice(0, 300) : undefined } };
      if (row.info.state === 'scheduled' && (row.info.end === undefined || row.info.start === undefined)) continue;
      if (row.info.state === 'scheduled' && row.info.end! <= now) { row.info.state = 'missed'; row.info.error = 'Kayıt zamanı geçti; uygulama o sırada açık değildi.'; }
      this.rows.set(e.id, row);
    }
    for (const row of this.rows.values()) if (row.info.state === 'converting') this.convert(row);
    this.persist(); this.tick();
  }
  private entries(): Entry[] {
    return [...this.rows.values()].filter(row => row.profile === this.profile).map(row => {
      const { info } = row, state = info.state === 'recording' ? 'converting' : info.state;
      return { id: info.id, profile: row.profile, streamId: info.streamId, channel: info.channel, name: info.name, state, start: info.start, end: info.end, file: row.file, error: info.error };
    }).filter(e => e.state !== 'done' && (e.state !== 'converting' || e.file));
  }
  private persist(sync = false) {
    if (!this.options.index || !this.profile) return;
    const contents = JSON.stringify({ v: 1, items: [...this.others, ...this.entries()] });
    const file = this.options.index;
    const write = () => { const tmp = `${file}.${process.pid}.tmp`; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, contents, { mode: 0o600 }); fs.renameSync(tmp, file); };
    if (sync) { try { write(); } catch { /* best effort at exit */ } } else this.writing = this.writing.then(write).catch(() => {});
  }
  // Ends everything that is running, keeps what was captured for the next sign-in, and forgets the rows.
  private release() {
    if (this.rows.size === 0) return;
    for (const row of this.rows.values()) {
      if (row.cap) { row.cap.stop(); row.cap = undefined; }
      if (row.fd !== undefined) { try { fs.closeSync(row.fd); } catch { /* already closed */ } row.fd = undefined; }
      row.child?.kill('SIGKILL');
      row.detached = true;
      if (row.info.state === 'recording' && row.info.bytes === 0 && row.file) { fs.rmSync(path.join(this.folder, row.file), { force: true }); row.file = undefined; }
    }
    this.persist(true);
    this.rows.clear();
    this.awake();
  }
}
