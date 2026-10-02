// Audio languages and subtitle files for films and episodes. Pure functions only: the player
// reads the tracks off the video element and hands their language codes and a file's bytes here.

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
