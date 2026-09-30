export type Kind = 'live' | 'vod' | 'series';
export interface Credentials { server: string; username: string; password: string }
export interface Login extends Credentials { remember: boolean; passphrase?: string; allowHttp: boolean }
export interface Account { profile: string; expires?: number; connections: number; maxConnections: number }
export interface Category { id: string; name: string }
export interface Item { id: string; kind: Kind; name: string; categoryId: string; icon?: string; extension?: string; rating?: string; isEpisode?: boolean }
export interface Programme { id: string; title: string; description: string; start: number; end: number }
export interface Episode extends Item { season: number; episode: number; plot?: string; duration?: string }
export interface Detail { title: string; plot: string; genre: string; cast: string; director: string; year: string; duration: string; rating: string; extension?: string; episodes: Episode[] }
export interface Playback { url: string; format: 'hls' | 'file' | 'ts'; live: boolean; engine?: 'js'; buffer?: Buffering }
export type Buffering = 'normal' | 'large';
export interface Preferences { volume: number; muted: boolean; resume: boolean }
export interface Recent { item: Item; at: number; position: number }
export interface Library { favorites: Item[]; recent: Recent[]; preferences: Preferences }
export interface Status { saved: boolean; requiresPassphrase: boolean; platform: 'mac' | 'tv' | 'preview' }
// Cumulative counters from the media path, so the stream panel can show whether the provider
// is keeping up. Platforms without a media gateway report null and the rows stay hidden.
export interface MediaStats { delivered: number; requests: number; failures: number; lastStatus: number; slowestMs: number; peakBps: number; retries: number; open: number }
export interface Reply<T = unknown> { ok: boolean; data?: T; error?: { code: string; message: string } }
export type Action = 'status' | 'login' | 'unlock' | 'logout' | 'categories' | 'items' | 'epg' | 'detail' | 'play' | 'stop' | 'library' | 'saveLibrary' | 'heartbeat' | 'mediaStats';
export interface Bridge { call<T>(action: Action, payload?: unknown): Promise<T> }
export interface Platform extends Bridge { type: 'mac' | 'tv' | 'preview'; attach(video: HTMLVideoElement, playback: Playback, onError: (message: string) => void): () => void; exit(): void }
export const DEFAULT_LIBRARY: Library = { favorites: [], recent: [], preferences: { volume: 0.8, muted: false, resume: true } };
export const itemKey = (item: Item) => `${item.kind}:${item.isEpisode ? 'episode:' : ''}${item.id}`;
