import { createHash } from 'crypto';
import { AppError, object, publicError, text } from '../core/errors';
import { imageUrl, normalizeCredentials, parseKind, Xtream } from '../core/xtream';
import { normalizeLibrary } from '../core/library';
import type { Account, Action, Credentials, Item, Library, Login, Playback, Reply, Status } from '../core/models';
import { NodeTransport } from './http';
export interface Vault { exists(): Promise<boolean>; save(credentials: Credentials, passphrase?: string): Promise<void>; load(passphrase?: string): Promise<Credentials>; clear(): Promise<void> }
// `readIcons`/`writeIcons` keep the poster addresses of favourites and history in a file the
// page never sees, so those posters survive a restart without the library holding any URL.
export interface LibraryStore { read(profile: string): Promise<Library>; write(profile: string, library: Library): Promise<void>; clear(): Promise<void>; readIcons?(profile: string): Promise<Record<string, unknown>>; writeIcons?(profile: string, icons: Record<string, string>): Promise<void> }
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
  constructor(private vault: Vault, private store: LibraryStore, private platform: Status['platform'], private media: (url: string) => string = u => u, private clearMedia: () => void = () => {}, private mediaStats: () => unknown = () => null, private mediaLimit: (max: number) => void = () => {}) {}
  async call(action: Action, payload?: unknown): Promise<Reply> {
    try { return { ok: true, data: await this.dispatch(action, object(payload)) }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  }
  private async login(raw: Login, restored = false): Promise<Account> {
    const generation = ++this.revision;
    this.client = undefined; this.account = undefined; this.clearMedia(); this.icons.clear(); this.iconsSaved = ''; this.posters = false;
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
  private async dispatch(action: Action, p: Record<string, any>): Promise<unknown> {
    if (action === 'status') return { saved: await this.vault.exists(), requiresPassphrase: this.platform === 'tv', platform: this.platform };
    if (action === 'login') return this.login(p as Login);
    if (action === 'unlock') { const credentials = await this.vault.load(text(p.passphrase, 512)); return this.login({ ...credentials, allowHttp: true, remember: false }, true); }
    if (action === 'logout') { ++this.revision; this.client = undefined; this.account = undefined; this.clearMedia(); this.icons.clear(); this.iconsSaved = ''; this.posters = false; if (p.forget === true) { await this.vault.clear(); await this.store.clear(); } return null; }
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
      default: throw new AppError('METHOD', 'Desteklenmeyen işlem.');
    }
  }
}
