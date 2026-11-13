// Reads what a film file holds while the player streams it: the list of tracks from the header, and the
// text subtitles from the body. Chromium plays Matroska and MP4 but tells the page nothing about subtitle
// tracks and leaves out any dub it cannot decode, so the file is read here, on the bytes that already pass
// through for playback: no second connection to the provider and nothing read twice.
//
// Every reader sees one byte range (one request) of the file. The player asks for the start first, then
// jumps (a seek, the index at the end), so a reader that starts mid-file looks for the next cluster first.
import { inflateSync } from 'zlib';

export type TrackType = 'video' | 'audio' | 'subtitle';
export interface ContainerTrack { id: number; index: number; type: TrackType; codec: string; language: string; name: string; default: boolean; forced: boolean; channels?: number; compression?: { algo: number; settings?: Uint8Array } }
export interface ContainerHeader { format: 'matroska' | 'mp4'; duration: number; tracks: ContainerTrack[]; scale: number }
export interface TextCue { track: number; start: number; end: number; text: string }
export type Sink = (chunk: Uint8Array) => void;

const utf8 = new TextDecoder('utf-8');
// Track names and languages come from the file; keep them short and free of control characters.
const clean = (value: string, max = 80) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// ---- Matroska (EBML) ----------------------------------------------------------------------------------
const M = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675,
  Cues: 0x1c53bb6b, Chapters: 0x1043a770, Tags: 0x1254c367, Attachments: 0x1941a469, Void: 0xec, CRC: 0xbf,
  TimecodeScale: 0x2ad7b1, Duration: 0x4489, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83, FlagDefault: 0x88,
  FlagForced: 0x55aa, CodecID: 0x86, Language: 0x22b59c, LanguageBCP47: 0x22b59d, Name: 0x536e, Audio: 0xe1, Channels: 0x9f,
  ContentEncodings: 0x6d80, ContentEncoding: 0x6240, ContentCompression: 0x5034, ContentCompAlgo: 0x4254,
  ContentCompSettings: 0x4255, ContentEncryption: 0x5035,
  Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b
};
const LEVEL1 = new Set([M.SeekHead, M.Info, M.Tracks, M.Cluster, M.Cues, M.Chapters, M.Tags, M.Attachments]);
const BLOCK_LIMIT = 256 * 1024;

// A variable-size integer: the leading zero bits of the first byte give the length. IDs keep the marker
// bit, sizes drop it; a size of all ones means "unknown" (a live or still-growing file).
function vint(b: Uint8Array, at: number, marker: boolean): { value: number; length: number; unknown: boolean } | null | 'bad' {
  if (at >= b.length) return null;
  const first = b[at];
  if (first === 0) return 'bad';
  const length = Math.clz32(first) - 23;
  if (length > (marker ? 4 : 8)) return 'bad';
  if (at + length > b.length) return null;
  let value = marker ? first : first & (0xff >> length), ones = (first & (0xff >> length)) === (0xff >> length);
  for (let i = 1; i < length; i++) { value = value * 256 + b[at + i]; if (b[at + i] !== 0xff) ones = false; }
  return { value, length, unknown: !marker && ones };
}
const uint = (b: Uint8Array) => { let v = 0; for (const byte of b) v = v * 256 + byte; return v; };
const float = (b: Uint8Array) => { const view = new DataView(b.buffer, b.byteOffset, b.byteLength); return b.length === 4 ? view.getFloat32(0) : b.length === 8 ? view.getFloat64(0) : 0; };
// The children of an element whose whole body is in memory.
function* children(b: Uint8Array, start = 0, end = b.length): Generator<{ id: number; data: Uint8Array }> {
  let at = start;
  while (at < end) {
    const id = vint(b, at, true); if (!id || id === 'bad') return;
    const size = vint(b, at + id.length, false); if (!size || size === 'bad' || size.unknown) return;
    const from = at + id.length + size.length, to = from + size.value;
    if (to > end) return;
    yield { id: id.value, data: b.subarray(from, to) };
    at = to;
  }
}
const MATROSKA_CODECS: Array<[RegExp, string]> = [
  [/^A_AAC/, 'aac'], [/^A_AC3/, 'ac3'], [/^A_EAC3/, 'eac3'], [/^A_DTS/, 'dts'], [/^A_TRUEHD/, 'truehd'], [/^A_OPUS/, 'opus'],
  [/^A_FLAC/, 'flac'], [/^A_VORBIS/, 'vorbis'], [/^A_MPEG\/L3/, 'mp3'], [/^A_MPEG\/L2/, 'mp2'], [/^A_PCM/, 'pcm'],
  [/^S_TEXT\/(UTF8|ASCII)/, 'srt'], [/^S_(TEXT\/)?(ASS|SSA)/, 'ass'], [/^S_TEXT\/WEBVTT/, 'webvtt'], [/^S_HDMV\/PGS/, 'pgs'],
  [/^S_VOBSUB/, 'vobsub'], [/^S_DVBSUB/, 'dvbsub'], [/^V_MPEG4\/ISO\/AVC/, 'avc'], [/^V_MPEGH\/ISO\/HEVC/, 'hevc'], [/^V_AV1/, 'av1'], [/^V_VP9/, 'vp9']
];
const matroskaCodec = (id: string) => MATROSKA_CODECS.find(([pattern]) => pattern.test(id))?.[1] || id.toLowerCase().slice(0, 24);
export const TEXT_CODECS = new Set(['srt', 'ass', 'webvtt']);

function matroskaTracks(body: Uint8Array): ContainerTrack[] {
  const tracks: ContainerTrack[] = [];
  for (const entry of children(body)) {
    if (entry.id !== M.TrackEntry) continue;
    const t: ContainerTrack & { kind?: number; encrypted?: boolean } = { id: 0, index: tracks.length, type: 'video', codec: '', language: 'eng', name: '', default: true, forced: false };
    let bcp47 = '';
    for (const { id, data } of children(entry.data)) {
      if (id === M.TrackNumber) t.id = uint(data);
      else if (id === M.TrackType) t.kind = uint(data);
      else if (id === M.FlagDefault) t.default = uint(data) === 1;
      else if (id === M.FlagForced) t.forced = uint(data) === 1;
      else if (id === M.CodecID) t.codec = matroskaCodec(utf8.decode(data).replace(/\0+$/, ''));
      else if (id === M.Language) t.language = clean(utf8.decode(data).replace(/\0+$/, ''), 16);
      else if (id === M.LanguageBCP47) bcp47 = clean(utf8.decode(data).replace(/\0+$/, ''), 35);
      else if (id === M.Name) t.name = clean(utf8.decode(data));
      else if (id === M.Audio) for (const a of children(data)) { if (a.id === M.Channels) t.channels = uint(a.data); }
      else if (id === M.ContentEncodings) for (const e of children(data)) {
        if (e.id !== M.ContentEncoding) continue;
        for (const c of children(e.data)) {
          if (c.id === M.ContentEncryption) t.encrypted = true;
          if (c.id === M.ContentCompression) { const z: { algo: number; settings?: Uint8Array } = { algo: 0 }; for (const k of children(c.data)) { if (k.id === M.ContentCompAlgo) z.algo = uint(k.data); if (k.id === M.ContentCompSettings) z.settings = k.data.slice(); } t.compression = z; }
        }
      }
    }
    if (bcp47) t.language = bcp47;
    const type: TrackType | undefined = t.kind === 1 ? 'video' : t.kind === 2 ? 'audio' : t.kind === 17 ? 'subtitle' : undefined;
    // A track of another kind (buttons, metadata) gets no stream in the player, so it takes no place in
    // `index`, which has to count the way the player's own track list does.
    if (!type || t.encrypted) continue;
    tracks.push({ id: t.id, index: t.index, type, codec: t.codec, language: t.language, name: t.name, default: t.default, forced: t.forced, ...(type === 'audio' ? { channels: t.channels || 1 } : {}), ...(t.compression ? { compression: t.compression } : {}) });
  }
  return tracks;
}
function matroskaInfo(body: Uint8Array) {
  let scale = 1000000, duration = 0;
  for (const { id, data } of children(body)) { if (id === M.TimecodeScale) scale = uint(data) || 1000000; if (id === M.Duration) duration = float(data); }
  return { scale, seconds: duration * scale / 1e9 };
}
// Matroska keeps an ASS event without its time: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV,
// Effect, Text. Only the text is shown; override blocks ({\b1}, {\pos(..)}) are styling, and drawing mode
// ({\p1}) is vector art, not words.
export function assText(line: string): string {
  const parts = line.split(','); if (parts.length < 9) return '';
  const text = parts.slice(8).join(',');
  if (/\{[^}]*\\p[1-9]/.test(text)) return '';
  return text.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
}
const cueText = (codec: string, raw: string) => (codec === 'ass' ? assText(raw) : raw.replace(/\{\\[^}]*\}/g, '')).replace(/\r\n?/g, '\n').replace(/\0+$/, '').trim().slice(0, 2000);

export interface Shared { header?: ContainerHeader; onHeader(header: ContainerHeader): void; onCue(cue: TextCue): void }

export class MatroskaReader {
  private buffer: Uint8Array = new Uint8Array(0);
  private skip = 0;
  private scanning: boolean;
  private cluster?: { end: number; time: number };
  private group?: { end: number; block?: Uint8Array; duration?: number };
  private info?: { scale: number; seconds: number };
  dead = false;
  constructor(private position: number, private shared: Shared) { this.scanning = position !== 0; }
  push: Sink = chunk => {
    if (this.dead) return;
    this.buffer = this.buffer.length ? concat(this.buffer, chunk) : chunk;
    try { this.drain(); } catch { this.dead = true; }
  };
  private advance(n: number) { this.buffer = this.buffer.subarray(n); this.position += n; }
  private lose() { this.cluster = undefined; this.group = undefined; this.scanning = true; this.advance(1); }
  private drain() {
    for (;;) {
      if (this.skip > 0) { const n = Math.min(this.skip, this.buffer.length); this.advance(n); this.skip -= n; if (this.skip > 0) return; }
      if (this.scanning && !this.scan()) return;
      if (this.group && this.position >= this.group.end) this.endGroup();
      if (this.cluster && this.position >= this.cluster.end) this.cluster = undefined;
      const b = this.buffer, id = vint(b, 0, true);
      if (id === null) return; if (id === 'bad') { this.lose(); continue; }
      const size = vint(b, id.length, false);
      if (size === null) return; if (size === 'bad') { this.lose(); continue; }
      const head = id.length + size.length, known = !size.unknown, length = size.value, end = known ? this.position + head + length : Infinity;
      // Only small elements are kept whole; anything big is passed over without being held.
      const take = (limit: number, use: (data: Uint8Array) => void): boolean | 'wait' => {
        if (!known || length > limit) return false;
        if (b.length < head + length) return 'wait';
        use(b.subarray(head, head + length)); this.advance(head + length); return true;
      };
      const pass = () => { if (!known) { this.lose(); return; } this.advance(Math.min(head, b.length)); this.skip = length; };
      if (this.group) {
        if (id.value === M.Block) {
          const wanted = this.wanted(b, head);
          if (wanted === 'wait') return;
          if (wanted) { const r = take(BLOCK_LIMIT, data => { this.group!.block = data.slice(); }); if (r === 'wait') return; if (r) continue; }
          pass(); continue;
        }
        if (id.value === M.BlockDuration) { const r = take(8, data => { this.group!.duration = uint(data); }); if (r === 'wait') return; if (r) continue; }
        pass(); continue;
      }
      if (this.cluster) {
        // A cluster of unknown size ends where the next top-level element starts.
        if (LEVEL1.has(id.value) || id.value === M.EBML) { this.cluster = undefined; continue; }
        if (id.value === M.Timecode) { const r = take(8, data => { this.cluster!.time = uint(data); }); if (r === 'wait') return; if (r) continue; pass(); continue; }
        if (id.value === M.BlockGroup) { if (!known) { this.lose(); continue; } this.advance(head); this.group = { end }; continue; }
        if (id.value === M.SimpleBlock) {
          const wanted = this.wanted(b, head);
          if (wanted === 'wait') return;
          if (wanted) { const r = take(BLOCK_LIMIT, data => this.block(data)); if (r === 'wait') return; if (r) continue; }
          pass(); continue;
        }
        pass(); continue;
      }
      if (id.value === M.Segment) { this.advance(head); continue; }
      if (id.value === M.Cluster) { this.advance(head); this.cluster = { end, time: 0 }; continue; }
      if (id.value === M.Info) { const r = take(1 << 20, data => { this.info = matroskaInfo(data); }); if (r === 'wait') return; if (r) continue; pass(); continue; }
      if (id.value === M.Tracks) {
        const r = take(16 << 20, data => {
          const info = this.info || { scale: 1000000, seconds: 0 };
          this.shared.onHeader({ format: 'matroska', duration: info.seconds, scale: info.scale, tracks: matroskaTracks(data) });
        });
        if (r === 'wait') return; if (r) continue; pass(); continue;
      }
      if (LEVEL1.has(id.value) || id.value === M.EBML || id.value === M.Void || id.value === M.CRC) { pass(); continue; }
      this.lose();
    }
  }
  // Whether a block belongs to a text subtitle track: its track number is the first thing in it.
  private wanted(b: Uint8Array, head: number): boolean | 'wait' {
    const track = vint(b, head, false);
    if (track === null) return 'wait';
    if (track === 'bad') return false;
    const t = this.shared.header?.tracks.find(row => row.id === track.value);
    return !!t && t.type === 'subtitle' && TEXT_CODECS.has(t.codec);
  }
  private endGroup() { const g = this.group!; this.group = undefined; if (g.block) this.block(g.block, g.duration); }
  private block(data: Uint8Array, duration?: number) {
    const header = this.shared.header; if (!header || !this.cluster) return;
    const track = vint(data, 0, false); if (!track || track === 'bad' || data.length < track.length + 3) return;
    const t = header.tracks.find(row => row.id === track.value); if (!t || t.type !== 'subtitle' || !TEXT_CODECS.has(t.codec)) return;
    const flags = data[track.length + 2]; if (flags & 0x06) return; // laced: never used for subtitles
    const relative = new DataView(data.buffer, data.byteOffset + track.length, 2).getInt16(0);
    let payload = data.subarray(track.length + 3);
    if (t.compression) {
      if (t.compression.algo === 0) { try { payload = inflateSync(payload); } catch { return; } }
      else if (t.compression.algo === 3) payload = concat(t.compression.settings || new Uint8Array(0), payload);
      else return;
    }
    const start = (this.cluster.time + relative) * header.scale / 1e9;
    const end = duration ? start + duration * header.scale / 1e9 : start + 4;
    const text = cueText(t.codec, utf8.decode(payload));
    if (text && end > start && start >= 0) this.shared.onCue({ track: t.id, start, end, text });
  }
  // Mid-file the reader looks for a cluster whose first child is its timecode (after a checksum, which
  // FFmpeg writes first), which is how every muxer writes one; that rules out a chance match of the four
  // ID bytes inside picture data.
  private scan(): boolean {
    const b = this.buffer;
    for (let i = 0; i + 4 <= b.length; i++) {
      if (b[i] !== 0x1f || b[i + 1] !== 0x43 || b[i + 2] !== 0xb6 || b[i + 3] !== 0x75) continue;
      const size = vint(b, i + 4, false);
      if (size === null) { this.advance(i); return false; }
      if (size === 'bad') continue;
      let at = i + 4 + size.length;
      if (at + 7 > b.length) { this.advance(i); return false; }
      if (b[at] === 0xbf && b[at + 1] === 0x84) at += 6;
      if (b[at] !== 0xe7) continue;
      const inner = vint(b, at + 1, false);
      if (inner === null) { this.advance(i); return false; }
      if (inner === 'bad' || inner.unknown || inner.value > 8) continue;
      this.advance(i); this.scanning = false; return true;
    }
    this.advance(Math.max(0, b.length - 3));
    return false;
  }
}

// ---- MP4 (ISO BMFF) -----------------------------------------------------------------------------------
// Only the header box (`moov`) is read, for the track list. The player asks for it where it sits, at the
// start or the end of the file, so a reader that does not open on a box simply stops.
const TOP = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid', 'moof', 'mfra', 'sidx', 'styp', 'pdin', 'meta', 'prft', 'emsg']);
const MP4_CODECS: Record<string, string> = { mp4a: 'aac', 'ac-3': 'ac3', 'ec-3': 'eac3', dtsc: 'dts', dtsh: 'dts', dtsl: 'dts', dtse: 'dts', Opus: 'opus', fLaC: 'flac', alac: 'alac', '.mp3': 'mp3', tx3g: 'tx3g', wvtt: 'webvtt', stpp: 'ttml', c608: 'cea608', avc1: 'avc', avc3: 'avc', hvc1: 'hevc', hev1: 'hevc', av01: 'av1', vp09: 'vp9', mp4v: 'mpeg4' };
function* boxes(b: Uint8Array, start = 0, end = b.length): Generator<{ type: string; data: Uint8Array }> {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at), head = 8;
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (size === 1) { if (at + 16 > end) return; size = Number(view.getBigUint64(at + 8)); head = 16; }
    else if (size === 0) size = end - at;
    if (size < head || at + size > end) return;
    yield { type, data: b.subarray(at + head, at + size) };
    at += size;
  }
}
const child = (b: Uint8Array, type: string) => { for (const box of boxes(b)) if (box.type === type) return box.data; return undefined; };
const u32 = (b: Uint8Array, at: number) => at + 4 <= b.length ? new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at) : 0;
const u16 = (b: Uint8Array, at: number) => at + 2 <= b.length ? new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(at) : 0;
// A handler name that only says what kind of track it is tells the viewer nothing.
const GENERIC = /^(sound|video|subtitle|text|closed caption|timed text|core media \w+|apple \w+ media handler|gpac \w+ handler|l-smash \w+ handler|mainconcept \w+ handler|\w*handler)$/i;
export function mp4Header(moov: Uint8Array): ContainerHeader {
  let duration = 0;
  const mvhd = child(moov, 'mvhd');
  if (mvhd) { const v1 = mvhd[0] === 1, scale = u32(mvhd, v1 ? 20 : 12), length = v1 ? Number(new DataView(mvhd.buffer, mvhd.byteOffset).getBigUint64(24)) : u32(mvhd, 16); duration = scale ? length / scale : 0; }
  const tracks: ContainerTrack[] = [];
  const seen = new Set<string>();
  for (const box of boxes(moov)) {
    if (box.type !== 'trak') continue;
    const tkhd = child(box.data, 'tkhd'), mdia = child(box.data, 'mdia');
    if (!tkhd || !mdia) continue;
    const id = u32(tkhd, tkhd[0] === 1 ? 20 : 12), enabled = (tkhd[3] & 1) === 1;
    const mdhd = child(mdia, 'mdhd'), hdlr = child(mdia, 'hdlr'), stsd = child(child(child(mdia, 'minf') || new Uint8Array(0), 'stbl') || new Uint8Array(0), 'stsd');
    const handler = hdlr ? String.fromCharCode(...hdlr.subarray(8, 12)) : '';
    const type: TrackType | undefined = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : ['sbtl', 'text', 'subt', 'clcp'].includes(handler) ? 'subtitle' : undefined;
    let language = 'und';
    if (mdhd) { const packed = u16(mdhd, mdhd[0] === 1 ? 32 : 20); if (packed && packed !== 0x7fff) language = String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60); }
    let codec = '', channels: number | undefined;
    if (stsd && stsd.length >= 16) { const entry = stsd.subarray(8); codec = String.fromCharCode(...entry.subarray(4, 8)); if (type === 'audio') channels = u16(entry, 24) || undefined; }
    if (codec === 'enca' || codec === 'encv') continue; // protected: nothing here can play it
    let name = '';
    const udta = child(box.data, 'udta'), named = udta && (child(udta, 'name') || child(udta, '©nam'));
    if (named) name = clean(utf8.decode(named[0] === 0 && named.length > 4 && u16(named, 0) < named.length ? named.subarray(4) : named).replace(/^[\0\s]+|\0+$/g, ''));
    if (!name && hdlr && hdlr.length > 24) { const raw = hdlr.subarray(24), text = clean(utf8.decode(raw[0] > 0 && raw[0] === raw.length - 1 ? raw.subarray(1) : raw).replace(/\0+$/, '')); if (!GENERIC.test(text)) name = text; }
    const kind = type || 'video';
    // MP4 has no "default" flag of its own; the first enabled track of each kind plays.
    const first = enabled && !seen.has(kind); if (first) seen.add(kind);
    tracks.push({ id, index: tracks.length, type: kind, codec: type ? MP4_CODECS[codec] || codec.toLowerCase() : 'other', language, name, default: first, forced: false, ...(type === 'audio' ? { channels } : {}) });
  }
  return { format: 'mp4', duration, scale: 1, tracks };
}
export class Mp4Reader {
  private buffer: Uint8Array = new Uint8Array(0);
  private skip = 0;
  dead = false;
  constructor(private shared: Shared) {}
  push: Sink = chunk => {
    if (this.dead) return;
    try {
      let b = this.buffer.length ? concat(this.buffer, chunk) : chunk;
      for (;;) {
        if (this.skip > 0) { const n = Math.min(this.skip, b.length); b = b.subarray(n); this.skip -= n; if (this.skip > 0) break; }
        if (b.length < 16) break;
        let size = u32(b, 0), head = 8;
        const type = String.fromCharCode(b[4], b[5], b[6], b[7]);
        if (!TOP.has(type)) { this.dead = true; return; }
        if (size === 1) { size = Number(new DataView(b.buffer, b.byteOffset).getBigUint64(8)); head = 16; }
        if (size === 0) { this.dead = true; return; } // runs to the end of the file: nothing after it
        if (size < head) { this.dead = true; return; }
        if (type !== 'moov') { this.skip = size; continue; }
        if (size > 64 << 20) { this.dead = true; return; }
        if (b.length < size) break;
        this.shared.onHeader(mp4Header(b.subarray(head, size)));
        this.dead = true; return;
      }
      this.buffer = b.length ? b.slice() : new Uint8Array(0);
    } catch { this.dead = true; }
  };
}

// Which reader suits a byte range: a range from the start says what the file is by its first bytes, a
// later range is read the way the start was.
export function sniff(first: Uint8Array): 'matroska' | 'mp4' | 'other' | undefined {
  if (first.length < 12) return undefined;
  if (first[0] === 0x1a && first[1] === 0x45 && first[2] === 0xdf && first[3] === 0xa3) return 'matroska';
  const type = String.fromCharCode(first[4], first[5], first[6], first[7]);
  return ['ftyp', 'moov', 'free', 'skip', 'wide', 'mdat'].includes(type) ? 'mp4' : 'other';
}
function concat(a: Uint8Array, b: Uint8Array): Uint8Array { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; }
