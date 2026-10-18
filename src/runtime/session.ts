import { createHash } from 'crypto';
import { AppError, id, object, publicError, text } from '../core/errors';
import { imageUrl, normalizeCredentials, parseKind, Xtream } from '../core/xtream';
import { normalizeLibrary } from '../core/library';
import type { Account, Action, Credentials, Download, Item, Library, Login, Playback, Recording, Reply, Status } from '../core/models';
import { NodeTransport } from './http';
export interface Vault { exists(): Promise<boolean>; save(credentials: Credentials, passphrase?: string): Promise<void>; load(passphrase?: string): Promise<Credentials>; clear(): Promise<void> }
// `readIcons`/`writeIcons` keep the poster addresses of favourites and history in a file the
// page never sees, so those posters survive a restart without the library holding any URL.
export interface LibraryStore { read(profile: string): Promise<Library>; write(profile: string, library: Library): Promise<void>; clear(): Promise<void>; readIcons?(profile: string): Promise<Record<string, unknown>>; writeIcons?(profile: string, icons: Record<string, string>): Promise<void> }
// Where a film or episode is written to disk. The page asks for an item by id; the address (which
// carries the account) is built here and handed over, and never goes back to the page.
export interface DownloadHost { start(url: string, name: string, extension: string, source?: string): Download; list(): Download[]; cancel(id: string): void; retry(id: string): void; remove(id: string): void; reveal(id: string): void; clear(): void; use(profile: string): void; open(id: string): string; trash(id: string): Promise<void>; size(url: string): Promise<number>; configure(options: { autoRetry: boolean }): void }
// Live channels written to disk. The page names a channel by id; the address (which carries the account)
// is built here, handed over as `bind`'s resolver, and never goes back to the page. `bind('', undefined)` ends the account's recordings.
export interface RecordingHost { start(streamId: string, channel: string, minutes?: number): Recording; schedule(streamId: string, channel: string, start: number, end: number): Recording; stop(id: string): void; remove(id: string): void; retry(id: string): void; reveal(id: string): void; list(): Recording[]; bind(profile: string, source?: (streamId: string, hls: boolean) => string): void }
export class Session {
  private client?: Xtream;
  private account?: Account;
  private revision = 0;
  // Poster addresses stay in this process. The page only ever sees `kiyi://image/<kind>/<id>`,
  // which the image gateway resolves through `posterUrl`, so a provider's image host never
  // reaches the renderer and is never asked for anything but an image.
  private icons = new Map<string, string>();
  private iconsSaved = '';
  private static readonly ICON_LIMIT = 200000;
  // Off until the library says otherwise. While it is off nothing is served (so no picture host
  // is ever contacted, whatever the page asks for) and no poster address is kept on disk.
  private posters = false;
  posterUrl = (kind: string, id: string): string | undefined => this.account && this.posters ? this.icons.get(`${kind}:${id}`) : undefined;
  constructor(private vault: Vault, private store: LibraryStore, private platform: Status['platform'], private media: (url: string) => string = u => u, private clearMedia: () => void = () => {}, private mediaStats: () => unknown = () => null, private mediaLimit: (max: number) => void = () => {}, private downloads?: DownloadHost, private recordings?: RecordingHost) {}
  async call(action: Action, payload?: unknown): Promise<Reply> {
    try { return { ok: true, data: await this.dispatch(action, object(payload)) }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  }
  private async login(raw: Login, restored = false): Promise<Account> {
    const generation = ++this.revision;
    this.client = undefined; this.account = undefined; this.clearMedia(); this.recordings?.bind('', undefined); this.downloads?.clear(); this.icons.clear(); this.iconsSaved = ''; this.posters = false;
    const credentials = normalizeCredentials(raw, raw.allowHttp === true);
    const client = new Xtream(credentials, new NodeTransport());
    const result = await client.authenticate();
    if (generation !== this.revision) throw new AppError('CANCELLED', 'Oturum değişti. Yeniden giriş yapın.');
    if (!restored) {
      if (raw.remember === true) await this.vault.save(credentials, raw.passphrase);
      else await this.vault.clear();
    }
    if (generation !== this.revision) throw new AppError('CANCELLED', 'Oturum değişti. Yeniden giriş yapın.');
    this.client = client;
    this.mediaLimit(result.maxConnections);
    this.account = { ...result, profile: createHash('sha256').update(credentials.server + '\0' + credentials.username).digest('hex').slice(0, 24) };
    this.downloads?.use(this.account.profile);
    this.recordings?.bind(this.account.profile, (streamId, hls) => client.stream('live', streamId, hls ? 'm3u8' : 'ts'));
    return this.account;
  }
  private withoutIcon({ icon, ...row }: Item): Item {
    if (icon && this.icons.size < Session.ICON_LIMIT) this.icons.set(`${row.kind}:${row.id}`, icon);
    return row;
  }
  // Favourites and history are the lists the page can show without the catalogue being open, so
  // their poster addresses are the only ones worth remembering between runs.
  private async loadIcons(profile: string) {
    if (!this.store.readIcons) return;
    try {
      const saved = await this.store.readIcons(profile);
      for (const [key, value] of Object.entries(saved)) { const url = imageUrl(value); if (url && /^(live|vod|series):\d{1,20}$/.test(key) && !this.icons.has(key)) this.icons.set(key, url); }
      this.iconsSaved = JSON.stringify(saved);
    } catch { /* posters are a convenience; a bad file just means none */ }
  }
  private async saveIcons(profile: string, library: Library) {
    if (!this.store.writeIcons) return;
    const wanted: Record<string, string> = {};
    if (this.posters) for (const item of [...library.favorites, ...library.recent.map(row => row.item)]) { const key = `${item.kind}:${item.id}`, url = item.isEpisode ? undefined : this.icons.get(key); if (url) wanted[key] = url; }
    const json = JSON.stringify(wanted);
    if (json === this.iconsSaved || (json === '{}' && !this.iconsSaved)) return; // nothing to remember, nothing saved
    try { await this.store.writeIcons(profile, wanted); this.iconsSaved = json; } catch { /* same: never fail a save over a poster */ }
  }
  private fileUrl(client: Xtream, p: Record<string, any>): string {
    const kind = parseKind(p.kind), ext = text(p.extension, 8).toLowerCase();
    if (kind === 'live') throw new AppError('INVALID', 'Canlı yayınlar indirilemez.');
    if (ext === 'm3u8') throw new AppError('INVALID', 'Bu içerik tek bir dosya olarak sunulmuyor; indirilemez.');
    return client.stream(kind, text(p.id), ext);
  }
  private recorder(): RecordingHost { if (!this.recordings) throw new AppError('METHOD', 'Bu cihazda kayıt desteklenmiyor.'); return this.recordings; }
  private host(): DownloadHost { if (!this.downloads) throw new AppError('METHOD', 'Bu cihazda indirme desteklenmiyor.'); return this.downloads; }
  private async dispatch(action: Action, p: Record<string, any>): Promise<unknown> {
    if (action === 'status') return { saved: await this.vault.exists(), requiresPassphrase: this.platform === 'tv', platform: this.platform };
    if (action === 'login') return this.login(p as Login);
    if (action === 'unlock') { const credentials = await this.vault.load(text(p.passphrase, 512)); return this.login({ ...credentials, allowHttp: true, remember: false }, true); }
    if (action === 'logout') { ++this.revision; this.client = undefined; this.account = undefined; this.clearMedia(); this.recordings?.bind('', undefined); this.downloads?.clear(); this.icons.clear(); this.iconsSaved = ''; this.posters = false; if (p.forget === true) { await this.vault.clear(); await this.store.clear(); } return null; }
    if (!this.client || !this.account) throw new AppError('LOCKED', 'Oturum kilitlendi. Lütfen tekrar giriş yapın.');
    const client = this.client;
    switch (action) {
      case 'heartbeat': return true;
      case 'mediaStats': return this.mediaStats();
      case 'stop': this.clearMedia(); return null;
      case 'categories': return client.categories(parseKind(p.kind));
      case 'items': return (await client.items(parseKind(p.kind), p.category ? text(p.category, 50) : undefined)).map(row => this.withoutIcon(row));
      case 'epg': return client.epg(text(p.id));
      case 'detail': return client.detail(parseKind(p.kind), text(p.id));
      case 'library': { const library = await this.store.read(this.account.profile); this.posters = library.preferences.posters; await this.loadIcons(this.account.profile); return library; }
      case 'saveLibrary': { const library = normalizeLibrary(p.library); this.posters = library.preferences.posters; await this.store.write(this.account.profile, library); await this.saveIcons(this.account.profile, library); return library; }
      // There is nothing for the viewer to choose here: live TV always goes out as HLS through
      // hls.js, which copes with the codecs and sliding-window playlists that the native HLS
      // parser stumbled on, and with a deep buffer, because a provider that stutters is a worse
      // experience than a channel that runs a few seconds behind. Measurements: docs/VALIDATION.md.
      case 'play': {
        const kind = parseKind(p.kind), ext = kind === 'live' ? 'm3u8' : text(p.extension, 8);
        this.clearMedia();
        return { url: this.media(client.stream(kind, text(p.id), ext)), format: ext === 'm3u8' ? 'hls' : ext === 'ts' ? 'ts' : 'file', live: kind === 'live', engine: kind === 'live' ? 'js' : undefined, buffer: 'large' } as Playback;
      }
      case 'download': { const host = this.host(), url = this.fileUrl(client, p); return host.start(url, text(p.name, 200).trim() || 'İsimsiz', /\.([a-z0-9]{1,6})$/.exec(url)?.[1] || 'mp4', `${parseKind(p.kind)}:${text(p.id, 20)}`); }
      // How big the file is, so the viewer knows before pressing the button. 0 means the server did not say.
      case 'downloadSize': { const host = this.host(); return host.size(this.fileUrl(client, p)); }
      case 'record': { const minutes = Number(p.minutes); return this.recorder().start(id(p.id), text(p.name, 120).trim() || 'Kanal', Number.isFinite(minutes) && minutes > 0 ? Math.min(720, minutes) : undefined); }
      case 'recordSchedule': return this.recorder().schedule(id(p.id), text(p.name, 120).trim() || 'Kanal', Number(p.start), Number(p.end));
      case 'recordings': return this.recorder().list();
      case 'stopRecording': this.recorder().stop(text(p.id, 40)); return null;
      case 'removeRecording': this.recorder().remove(text(p.id, 40)); return null;
      case 'retryRecording': this.recorder().retry(text(p.id, 40)); return null;
      case 'revealRecording': this.recorder().reveal(text(p.id, 40)); return null;
      case 'downloadSettings': this.host().configure({ autoRetry: p.autoRetry === true }); return null;
      case 'downloads': return this.host().list();
      case 'cancelDownload': this.host().cancel(text(p.id, 40)); return null;
      case 'retryDownload': this.host().retry(text(p.id, 40)); return null;
      case 'removeDownload': this.host().remove(text(p.id, 40)); return null;
      case 'playDownload': return { url: this.host().open(text(p.id, 40)), format: 'file', live: false, buffer: 'normal', local: true } as Playback;
      case 'trashDownload': await this.host().trash(text(p.id, 40)); return null;
      case 'revealDownload': this.host().reveal(text(p.id, 40)); return null;
      default: throw new AppError('METHOD', 'Desteklenmeyen işlem.');
    }
  }
}
