import { createHash } from 'crypto';
import { AppError, object, publicError, text } from '../core/errors';
import { normalizeCredentials, parseKind, Xtream } from '../core/xtream';
import { normalizeLibrary } from '../core/library';
import type { Account, Action, Credentials, Library, Login, Playback, Reply, Status } from '../core/models';
import { NodeTransport } from './http';
export interface Vault { exists(): Promise<boolean>; save(credentials: Credentials, passphrase?: string): Promise<void>; load(passphrase?: string): Promise<Credentials>; clear(): Promise<void> }
export interface LibraryStore { read(profile: string): Promise<Library>; write(profile: string, library: Library): Promise<void>; clear(): Promise<void> }
export class Session {
  private client?: Xtream;
  private account?: Account;
  private revision = 0;
  constructor(private vault: Vault, private store: LibraryStore, private platform: Status['platform'], private media: (url: string) => string = u => u, private clearMedia: () => void = () => {}, private mediaStats: () => unknown = () => null, private mediaLimit: (max: number) => void = () => {}) {}
  async call(action: Action, payload?: unknown): Promise<Reply> {
    try { return { ok: true, data: await this.dispatch(action, object(payload)) }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  }
  private async login(raw: Login, restored = false): Promise<Account> {
    const generation = ++this.revision;
    this.client = undefined; this.account = undefined; this.clearMedia();
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
  private async dispatch(action: Action, p: Record<string, any>): Promise<unknown> {
    if (action === 'status') return { saved: await this.vault.exists(), requiresPassphrase: this.platform === 'tv', platform: this.platform };
    if (action === 'login') return this.login(p as Login);
    if (action === 'unlock') { const credentials = await this.vault.load(text(p.passphrase, 512)); return this.login({ ...credentials, allowHttp: true, remember: false }, true); }
    if (action === 'logout') { ++this.revision; this.client = undefined; this.account = undefined; this.clearMedia(); if (p.forget === true) { await this.vault.clear(); await this.store.clear(); } return null; }
    if (!this.client || !this.account) throw new AppError('LOCKED', 'Oturum kilitlendi. Lütfen tekrar giriş yapın.');
    const client = this.client;
    switch (action) {
      case 'heartbeat': return true;
      case 'mediaStats': return this.mediaStats();
      case 'stop': this.clearMedia(); return null;
      case 'categories': return client.categories(parseKind(p.kind));
      case 'items': return client.items(parseKind(p.kind), p.category ? text(p.category, 50) : undefined);
      case 'epg': return client.epg(text(p.id));
      case 'detail': return client.detail(parseKind(p.kind), text(p.id));
      case 'library': return this.store.read(this.account.profile);
      case 'saveLibrary': { const library = normalizeLibrary(p.library); await this.store.write(this.account.profile, library); return library; }
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
