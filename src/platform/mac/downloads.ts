import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { IncomingMessage } from 'http';
import { request } from '../../runtime/http';
import { atomicWrite } from '../../runtime/storage';
import { AppError } from '../../core/errors';
import type { Download, DownloadState } from '../../core/models';
import type { DownloadHost } from '../../runtime/session';
interface Job { info: Download; url: string; extension: string; part: string; target: string; response?: IncomingMessage; sampleAt: number; sampleBytes: number; timer?: ReturnType<typeof setTimeout>; tries: number; startedWith: number }
const LIVE: DownloadState[] = ['queued', 'active', 'waiting'];
// When the viewer asks for it, an interrupted transfer starts again on its own: soon at first (most
// drops are a blip), then less and less often so a provider that is really down is not hammered,
// and for good after RETRY_MAX tries. A try that got a megabyte or more before dropping again
// proves the line works, so it earns a fresh count.
export const RETRY_DELAYS = [5000, 20000, 60000, 180000, 300000];
export const RETRY_MAX = 8;
const PROGRESS = 1024 * 1024;
// A refusal from the server, kept with its status so only the passing kinds are tried again.
class Refused extends AppError { constructor(public status: number, message: string) { super('HTTP_STATUS', message); } }
// Worth another go: the connection dropped, or the provider is busy or briefly unwell. Not worth
// it: a missing file, a login that no longer works, a full disk, an error page, a bad certificate.
function retryable(error: unknown): boolean {
  if (error instanceof Refused) return [403, 408, 429, 500, 502, 503, 504].includes(error.status);
  if (error instanceof AppError) return error.code === 'NETWORK';
  return !['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'ENOENT', 'EDQUOT'].includes((error as NodeJS.ErrnoException)?.code || '');
}
// Free space kept back after a film lands, so a download never fills the disk to the last byte.
const MARGIN = 256 * 1024 * 1024;
// A file name the Finder will accept and that cannot climb out of the folder.
export const safeName = (value: string) => (value.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').slice(0, 120).trim()) || 'indirme';
const TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', ts: 'video/mp2t' };
// What survives a restart: finished files only, as a bare file name inside the downloads folder.
// An unfinished transfer cannot continue without the account's address, which is never written down.
interface Entry { id: string; profile: string; file: string; source?: string }
const SOURCE = /^(?:(?:vod|series):\d{1,20}|rec:[a-f0-9]{16})$/;
// Transfers run one at a time: an account usually allows only a few connections, and a second
// transfer would take the slot the player needs.
export class DownloadManager implements DownloadHost {
  private jobs = new Map<string, Job>();
  private running = false;
  private profile = '';
  private others: Entry[] = [];
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private folder: () => string, private show: (file: string) => void = () => {}, private trashFile: (file: string) => Promise<void> = async () => {}, private index?: string, private delays: number[] = RETRY_DELAYS) {}
  private autoRetry = false;
  configure = (options: { autoRetry: boolean }) => {
    this.autoRetry = options.autoRetry;
    // Switching it off also ends any wait that is counting down.
    if (!this.autoRetry) for (const job of this.jobs.values()) if (job.info.state === 'waiting') { this.stopWaiting(job); job.info.state = 'failed'; }
  };
  // Called once an account is signed in: its earlier downloads come back, minus any file the
  // viewer has since moved or deleted in the Finder.
  use = (profile: string) => {
    this.profile = profile; this.others = [];
    if (!this.index) return;
    let entries: unknown[] = [];
    try { const saved = JSON.parse(fs.readFileSync(this.index, 'utf8')); if (Array.isArray(saved?.items)) entries = saved.items; } catch { /* no index yet, or unreadable: start empty */ }
    for (const raw of entries) {
      const e = raw as Partial<Entry>;
      if (typeof e?.id !== 'string' || typeof e.profile !== 'string' || typeof e.file !== 'string' || !/^[a-f0-9]{16}$/.test(e.id) || e.file !== path.basename(e.file)) continue;
      if (e.profile !== profile) { this.others.push(e as Entry); continue; }
      const target = path.join(this.folder(), e.file);
      let size = 0;
      try { const stat = fs.statSync(target); if (!stat.isFile()) continue; size = stat.size; } catch { continue; }
      this.jobs.set(e.id, { info: { id: e.id, source: typeof e.source === 'string' && SOURCE.test(e.source) ? e.source : undefined, name: e.file, state: 'done', received: size, total: size, speed: 0 }, url: '', extension: path.extname(e.file).slice(1), part: `${target}.part`, target, sampleAt: 0, sampleBytes: 0, tries: 0, startedWith: 0 });
    }
  };
  private save() {
    if (!this.index || !this.profile) return;
    const mine = [...this.jobs.values()].filter(job => job.info.state === 'done').map(job => ({ id: job.info.id, profile: this.profile, file: path.basename(job.target), source: job.info.source }));
    const contents = JSON.stringify({ v: 1, items: [...this.others, ...mine] });
    this.writing = this.writing.then(() => atomicWrite(this.index!, contents)).catch(() => { /* the list is a convenience; the files are already safe */ });
  }
  // Asks for the first byte only, which is enough for the server to state the whole size, and
  // drops the connection at once. A server that sends a page instead, or nothing, gives 0.
  size = async (url: string): Promise<number> => {
    try {
      const response = await request(url, { Range: 'bytes=0-0' }, { streaming: true });
      try {
        if (/^(text\/|application\/json)/i.test(String(response.headers['content-type'] || ''))) return 0;
        if (response.statusCode === 206) { const m = /^bytes \d+-\d+\/(\d+)$/.exec(String(response.headers['content-range'] || '')); return m ? Number(m[1]) : 0; }
        if (response.statusCode === 200) { const n = Number(response.headers['content-length']); return Number.isFinite(n) && n > 0 ? n : 0; }
        return 0;
      } finally { response.destroy(); }
    } catch { return 0; }
  };
  // A file made elsewhere in the app (a finished recording) joins the list as a finished download,
  // so playing, showing in the Finder and moving to the Trash work the same for it.
  adopt = (target: string, source: string): Download => {
    if (path.dirname(target) !== this.folder() || !SOURCE.test(source)) throw new AppError('INVALID', 'Dosya indirilenler klasöründe değil.');
    const size = fs.statSync(target).size, id = randomBytes(8).toString('hex');
    const info: Download = { id, source, name: path.basename(target), state: 'done', received: size, total: size, speed: 0 };
    this.jobs.set(id, { info, url: '', extension: path.extname(target).slice(1), part: `${target}.part`, target, sampleAt: 0, sampleBytes: 0, tries: 0, startedWith: 0 });
    this.save();
    return { ...info };
  };
  // Whether this folder-relative name is already taken by a download or a file on disk.
  isTaken = (target: string) => fs.existsSync(target) || fs.existsSync(`${target}.part`) || [...this.jobs.values()].some(job => job.target === target);
  open = (id: string): string => {
    if (this.jobs.get(id)?.info.state !== 'done') throw new AppError('NOT_FOUND', 'Dosya bulunamadı. Taşınmış veya silinmiş olabilir.');
    return `kiyi://local/${id}`;
  };
  trash = async (id: string) => {
    const job = this.jobs.get(id);
    if (!job || job.info.state !== 'done') return;
    await this.trashFile(job.target);
    this.jobs.delete(id); this.save();
  };
  // Serves a finished file to the player with byte ranges, so it can seek. Only a finished
  // download of this session is reachable, by its id, never by a path.
  serve = async (incoming: Request): Promise<Response> => {
    const job = this.jobs.get(new URL(incoming.url).pathname.slice(1));
    if (!job || job.info.state !== 'done' || !['GET', 'HEAD'].includes(incoming.method)) return new Response(null, { status: 404 });
    let size: number;
    try { size = (await fs.promises.stat(job.target)).size; } catch { return new Response(null, { status: 404 }); }
    const headers = new Headers({ 'Content-Type': TYPES[job.extension] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'kiyi://app' });
    if (size === 0) { headers.set('Content-Length', '0'); return new Response(null, { status: 200, headers }); }
    let start = 0, end = size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(incoming.headers.get('range') || '');
    if (range && (range[1] || range[2])) {
      if (!range[1]) start = Math.max(0, size - Number(range[2]));
      else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      status = 206; headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    if (incoming.method === 'HEAD') return new Response(null, { status, headers });
    const stream = fs.createReadStream(job.target, { start, end });
    incoming.signal.addEventListener('abort', () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
  };
  list = (): Download[] => {
    const now = Date.now();
    return [...this.jobs.values()].map(job => {
      const { info } = job;
      if (info.state !== 'active') info.speed = 0;
      else if (now - job.sampleAt >= 1000) { info.speed = Math.max(0, (info.received - job.sampleBytes) / ((now - job.sampleAt) / 1000)); job.sampleAt = now; job.sampleBytes = info.received; }
      return { ...info };
    });
  };
  start = (url: string, name: string, extension: string, source?: string): Download => {
    // The same film or episode is never saved twice: asking again returns what is already there
    // (and picks a failed or cancelled one back up).
    const known = source && SOURCE.test(source) ? [...this.jobs.values()].find(job => job.info.source === source) : undefined;
    if (known) { if (known.info.state === 'failed' || known.info.state === 'canceled') this.retry(known.info.id); return { ...known.info }; }
    const base = safeName(name), ext = /^[a-z0-9]{1,6}$/.test(extension) ? extension : 'mp4';
    const dir = this.folder();
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    // Two queued items can share a title, so a name is also taken by any other job's file.
    const taken = new Set([...this.jobs.values()].map(job => job.target));
    let target = path.join(dir, `${base}.${ext}`);
    for (let n = 2; fs.existsSync(target) || fs.existsSync(`${target}.part`) || taken.has(target); n++) target = path.join(dir, `${base} (${n}).${ext}`);
    const id = randomBytes(8).toString('hex');
    const info: Download = { id, source: source && SOURCE.test(source) ? source : undefined, name: path.basename(target), state: 'queued', received: 0, total: 0, speed: 0 };
    this.jobs.set(id, { info, url, extension: ext, part: `${target}.part`, target, sampleAt: Date.now(), sampleBytes: 0, tries: 0, startedWith: 0 });
    void this.pump();
    return { ...info };
  };
  cancel = (id: string) => {
    const job = this.jobs.get(id);
    if (!job || !LIVE.includes(job.info.state)) return;
    this.stopWaiting(job);
    job.info.state = 'canceled'; job.info.speed = 0;
    job.response?.destroy();
    if (!job.response) this.discard(job);
  };
  retry = (id: string) => {
    const job = this.jobs.get(id);
    if (!job || !['failed', 'canceled', 'waiting'].includes(job.info.state)) return;
    // Pressed by hand, so it starts now and the automatic count starts over.
    this.stopWaiting(job); job.tries = 0;
    job.info.state = 'queued'; job.info.error = undefined; job.info.speed = 0;
    void this.pump();
  };
  remove = (id: string) => {
    const job = this.jobs.get(id);
    if (!job) return;
    if (LIVE.includes(job.info.state)) this.cancel(id);
    this.jobs.delete(id);
    // A finished file is the viewer's; only an unfinished one is cleaned up.
    if (job.info.state !== 'done') this.discard(job); else this.save();
  };
  reveal = (id: string) => {
    const job = this.jobs.get(id);
    if (job?.info.state === 'done') this.show(job.target);
  };
  // Logging out ends the account the addresses belong to, so nothing may keep running with it.
  clear = () => {
    for (const job of this.jobs.values()) {
      this.stopWaiting(job);
      if (LIVE.includes(job.info.state)) { job.info.state = 'canceled'; job.response?.destroy(); if (!job.response) this.discard(job); }
      else if (job.info.state !== 'done') this.discard(job);
    }
    this.jobs.clear();
  };
  private stopWaiting(job: Job) { clearTimeout(job.timer); job.timer = undefined; job.info.retry = undefined; }
  private wait(job: Job) {
    const delay = this.delays[Math.min(job.tries, this.delays.length - 1)];
    job.tries++;
    job.info.state = 'waiting'; job.info.retry = { at: Date.now() + delay, n: job.tries, max: RETRY_MAX };
    job.timer = setTimeout(() => {
      job.timer = undefined;
      if (job.info.state !== 'waiting') return;
      job.info.retry = undefined; job.info.error = undefined; job.info.state = 'queued';
      void this.pump();
    }, delay);
  }
  private discard(job: Job) { fs.rm(job.part, { force: true }, () => {}); }
  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.next(); job; job = this.next()) await this.run(job);
    } finally { this.running = false; }
  }
  private next() { return [...this.jobs.values()].find(job => job.info.state === 'queued'); }
  private async run(job: Job) {
    const { info } = job;
    info.state = 'active'; info.speed = 0; job.sampleAt = Date.now(); job.startedWith = info.received;
    try {
      // A retry carries on from what is already on disk when the server honours ranges.
      let have = 0;
      try { have = (await fs.promises.stat(job.part)).size; } catch { /* nothing yet */ }
      const response = await request(job.url, have > 0 ? { Range: `bytes=${have}-` } : {}, { streaming: true });
      job.response = response;
      // The user may have pressed cancel while the request was still being made.
      if (info.state !== 'active') { response.destroy(); return; }
      const status = response.statusCode || 0;
      if (status !== 200 && status !== 206) {
        response.resume();
        throw new Refused(status, status === 403 || status === 429 ? 'Sunucu bağlantıyı reddetti. Hesabın eşzamanlı bağlantı sınırı dolu olabilir; izlemeyi kapatıp tekrar deneyin.' : `Sunucu dosyayı vermedi (${status}).`);
      }
      const type = String(response.headers['content-type'] || '');
      if (/^(text\/|application\/json)/i.test(type)) { response.resume(); throw new AppError('RESPONSE', 'Sunucu video yerine bir hata sayfası gönderdi.'); }
      // 200 means the server ignored the range and is sending the whole file again.
      const append = status === 206 && have > 0;
      if (!append) have = 0;
      const range = /^bytes (\d+)-\d+\/(\d+)$/.exec(String(response.headers['content-range'] || ''));
      const length = Number(response.headers['content-length']);
      info.total = status === 206 ? (range ? Number(range[2]) : 0) : Number.isFinite(length) ? length : 0;
      info.received = have;
      if (info.total > 0) {
        const space = await fs.promises.statfs(path.dirname(job.part));
        if (space.bavail * space.bsize < info.total - have + MARGIN) { response.destroy(); throw new AppError('DISK', 'Diskte yeterli boş alan yok.'); }
      }
      const count = new Transform({ transform(chunk: Buffer, _encoding, done) { info.received += chunk.length; done(null, chunk); } });
      await pipeline(response, count, fs.createWriteStream(job.part, { flags: append ? 'a' : 'w' }));
      if (info.total > 0 && info.received < info.total) throw new AppError('NETWORK', 'Aktarım yarıda kesildi. Tekrar deneyerek kaldığı yerden sürdürebilirsiniz.');
      await fs.promises.rename(job.part, job.target);
      info.total = info.received; info.state = 'done'; this.save();
    } catch (error) {
      // pipeline rejects when cancel destroys the response; that is not a failure to report.
      if ((info.state as DownloadState) === 'canceled') { this.discard(job); return; }
      info.error = error instanceof AppError ? error.message : info.received > 0 ? 'Aktarım yarıda kesildi. Tekrar deneyerek kaldığı yerden sürdürebilirsiniz.' : 'Dosya indirilemedi. Bağlantıyı ve disk alanını kontrol edip tekrar deneyin.';
      if (info.received - job.startedWith >= PROGRESS) job.tries = 0;
      if (this.autoRetry && retryable(error) && job.tries < RETRY_MAX) this.wait(job); else info.state = 'failed';
    } finally { job.response = undefined; info.speed = 0; }
  }
}
