// Subtitles from the internet, asked for only when the viewer presses the button. Two services are searched
// side by side (OpenSubtitles and SubDL) for English, Persian and Turkish, and the finds are ranked together
// (core/subtitles.ts). The keys, the services' addresses and the temporary download links all stay in this
// process: the page gets a list of finds with opaque ids and, for the one it picks, the file.
//
// What is sent out: the film's title, year and film-database numbers, and a fingerprint of the file (a number
// worked out from its size and its first and last 64 KB, which is how OpenSubtitles recognises the exact file).
// Never the IPTV address, the account or anything else of the viewer's.
import fs from 'fs';
import { AppError } from '../../core/errors';
import type { SubtitleFile, SubtitleHit, SubtitleKeys, SubtitleKeyValues, SubtitleLanguage, SubtitleQuery, SubtitleSearchResult } from '../../core/models';
import { SUBTITLE_LANGUAGES, rankHits } from '../../core/subtitles';
import { MAX_SUBTITLE_BYTES } from '../../core/tracks';
import { keyOf } from './inspector';
import { isRar, isZip, subtitleFromZip } from './zip';

// The services ask every client to name itself. A generic name on purpose: nothing about the viewer or this
// project is sent. (OpenSubtitles ties a key to the name it was made for but only checks that the header is there.)
const AGENT = 'SubtitleClient v1';
const TIMEOUT = 20000, LIMIT = 4 * 1024 * 1024;

export interface StoredKeys { opensubtitles?: { key: string; user?: string; password?: string }; subdl?: { key: string } }
export interface SubtitleKeyStore { load(): Promise<StoredKeys>; save(keys: StoredKeys): Promise<void> }
// A file to fingerprint: its size, and any stretch of it.
export interface Source { size: number; read(offset: number, length: number): Promise<Buffer>; close?(): void }
export type Opener = (source: string) => Promise<Source | undefined>;
export interface Endpoints { openSubtitles: string; subdl: string; subdlFiles: string }
const DEFAULT_ENDPOINTS: Endpoints = { openSubtitles: 'https://api.opensubtitles.com/api/v1', subdl: 'https://api.subdl.com/api/v1', subdlFiles: 'https://dl.subdl.com' };

// OpenSubtitles' "moviehash": the file's size plus every 64-bit little-endian word of its first and last 64 KB,
// modulo 2^64, as 16 hex digits. A file too small to have two such blocks has none.
export function movieHash(size: number, head: Uint8Array, tail: Uint8Array): string | undefined {
  const BLOCK = 65536;
  if (size < BLOCK * 2 || head.length < BLOCK || tail.length < BLOCK) return undefined;
  let sum = BigInt(size);
  for (const block of [head, tail]) { const view = new DataView(block.buffer, block.byteOffset, BLOCK); for (let i = 0; i < BLOCK; i += 8) sum += view.getBigUint64(i, true); }
  return (sum & 0xffffffffffffffffn).toString(16).padStart(16, '0');
}

// Opens what the player plays: a provider's film through the media gateway (a byte range at a time, never the
// whole file) or a finished download straight from disk.
export function sourceOpener(deps: { serve(token: string, range: string, signal: AbortSignal): Promise<Response>; localFile(id: string): string | undefined }): Opener {
  return async source => {
    const key = keyOf(source); if (!key) return undefined;
    const [host, name] = key.split('/');
    if (host === 'local') {
      const file = deps.localFile(name); if (!file) return undefined;
      const handle = await fs.promises.open(file, 'r'), size = (await handle.stat()).size;
      return { size, close: () => { void handle.close(); }, read: async (offset, length) => { const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, offset); return buffer.subarray(0, bytesRead); } };
    }
    const range = async (from: number, to: number) => {
      const control = new AbortController(), timer = setTimeout(() => control.abort(), 12000);
      try {
        const response = await deps.serve(name, `bytes=${from}-${to}`, control.signal);
        // 200 means the server ignored the range and is sending the whole film: never read that.
        if (response.status !== 206) { void response.body?.cancel().catch(() => {}); return undefined; }
        const total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') || '')?.[1] || 0);
        return { total, bytes: Buffer.from(await response.arrayBuffer()) };
      } finally { clearTimeout(timer); }
    };
    const first = await range(0, 65535); if (!first || !first.total) return undefined;
    return { size: first.total, read: async (offset, length) => offset === 0 && length <= first.bytes.length ? first.bytes.subarray(0, length) : (await range(offset, offset + length - 1))?.bytes ?? Buffer.alloc(0) };
  };
}

interface Known { provider: SubtitleHit['provider']; fileId?: number; path?: string; name: string; episode?: number }
const printable = /^[^\u0000-\u001f\u007f]{1,200}$/;

export class SubtitleService {
  private known = new Map<string, Known>();
  private counter = 0;
  private hashes = new Map<string, string | null>();
  private session?: { token: string; base: string; for: string };
  private refused = '';
  private endpoints: Endpoints;
  constructor(private store: SubtitleKeyStore, private open: Opener, endpoints: Partial<Endpoints> = {}) { this.endpoints = { ...DEFAULT_ENDPOINTS, ...endpoints }; }

  configured = async (): Promise<SubtitleKeys> => {
    const keys = await this.store.load();
    return { opensubtitles: !!keys.opensubtitles?.key, opensubtitlesLogin: !!keys.opensubtitles?.user && !!keys.opensubtitles?.password, subdl: !!keys.subdl?.key };
  };
  // An empty string clears a value; a field left out stays as it was.
  save = async (values: SubtitleKeyValues): Promise<SubtitleKeys> => {
    const keys = await this.store.load(), clean = (v: unknown, label: string) => {
      if (typeof v !== 'string') return undefined; const s = v.trim(); if (!s) return '';
      if (!printable.test(s) || (label === 'key' && /\s/.test(s))) throw new AppError('INVALID', 'Anahtar veya parola geçersiz karakter içeriyor.');
      return s;
    };
    const os = { ...(keys.opensubtitles || { key: '' }) }, sd = { ...(keys.subdl || { key: '' }) };
    const a = clean(values.opensubtitlesKey, 'key'), u = clean(values.opensubtitlesUser, 'user'), p = clean(values.opensubtitlesPassword, 'password'), b = clean(values.subdlKey, 'key');
    if (a !== undefined) os.key = a; if (u !== undefined) os.user = u || undefined; if (p !== undefined) os.password = p || undefined; if (b !== undefined) sd.key = b;
    const next: StoredKeys = {}; if (os.key) next.opensubtitles = os; if (sd.key) next.subdl = sd;
    await this.store.save(next); this.session = undefined; this.refused = '';
    return { opensubtitles: !!next.opensubtitles, opensubtitlesLogin: !!next.opensubtitles?.user && !!next.opensubtitles?.password, subdl: !!next.subdl };
  };

  private async http(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
    let response: Response;
    try { response = await fetch(url, { method: init.method || 'GET', headers: { 'User-Agent': AGENT, Accept: '*/*', ...init.headers }, body: init.body, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) }); }
    catch { throw new AppError('NETWORK', 'Altyazı servisine ulaşılamadı.'); }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > LIMIT) { void response.body?.cancel().catch(() => {}); throw new AppError('SIZE', 'Altyazı servisinin yanıtı çok büyük.'); }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > LIMIT) throw new AppError('SIZE', 'Altyazı servisinin yanıtı çok büyük.');
    return { status: response.status, body, json: () => { try { return JSON.parse(body.toString('utf8')); } catch { return undefined; } } };
  }

  // The fingerprint of the file being played, once per file. Best effort: a provider that refuses a second
  // connection, or a file that is not there, only means the search goes by title and film number alone.
  private async fingerprint(source: string | undefined): Promise<string | undefined> {
    if (!source) return undefined;
    if (this.hashes.has(source)) return this.hashes.get(source) || undefined;
    let found: string | undefined, file: Source | undefined;
    try {
      file = await this.open(source);
      if (file && file.size >= 131072) found = movieHash(file.size, await file.read(0, 65536), await file.read(file.size - 65536, 65536));
    } catch { /* no fingerprint */ } finally { file?.close?.(); }
    if (this.hashes.size >= 20) this.hashes.delete(this.hashes.keys().next().value!);
    this.hashes.set(source, found ?? null);
    return found;
  }

  search = async (query: SubtitleQuery): Promise<SubtitleSearchResult> => {
    const keys = await this.store.load();
    if (!keys.opensubtitles?.key && !keys.subdl?.key) throw new AppError('NO_KEY', 'İnternetten altyazı aramak için Ayarlar’daki “Altyazı arama” bölümüne ücretsiz bir API anahtarı girin.');
    const hash = keys.opensubtitles?.key ? await this.fingerprint(query.source) : undefined;
    const jobs: Array<[string, Promise<SubtitleHit[]>]> = [];
    if (keys.opensubtitles?.key) jobs.push(['OpenSubtitles', this.searchOpenSubtitles(keys.opensubtitles, query, hash)]);
    if (keys.subdl?.key) jobs.push(['SubDL', this.searchSubdl(keys.subdl.key, query)]);
    const settled = await Promise.allSettled(jobs.map(([, job]) => job)), hits: SubtitleHit[] = [], notes: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') hits.push(...result.value);
      else notes.push(`${jobs[i][0]}: ${result.reason instanceof AppError ? result.reason.message : 'Arama tamamlanamadı.'}`);
    });
    const ranked = rankHits(hits, query.hint);
    // Only the finds the viewer can choose from are remembered, and only the latest searches' worth.
    const keep = new Set(ranked.map(h => h.id)); for (const id of this.known.keys()) if (!keep.has(id) && this.known.size > 400) this.known.delete(id);
    if (!ranked.length && !notes.length) notes.push('Bu film için İngilizce, Farsça veya Türkçe altyazı bulunamadı.');
    return { hits: ranked, notes };
  };

  private remember(entry: Known): string { const id = `${entry.provider === 'subdl' ? 'sd' : 'os'}${++this.counter}`; this.known.set(id, entry); return id; }

  // --- OpenSubtitles ---
  private async openSubtitlesSession(login: { key: string; user?: string; password?: string }) {
    const base = this.endpoints.openSubtitles;
    if (!login.user || !login.password) return { base, token: '' };
    const who = `${login.user}\0${login.password}`;
    if (this.session && this.session.for === who) return this.session;
    // Logging in is expensive for the service, and a wrong password must not be sent again and again.
    if (this.refused === who) throw new AppError('AUTH', 'OpenSubtitles kullanıcı adı veya parolası geçersiz. Ayarlar’dan düzeltin.');
    const reply = await this.http(`${base}/login`, { method: 'POST', headers: { 'Api-Key': login.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: login.user, password: login.password }) });
    if (reply.status === 401 || reply.status === 400) { this.refused = who; throw new AppError('AUTH', 'OpenSubtitles kullanıcı adı veya parolası geçersiz. Ayarlar’dan düzeltin.'); }
    const json = reply.json();
    if (reply.status !== 200 || typeof json?.token !== 'string') throw new AppError('SERVICE', 'OpenSubtitles girişi tamamlanamadı.');
    // A signed-in user may be sent to another host of the service (its VIP one); only the service's own domain is followed.
    const vip = typeof json.base_url === 'string' && /^[a-z0-9.-]+\.opensubtitles\.com$/i.test(json.base_url) && base === DEFAULT_ENDPOINTS.openSubtitles;
    this.session = { token: json.token, base: vip ? `https://${json.base_url}/api/v1` : base, for: who };
    return this.session;
  }
  private osHeaders(key: string, token: string): Record<string, string> { return { 'Api-Key': key, Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }; }
  private async searchOpenSubtitles(login: { key: string; user?: string; password?: string }, q: SubtitleQuery, hash: string | undefined): Promise<SubtitleHit[]> {
    const { base, token } = await this.openSubtitlesSession(login), episode = q.season !== undefined && q.episode !== undefined;
    // Parameters sorted and in lowercase, as the service asks, so it answers from its cache rather than redirecting.
    const run = async (params: Record<string, string>) => {
      const sorted = new URLSearchParams(Object.keys(params).sort().map(k => [k, params[k]]));
      const reply = await this.http(`${base}/subtitles?${sorted}`, { headers: this.osHeaders(login.key, token) });
      if (reply.status === 401 || reply.status === 403) throw new AppError('AUTH', 'API anahtarı reddedildi. Ayarlar’dan kontrol edin.');
      if (reply.status === 429) throw new AppError('RATE', 'Çok fazla istek gönderildi. Biraz sonra yeniden deneyin.');
      const json = reply.json();
      if (reply.status !== 200 || !Array.isArray(json?.data)) throw new AppError('SERVICE', 'Servis geçerli bir yanıt vermedi.');
      return json.data as any[];
    };
    const languages = SUBTITLE_LANGUAGES.slice().sort().join(',');
    // Two searches: one by the file's fingerprint alone (it must not be filtered by a title the provider got wrong),
    // and one by the film's number, or by its name when the provider sends none.
    const byTitle: Record<string, string> = { languages };
    if (episode) {
      Object.assign(byTitle, { episode_number: String(q.episode), season_number: String(q.season), type: 'episode' });
      if (q.tmdb) byTitle.parent_tmdb_id = String(q.tmdb); else if (q.imdb) byTitle.parent_imdb_id = String(q.imdb); else byTitle.query = q.title.toLowerCase();
    } else {
      byTitle.type = 'movie';
      if (q.tmdb) byTitle.tmdb_id = String(q.tmdb); else if (q.imdb) byTitle.imdb_id = String(q.imdb); else { byTitle.query = q.title.toLowerCase(); if (q.year) byTitle.year = String(q.year); }
    }
    const jobs = [run(byTitle)]; if (hash) jobs.unshift(run({ languages, moviehash: hash }));
    const settled = await Promise.allSettled(jobs), rows = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (!rows.length && settled.every(r => r.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason;
    const byFile = new Map<number, { hit: SubtitleHit; name: string }>();
    for (const row of rows) {
      const a = row?.attributes, file = a?.files?.[0], language = String(a?.language || '').toLowerCase() as SubtitleLanguage;
      if (!file || !Number.isInteger(file.file_id) || !SUBTITLE_LANGUAGES.includes(language)) continue;
      const exact = a.moviehash_match === true, earlier = byFile.get(file.file_id);
      if (earlier) { if (exact) earlier.hit.hash = true; continue; }
      const release = String(a.release || file.file_name || a.feature_details?.title || '').slice(0, 200);
      byFile.set(file.file_id, { name: String(file.file_name || 'altyazi.srt'), hit: { id: '', provider: 'opensubtitles', language, release, hash: exact, downloads: Number(a.download_count) || 0, hearingImpaired: a.hearing_impaired === true, trusted: a.from_trusted === true, ...(Number(a.fps) > 0 ? { fps: Number(a.fps) } : {}) } });
    }
    return Array.from(byFile, ([fileId, { hit, name }]) => { hit.id = this.remember({ provider: 'opensubtitles', fileId, name }); return hit; });
  }
  private async downloadOpenSubtitles(entry: Known, login: { key: string; user?: string; password?: string }): Promise<Buffer> {
    const { base, token } = await this.openSubtitlesSession(login);
    const reply = await this.http(`${base}/download`, { method: 'POST', headers: { ...this.osHeaders(login.key, token), 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: entry.fileId }) });
    const json = reply.json();
    if (reply.status === 406) throw new AppError('QUOTA', `OpenSubtitles günlük indirme hakkı doldu${json?.reset_time ? ` (yenilenme: ${String(json.reset_time).slice(0, 40)})` : ''}. Ayarlar’a OpenSubtitles kullanıcı adı ve parolanızı girerek hakkınızı artırabilirsiniz.`);
    if (reply.status === 401 || reply.status === 403) throw new AppError('AUTH', 'OpenSubtitles anahtarı veya girişi reddedildi. Ayarlar’dan kontrol edin.');
    if (reply.status === 429) throw new AppError('RATE', 'Çok fazla istek gönderildi. Biraz sonra yeniden deneyin.');
    if (reply.status !== 200 || typeof json?.link !== 'string') throw new AppError('SERVICE', 'OpenSubtitles indirme bağlantısı vermedi.');
    // The link is temporary and comes from the service; only a web address is followed.
    if (!/^https?:\/\//i.test(json.link)) throw new AppError('SERVICE', 'OpenSubtitles geçersiz bir bağlantı verdi.');
    const file = await this.http(json.link);
    if (file.status !== 200) throw new AppError('SERVICE', 'Altyazı dosyası indirilemedi.');
    return file.body;
  }

  // --- SubDL ---
  private async searchSubdl(key: string, q: SubtitleQuery): Promise<SubtitleHit[]> {
    const episode = q.season !== undefined && q.episode !== undefined, params: Record<string, string> = { api_key: key, languages: SUBTITLE_LANGUAGES.map(l => l.toUpperCase()).join(','), releases: '1', subs_per_page: '30', type: episode ? 'tv' : 'movie' };
    if (q.tmdb) params.tmdb_id = String(q.tmdb); else if (q.imdb) params.imdb_id = `tt${String(q.imdb).padStart(7, '0')}`; else { params.film_name = q.title; if (q.year && !episode) params.year = String(q.year); }
    if (episode) { params.season_number = String(q.season); params.episode_number = String(q.episode); }
    const reply = await this.http(`${this.endpoints.subdl}/subtitles?${new URLSearchParams(params)}`);
    const json = reply.json();
    if (reply.status === 401 || reply.status === 403) throw new AppError('AUTH', 'API anahtarı reddedildi. Ayarlar’dan kontrol edin.');
    if (reply.status === 429) throw new AppError('RATE', 'Çok fazla istek gönderildi. Biraz sonra yeniden deneyin.');
    // "can't find" is how the service says nothing matched; it is an answer, not a failure.
    if (json && json.status === false) { if (/can'?t find|not found/i.test(String(json.error || ''))) return []; throw new AppError('SERVICE', 'Servis aramayı kabul etmedi.'); }
    if (reply.status !== 200 || !Array.isArray(json?.subtitles)) throw new AppError('SERVICE', 'Servis geçerli bir yanıt vermedi.');
    const names: Record<string, SubtitleLanguage> = { english: 'en', farsi_persian: 'fa', persian: 'fa', farsi: 'fa', turkish: 'tr' };
    const out: SubtitleHit[] = [];
    for (const row of json.subtitles as any[]) {
      const raw = String(row?.language || row?.lang || '').toLowerCase(), language = (SUBTITLE_LANGUAGES as string[]).includes(raw) ? raw as SubtitleLanguage : names[raw];
      const path = typeof row?.url === 'string' ? row.url : '';
      if (!language || !/^\/[A-Za-z0-9_\-./]+$/.test(path) || path.includes('..') || path.startsWith('//')) continue;
      // A search for one episode also returns the others of a pack; keep what could contain the one asked for.
      if (episode && !row.full_season && ((Number.isInteger(row.episode) && row.episode > 0 && row.episode !== q.episode) || (Number.isInteger(row.season) && row.season > 0 && row.season !== q.season))) continue;
      const release = String(row.release_name || row.name || (Array.isArray(row.releases) ? row.releases[0] : '') || '').slice(0, 200);
      const id = this.remember({ provider: 'subdl', path, name: release || 'altyazi', episode: episode ? q.episode : undefined });
      out.push({ id, provider: 'subdl', language, release, hash: false, downloads: 0, hearingImpaired: row.hi === true, trusted: false });
    }
    return out;
  }
  private async downloadSubdl(entry: Known): Promise<Buffer> {
    const reply = await this.http(`${this.endpoints.subdlFiles}${entry.path}`);
    if (reply.status !== 200) throw new AppError('SERVICE', 'SubDL altyazı dosyasını vermedi.');
    return reply.body;
  }

  get = async (id: string): Promise<SubtitleFile> => {
    const entry = this.known.get(id); if (!entry) throw new AppError('NOT_FOUND', 'Bu altyazı artık listede değil. Aramayı yenileyin.');
    const keys = await this.store.load();
    let bytes: Buffer, name = entry.name;
    if (entry.provider === 'opensubtitles') { if (!keys.opensubtitles?.key) throw new AppError('NO_KEY', 'OpenSubtitles anahtarı kayıtlı değil.'); bytes = await this.downloadOpenSubtitles(entry, keys.opensubtitles); }
    else bytes = await this.downloadSubdl(entry);
    if (isRar(bytes)) throw new AppError('FORMAT', 'Altyazı RAR arşivi içinde geliyor; bu uygulama onu açamıyor. Listeden başkasını seçin.');
    if (isZip(bytes)) {
      const inner = subtitleFromZip(bytes, entry.episode);
      if (!inner) throw new AppError('FORMAT', 'Arşivde .srt veya .vtt altyazı bulunamadı. Listeden başkasını seçin.');
      bytes = inner.data; name = inner.name;
    }
    if (bytes.length > MAX_SUBTITLE_BYTES) throw new AppError('SIZE', 'Altyazı dosyası beklenenden büyük.');
    if (!/\.(?:srt|vtt)$/i.test(name)) name = `${name.replace(/\.[A-Za-z0-9]{1,4}$/, '')}.srt`;
    return { name: name.slice(0, 120), data: bytes.toString('base64') };
  };
}
