import type { Account, Category, Credentials, Detail, Episode, Item, Kind } from './models';
import { AppError, id, invalid, object, text } from './errors';
import { normalizeEpg } from './epg';
export interface Transport { json(url: string): Promise<unknown> }
export function normalizeCredentials(value: Credentials, allowHttp: boolean): Credentials {
  let url: URL;
  try { url = new URL(value.server.trim()); } catch { throw new AppError('SERVER', 'Sunucu adresini https://sunucu:port biçiminde girin.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw invalid();
  if (url.protocol === 'http:' && !allowHttp) throw new AppError('HTTP', 'HTTP bağlantısı için açık metin aktarımını onaylayın.');
  const path = url.pathname.replace(/\/(player_api\.php|xmltv\.php|get\.php)\/?$/, '').replace(/\/+$/, '');
  if (!value.username?.trim() || !value.password || value.username.length > 500 || value.password.length > 500) throw invalid();
  return { server: `${url.origin}${path}`, username: value.username.trim(), password: value.password };
}
export function parseKind(value: unknown): Kind { if (value !== 'live' && value !== 'vod' && value !== 'series') throw invalid(); return value; }
export class Xtream {
  constructor(private credentials: Credentials, private transport: Transport) {}
  private async request(action?: string, params: Record<string, string> = {}): Promise<unknown> {
    const c = this.credentials;
    const query = Object.entries({ username: c.username, password: c.password, ...(action ? { action } : {}), ...params }).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const result = await this.transport.json(`${c.server}/player_api.php?${query}`);
    if (object(result).user_info && String(object(object(result).user_info).auth) === '0') throw new AppError('AUTH', 'Kullanıcı adı veya şifre geçersiz.');
    return result;
  }
  async authenticate(): Promise<Omit<Account, 'profile'>> {
    const response = object(await this.request()), user = object(response.user_info);
    if (String(user.auth) !== '1') throw new AppError('AUTH', 'Kullanıcı adı veya şifre geçersiz.');
    if (user.status && text(user.status).toLowerCase() !== 'active') throw new AppError('INACTIVE', 'Hesap etkin değil veya süresi dolmuş.');
    const expires = Number(user.exp_date) * 1000;
    if (expires && expires < Date.now()) throw new AppError('EXPIRED', 'Hesabın kullanım süresi dolmuş.');
    return { expires: expires || undefined, connections: Number(user.active_cons) || 0, maxConnections: Number(user.max_connections) || 0 };
  }
  async categories(kind: Kind): Promise<Category[]> {
    const rows = await this.request(`get_${kind}_categories`);
    if (!Array.isArray(rows)) throw new AppError('RESPONSE', 'Sunucu kategori listesini geçerli biçimde göndermedi.');
    return rows.map(object).filter(x => /^\d+$/.test(text(x.category_id))).map(x => ({ id: text(x.category_id), name: text(x.category_name, 250) || 'Diğer' }));
  }
  async items(kind: Kind, category?: string): Promise<Item[]> {
    const rows = await this.request(kind === 'series' ? 'get_series' : `get_${kind}_streams`, category ? { category_id: id(category) } : {});
    if (!Array.isArray(rows)) throw new AppError('RESPONSE', 'Sunucu içerik listesini geçerli biçimde göndermedi.');
    return rows.map(object).filter(x => /^\d+$/.test(text(x.stream_id ?? x.series_id))).map(x => ({ id: text(x.stream_id ?? x.series_id), kind, name: text(x.name, 250) || 'İsimsiz', categoryId: text(x.category_id), extension: this.extension(x.container_extension), rating: text(x.rating, 10) }));
  }
  async epg(streamId: string) { return normalizeEpg(await this.request('get_short_epg', { stream_id: id(streamId), limit: '30' })); }
  async detail(kind: Kind, itemId: string): Promise<Detail> {
    const result = object(await this.request(kind === 'series' ? 'get_series_info' : 'get_vod_info', { [kind === 'series' ? 'series_id' : 'vod_id']: id(itemId) }));
    const info = object(result.info), movie = object(result.movie_data), episodes: Episode[] = [];
    Object.entries(object(result.episodes)).forEach(([season, entries]) => {
      if (!Array.isArray(entries)) return;
      entries.forEach(entry => {
        const e = object(entry), meta = object(e.info);
        if (!/^\d+$/.test(text(e.id))) return;
        episodes.push({ id: text(e.id), kind: 'series', isEpisode: true, name: text(e.title, 250) || `Bölüm ${text(e.episode_num)}`, categoryId: '', season: Number(e.season ?? season) || 1, episode: Number(e.episode_num) || 0, extension: this.extension(e.container_extension), plot: text(meta.plot, 12000), duration: text(meta.duration) });
      });
    });
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return { title: text(info.name ?? movie.name, 250), plot: text(info.plot ?? info.description, 12000), genre: text(info.genre), cast: text(info.cast), director: text(info.director), year: text(info.releasedate ?? info.releaseDate ?? info.year), duration: text(info.duration), rating: text(info.rating), extension: movie.container_extension ? this.extension(movie.container_extension) : undefined, episodes };
  }
  stream(kind: Kind, itemId: string, extension?: string): string {
    const c = this.credentials;
    const ext = kind === 'live' ? (extension === 'ts' ? 'ts' : 'm3u8') : this.extension(extension);
    return `${c.server}/${kind === 'vod' ? 'movie' : kind}/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${id(itemId)}.${ext}`;
  }
  private extension(value: unknown) { const s = text(value, 8).toLowerCase(); return /^[a-z0-9]{1,6}$/.test(s) ? s : 'mp4'; }
}
