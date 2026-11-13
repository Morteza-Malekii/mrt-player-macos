// Audio languages and subtitle files for films and episodes. Pure functions only: the player
// reads the tracks off the video element and hands their language codes and a file's bytes here.
import type { MediaTrack, VideoFamily } from './models';

// Containers say `tur`, `per` or `tr` for the same language. One key per language ('tr', 'fa'),
// or '' when the file does not say, so a remembered choice can be matched across titles.
export function languageKey(code: string | undefined): string {
  const raw = (code || '').trim();
  if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*$/.test(raw)) return '';
  try { const key = Intl.getCanonicalLocales(raw.replace('_', '-'))[0].split('-')[0].toLowerCase(); return key === 'und' ? '' : key; }
  catch { return ''; }
}
export function languageName(key: string): string {
  try { return new Intl.DisplayNames('tr', { type: 'language' }).of(key) || key.toUpperCase(); }
  catch { return key.toUpperCase(); }
}
// A name per track in list order: the language, or "Parça n" when the file does not say. Two tracks
// in one language (a stereo and a surround mix, say) get a number so they can be told apart.
export function trackNames(languages: Array<string | undefined>): string[] {
  const keys = languages.map(languageKey), total = new Map<string, number>(), seen = new Map<string, number>();
  for (const key of keys) total.set(key, (total.get(key) || 0) + 1);
  return keys.map((key, index) => {
    if (!key) return `Parça ${index + 1}`;
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    return total.get(key)! > 1 ? `${languageName(key)} ${n}` : languageName(key);
  });
}
// The track to start on: the first one in the language the viewer chose last time, or -1 to
// leave the file's own default alone.
export function preferredTrack(languages: Array<string | undefined>, wanted: string | undefined): number {
  return wanted ? languages.findIndex(code => languageKey(code) === wanted) : -1;
}

// Names for the tracks a file lists (see MediaTrack): the language, then what the file calls the track
// ("SDH", "Latin American", "Commentary") unless that only repeats the language, then the channel layout
// of a surround dub. A forced subtitle (signs and foreign lines only) says so. Two tracks that would still
// read the same get a number.
const english = (key: string) => { try { return new Intl.DisplayNames('en', { type: 'language' }).of(key) || ''; } catch { return ''; } };
const layout = (channels?: number) => !channels || channels <= 2 ? '' : channels === 6 ? '5.1' : channels === 8 ? '7.1' : `${channels} kanal`;
export function mediaTrackNames(tracks: Array<Pick<MediaTrack, 'language' | 'name' | 'channels' | 'forced' | 'order'>>): string[] {
  const names = tracks.map(t => {
    const key = languageKey(t.language), language = key ? languageName(key) : '';
    const same = (value: string) => [language, key ? english(key) : '', t.language].some(other => other && other.toLocaleLowerCase('tr') === value.toLocaleLowerCase('tr'));
    const name = t.name && !same(t.name) ? t.name : '';
    const parts = [language, name, layout(t.channels), t.forced && !/forced|zorunlu/i.test(t.name) ? 'zorunlu' : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : `Parça ${t.order + 1}`;
  });
  const total = new Map<string, number>(), seen = new Map<string, number>();
  for (const name of names) total.set(name, (total.get(name) || 0) + 1);
  return names.map(name => { if (total.get(name)! < 2) return name; const n = (seen.get(name) || 0) + 1; seen.set(name, n); return `${name} ${n}`; });
}
// Where a listed dub sits in the video element's own list, or -1 when Chromium does not offer it (a codec
// it cannot decode). Chromium numbers its tracks from 1 in file order; MP4 may use the file's track id.
export function nativeIndex(track: Pick<MediaTrack, 'id' | 'index' | 'language'>, natives: Array<{ id: string; language: string }>): number {
  return natives.findIndex(n => (n.id === String(track.index + 1) || n.id === String(track.id)) && languageKey(n.language) === languageKey(track.language));
}
// The dub a title starts on: the language chosen last time, else the one the file marks as default.
export function startingTrack<T extends Pick<MediaTrack, 'language' | 'default'>>(audio: T[], wanted: string | undefined): T | undefined {
  return (wanted ? audio.find(t => languageKey(t.language) === wanted) : undefined) || audio.find(t => t.default) || audio[0];
}
// What the converter hands the page (platform/mac/remux.ts): the picture as it is in the file, AAC sound.
// Chromium checks the kind of codec, not the profile or level, so one string per kind is enough.
const FAMILY: Record<VideoFamily, string> = { avc: 'avc1.640033', hevc: 'hvc1.1.6.L93.B0', av1: 'av01.0.08M.08', vp9: 'vp09.00.40.08' };
export const remuxType = (video: VideoFamily) => `video/mp4; codecs="${FAMILY[video]},mp4a.40.2"`;
export const canRemux = (video: VideoFamily | undefined): video is VideoFamily => { try { return !!video && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(remuxType(video)); } catch { return false; } };

export interface Cue { start: number; end: number; text: string }
export const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;
// Subtitle files in the wild are UTF-8, UTF-16, or an old single-byte code page. Turkish files are
// mostly windows-1254 and Persian ones windows-1256; the two are told apart by how much of the file
// is high bytes, since Persian letters are all high and Turkish has only a few accents.
export function decodeSubtitles(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* not UTF-8 */ }
  let high = 0;
  for (const byte of bytes) if (byte >= 0x80) high++;
  return new TextDecoder(high / Math.max(1, bytes.length) > 0.15 ? 'windows-1256' : 'windows-1254').decode(bytes);
}
const STAMP = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
const seconds = (m: RegExpMatchArray) => Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
// SRT and WebVTT read the same way here: blocks split by blank lines, one `start --> end` line each,
// then the text. Cue settings after the end time and `{\an8}` style positioning tags are dropped;
// WebVTT's own <i>, <b>, <u> are kept because the video element renders them.
export function parseSubtitles(source: string, max = 20000): Cue[] {
  const cues: Cue[] = [];
  for (const block of source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n'), at = lines.findIndex(line => line.includes('-->'));
    if (at < 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const [from, to] = lines[at].split('-->'), start = STAMP.exec(from), end = STAMP.exec(to || '');
    if (!start || !end) continue;
    const text = lines.slice(at + 1).join('\n').replace(/\{\\[^}]*\}/g, '').trim();
    if (!text || seconds(end) <= seconds(start)) continue;
    cues.push({ start: seconds(start), end: seconds(end), text });
    if (cues.length >= max) break;
  }
  return cues;
}
