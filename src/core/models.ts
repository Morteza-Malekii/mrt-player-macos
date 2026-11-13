export type Kind = 'live' | 'vod' | 'series';
export interface Credentials { server: string; username: string; password: string }
export interface Login extends Credentials { remember: boolean; passphrase?: string; allowHttp: boolean }
export interface Account { profile: string; expires?: number; connections: number; maxConnections: number }
export interface Category { id: string; name: string }
// An episode also carries what a subtitle search needs and its own name does not say: the series' title and
// id, and the season and episode numbers. Nothing here is a provider address.
export interface Item { id: string; kind: Kind; name: string; categoryId: string; icon?: string; extension?: string; rating?: string; isEpisode?: boolean; series?: string; seriesId?: string; season?: number; episode?: number }
export interface Programme { id: string; title: string; description: string; start: number; end: number }
export interface Episode extends Item { season: number; episode: number; plot?: string; duration?: string }
// `tmdb` and `imdb` are the film's numbers at the two big film databases, when the provider knows them.
export interface Detail { tmdb?: string; imdb?: string; title: string; plot: string; genre: string; cast: string; director: string; year: string; duration: string; rating: string; extension?: string; episodes: Episode[] }
// `at` is where this route starts (seconds), when the player moves a title to another route mid-way.
// `remux` plays the title through the bundled converter: the picture as it is, the chosen dub (`audio`,
// its place among the file's dubs) turned into AAC, because Chromium cannot decode AC-3, E-AC-3 or DTS.
export interface Playback { url: string; format: 'hls' | 'file' | 'ts'; live: boolean; engine?: 'js'; buffer?: Buffering; local?: boolean; at?: number; remux?: { audio: number; video: VideoFamily; duration: number } }
export type VideoFamily = 'avc' | 'hevc' | 'av1' | 'vp9';
// What a film's own file holds, read from its header as the player loads it (Matroska and MP4). `id` is the
// track number, `index` the track's place among all tracks, `order` its place among tracks of its kind.
// `text` subtitles are lifted out of the file as it plays; picture-based ones (PGS, VobSub) cannot be shown.
export interface MediaTrack { id: number; index: number; order: number; kind: 'audio' | 'subtitle'; codec: string; language: string; name: string; channels?: number; default: boolean; forced: boolean; text: boolean }
// `video` is set when the picture can go through the converter unchanged (H.264, HEVC, AV1, VP9).
export interface MediaTracks { format: 'matroska' | 'mp4' | 'other'; duration: number; video?: VideoFamily; tracks: MediaTrack[] }
export interface CueBatch { cues: Array<{ start: number; end: number; text: string }>; next: number }
export type Buffering = 'normal' | 'large';
// Subtitles from the internet (platform/mac/subtitles.ts). The page asks with the item it is playing and gets a
// ranked list back; it never sees a provider's address or key. `hash` marks a subtitle that the service says was
// made for exactly this file (matched by the file's fingerprint), `fps` the frame rate it was timed for.
export type SubtitleLanguage = 'en' | 'fa' | 'tr';
export interface SubtitleHit { id: string; provider: 'opensubtitles' | 'subdl'; language: SubtitleLanguage; release: string; hash: boolean; downloads: number; hearingImpaired: boolean; trusted: boolean; fps?: number }
export interface SubtitleSearchResult { hits: SubtitleHit[]; notes: string[] }
// The subtitle file itself, as base64, so it crosses the bridge as plain text and the page decodes it the way it decodes a file the viewer picked.
export interface SubtitleFile { name: string; data: string }
// Which services have a key saved. The keys themselves never leave the privileged process.
export interface SubtitleKeys { opensubtitles: boolean; opensubtitlesLogin: boolean; subdl: boolean }
export interface SubtitleKeyValues { opensubtitlesKey?: string; opensubtitlesUser?: string; opensubtitlesPassword?: string; subdlKey?: string }
export interface SubtitleQuery { title: string; year?: number; season?: number; episode?: number; tmdb?: number; imdb?: number; source?: string; hint: string }
// `audio` is the language ('tr', 'fa') of the dub the viewer chose last; a film or episode that has a
// track in it starts on that one. Absent until a choice is made, then the file's own default holds.
export interface Preferences { volume: number; muted: boolean; resume: boolean; posters: boolean; autoRetry: boolean; audio?: string }
export interface Recent { item: Item; at: number; position: number }
// A PIN that keeps chosen categories out of sight. Only a salted hash is stored; `categories`
// holds `kind:categoryId` keys, because category ids repeat across live, film and series.
export interface PinRecord { salt: string; hash: string }
export interface Locks { pin?: PinRecord; categories: string[] }
// `hidden` lists categories (as `kind:categoryId`) that are not shown anywhere. Hidden and locked
// never overlap: a category is shown, locked behind the PIN, or hidden.
// The viewer's own order: for the category list of each kind (ids), and for the channels of a
// category (keyed `kind:categoryId`, ids). See core/order.ts for how a partial order is kept.
export interface Order { categories: Partial<Record<Kind, string[]>>; items: Record<string, string[]> }
export interface Library { favorites: Item[]; recent: Recent[]; preferences: Preferences; locks: Locks; hidden: string[]; order: Order }
export type Visibility = 'shown' | 'locked' | 'hidden';
export interface Status { saved: boolean; requiresPassphrase: boolean; platform: 'mac' | 'tv' | 'preview' }
// Cumulative counters from the media path, so the stream panel can show whether the provider
// is keeping up. Platforms without a media gateway report null and the rows stay hidden.
export interface MediaStats { delivered: number; requests: number; failures: number; lastStatus: number; slowestMs: number; peakBps: number; retries: number; open: number }
export interface Reply<T = unknown> { ok: boolean; data?: T; error?: { code: string; message: string } }
// One file transfer to the Mac's disk. Only a name and counters leave the privileged process: the
// stream address carries the account, so it and the file path stay where the transfer runs.
export type DownloadState = 'queued' | 'active' | 'waiting' | 'done' | 'failed' | 'canceled';
// `source` is `kind:id` of the catalogue item the file came from, so a screen can tell it was saved.
// `retry` is set while the state is `waiting`: when the next automatic attempt starts (epoch ms), which attempt it is and how many there are.
export interface Download { id: string; source?: string; name: string; state: DownloadState; received: number; total: number; speed: number; error?: string; retry?: { at: number; n: number; max: number } }
// A live channel being written to disk, or waiting to be. It is first a raw transport stream and is then
// turned into an MP4; a finished one is handed to the downloads list (`fileId`), which plays and removes it.
export type RecordingState = 'scheduled' | 'recording' | 'converting' | 'done' | 'failed' | 'missed';
export interface Recording { id: string; streamId: string; channel: string; name: string; state: RecordingState; start?: number; end?: number; startedAt?: number; bytes: number; error?: string; fileId?: string; hasFile?: boolean }
export type Action = 'status' | 'login' | 'unlock' | 'logout' | 'categories' | 'items' | 'epg' | 'detail' | 'play' | 'stop' | 'library' | 'saveLibrary' | 'heartbeat' | 'mediaStats' | 'download' | 'downloads' | 'cancelDownload' | 'retryDownload' | 'removeDownload' | 'revealDownload' | 'playDownload' | 'trashDownload' | 'downloadSize' | 'downloadSettings' | 'record' | 'recordSchedule' | 'recordings' | 'stopRecording' | 'removeRecording' | 'retryRecording' | 'revealRecording' | 'tracks' | 'subtitleCues' | 'subtitleSearch' | 'subtitleGet' | 'subtitleKeys' | 'saveSubtitleKeys';
export interface Bridge { call<T>(action: Action, payload?: unknown): Promise<T> }
export interface Platform extends Bridge { type: 'mac' | 'tv' | 'preview'; attach(video: HTMLVideoElement, playback: Playback, onError: (message: string) => void): () => void; exit(): void }
export const DEFAULT_LIBRARY: Library = { favorites: [], recent: [], preferences: { volume: 0.8, muted: false, resume: true, posters: false, autoRetry: false }, locks: { categories: [] }, hidden: [], order: { categories: {}, items: {} } };
export const itemKey = (item: Item) => `${item.kind}:${item.isEpisode ? 'episode:' : ''}${item.id}`;
