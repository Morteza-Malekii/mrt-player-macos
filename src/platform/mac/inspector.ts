// Keeps, per film being played, what its file holds: the track list and the subtitle lines read so far.
// It is fed by the byte ranges the media gateway and the downloads server hand to the player (see
// container.ts), so the page can list every dub and subtitle and show a subtitle that is inside the file.
// A file is only read once it is watched (a film or episode, never a live channel), and everything is
// forgotten when playback stops.
import type { CueBatch, MediaTrack, MediaTracks, VideoFamily } from '../../core/models';
import { MatroskaReader, Mp4Reader, sniff, TEXT_CODECS, type ContainerHeader, type Shared, type Sink, type TextCue } from './container';

interface Watched { format?: 'matroska' | 'mp4' | 'other'; header?: ContainerHeader; cues: Map<number, { list: TextCue[]; seen: Set<string> }> }
const FILES = 8, CUES_PER_TRACK = 20000, BATCH = 2000;
const FAMILIES = new Set<string>(['avc', 'hevc', 'av1', 'vp9']);

// `media/<token>` for a provider's file, `local/<id>` for a downloaded one: the player's own address minus
// the scheme, so the page can name a file by the address it already plays.
export function keyOf(url: string): string | undefined {
  try { const u = new URL(url); return u.protocol === 'kiyi:' && ['media', 'local'].includes(u.host) && /^\/[A-Za-z0-9-]{1,80}$/.test(u.pathname) ? `${u.host}${u.pathname}` : undefined; }
  catch { return undefined; }
}
// Hands every chunk to the reader on its way through. A reader that fails only stops reading; playback
// never waits on it and never sees its errors.
export function observed(body: ReadableStream<Uint8Array>, sink?: Sink): ReadableStream<Uint8Array> {
  if (!sink) return body;
  let broken = false;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) { if (!broken) { try { sink(chunk); } catch { broken = true; } } controller.enqueue(chunk); } }));
}

export class MediaInspector {
  private files = new Map<string, Watched>();
  // `convert` says whether the bundled converter is there; without it no dub the page cannot decode is offered.
  constructor(private convert: () => boolean = () => false) {}
  watch = (key: string) => {
    if (this.files.has(key)) return;
    if (this.files.size >= FILES) this.files.delete(this.files.keys().next().value!);
    this.files.set(key, { cues: new Map() });
  };
  clear = () => { this.files.clear(); };
  header = (key: string) => this.files.get(key)?.header;
  // A reader for one byte range of a watched file, starting at `offset`.
  reader = (key: string, offset: number): Sink | undefined => {
    const file = this.files.get(key); if (!file) return undefined;
    const shared: Shared = { get header() { return file.header; }, onHeader: header => { file.header ??= header; }, onCue: cue => this.add(file, cue) };
    const make = (format: Watched['format']): Sink | undefined => format === 'matroska' ? new MatroskaReader(offset, shared).push : format === 'mp4' && !file.header ? new Mp4Reader(shared).push : undefined;
    if (offset !== 0) return make(file.format);
    let start: Uint8Array = new Uint8Array(0), inner: Sink | undefined, decided = false;
    return chunk => {
      if (decided) { inner?.(chunk); return; }
      const joined = new Uint8Array(start.length + chunk.length); joined.set(start); joined.set(chunk, start.length); start = joined;
      const format = sniff(start); if (!format) return;
      decided = true; file.format = format; inner = make(format); inner?.(start);
    };
  };
  private add(file: Watched, cue: TextCue) {
    let store = file.cues.get(cue.track);
    if (!store) { if (file.cues.size >= 64) return; store = { list: [], seen: new Set() }; file.cues.set(cue.track, store); }
    // The same stretch of file is read again after a seek back; a line is only kept once.
    const key = `${cue.start.toFixed(2)}|${cue.text}`;
    if (store.seen.has(key) || store.list.length >= CUES_PER_TRACK) return;
    store.seen.add(key); store.list.push(cue);
  }
  tracks = (url: string): MediaTracks | null => {
    const key = keyOf(url), file = key ? this.files.get(key) : undefined;
    if (!file || !file.format) return null;
    if (file.format === 'other') return { format: 'other', duration: 0, tracks: [] };
    const header = file.header; if (!header) return null;
    const picture = header.tracks.find(t => t.type === 'video');
    const video = picture && FAMILIES.has(picture.codec) && this.convert() ? picture.codec as VideoFamily : undefined;
    let audio = 0, subtitle = 0;
    const tracks: MediaTrack[] = header.tracks.filter(t => t.type !== 'video').slice(0, 64).map(t => ({
      id: t.id, index: t.index, order: t.type === 'audio' ? audio++ : subtitle++, kind: t.type as 'audio' | 'subtitle', codec: t.codec,
      language: t.language, name: t.name, ...(t.channels ? { channels: t.channels } : {}), default: t.default, forced: t.forced,
      text: t.type === 'subtitle' && header.format === 'matroska' && TEXT_CODECS.has(t.codec)
    }));
    return { format: header.format, duration: header.duration, ...(video ? { video } : {}), tracks };
  };
  // Lines of one subtitle track in the order they were read, from `since` on; the page keeps `next`.
  cues = (url: string, track: number, since: number): CueBatch => {
    const key = keyOf(url), list = key ? this.files.get(key)?.cues.get(track)?.list : undefined;
    if (!list) return { cues: [], next: since };
    const part = list.slice(since, since + BATCH);
    return { cues: part.map(({ start, end, text }) => ({ start, end, text })), next: since + part.length };
  };
}
