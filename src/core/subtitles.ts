// Subtitles from the internet: which languages, in what order, and how a list of finds is ranked. Pure
// functions only (no network, no 64-bit numbers) so they can be tested without a service. The services
// themselves are in platform/mac/subtitles.ts.
import type { SubtitleHit, SubtitleLanguage } from './models';

// The viewer's order of preference: English first, then Persian, then Turkish.
export const SUBTITLE_LANGUAGES: SubtitleLanguage[] = ['en', 'fa', 'tr'];
export const SUBTITLE_LANGUAGE_NAMES: Record<SubtitleLanguage, string> = { en: 'İngilizce', fa: 'Farsça', tr: 'Türkçe' };
// How many finds of one language are kept; more than this is scrolling, not choosing.
export const HITS_PER_LANGUAGE = 8;

// A name as the provider's list gives it ("TR | The Matrix (1999) 4K", "Show S02E05 Title") taken apart.
export interface NameParts { title: string; year?: number; season?: number; episode?: number }
const NOISE = /\b(?:2160p|1080p|1080i|720p|576p|480p|4k|uhd|fhd|hd|sd|hdr10?\+?|dv|web-?dl|web-?rip|blu-?ray|bd-?rip|br-?rip|hd-?rip|dvd-?rip|hdtv|remux|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|dts|multi|dual|dublaj|turkce|türkçe|altyaz[ıi]l[ıi])\b/gi;
export function describeName(raw: string): NameParts {
  let name = raw.replace(/\.(?:mkv|mp4|avi|ts|m4v|mov)$/i, '');
  // Only a year in brackets is a year. A bare one may be the title ("Blade Runner 2049", "Wonder Woman 1984"), so it stays in it.
  const years = Array.from(name.matchAll(/[([](19\d\d|20\d\d)[)\]]/g)), found = years.length ? Number(years[years.length - 1][1]) : undefined;
  const tag = /\bS(\d{1,2})[ ._-]?E(\d{1,3})\b/i.exec(name) || /\b(\d{1,2})x(\d{2,3})\b/i.exec(name);
  if (tag) name = name.slice(0, tag.index);
  name = name.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  // "TR | ", "EN - ", "|TR|": a language or country prefix the provider puts in front of the title.
  name = name.replace(/^\s*(?:\|?[A-Za-z]{2,3}\|\s*|[A-Za-z]{2,3}\s*[|:–-]\s+)+/, '');
  name = name.replace(/[._]+/g, ' ').replace(NOISE, ' ').replace(/[|]+/g, ' ').replace(/\s*[-–:]\s*$/, ' ').replace(/\s+/g, ' ').trim();
  return { title: name, ...(found ? { year: found } : {}), ...(tag ? { season: Number(tag[1]), episode: Number(tag[2]) } : {}) };
}

// The words of a release name that say something about the file: its quality, source, codec and release group.
const words = (value: string) => new Set(value.toLowerCase().replace(/web[ ._-]?dl/g, 'webdl').replace(/blu[ ._-]?ray/g, 'bluray').replace(/h[ .]?26([45])/g, 'x26$1').replace(/hevc/g, 'x265').split(/[^a-z0-9]+/).filter(w => w.length > 1));
// How much a subtitle's release name looks like the file's name. Only counts what a release name is made of, so
// the title words every candidate shares do not tip the scale.
export function releaseScore(release: string, hint: string): number {
  const own = words(release), other = words(hint);
  let score = 0;
  for (const word of own) if (other.has(word) && /^(?:\d{3,4}p|webdl|webrip|bluray|brrip|bdrip|hdrip|hdtv|dvdrip|remux|x264|x265|av1|amzn|nf|atvp|dsnp|hmax|hulu|[a-z]{2,10}\d?)$/.test(word)) score++;
  return score;
}

// Finds from every service in one list: language first (English, Persian, Turkish), and inside a language the
// ones made for exactly this file, then the ones whose release name fits, then the most downloaded. A subtitle
// found by two services is listed once.
export function rankHits(hits: SubtitleHit[], hint: string, perLanguage = HITS_PER_LANGUAGE): SubtitleHit[] {
  const scored = hits.filter(h => SUBTITLE_LANGUAGES.includes(h.language)).map(h => ({ h, score: releaseScore(h.release, hint) }));
  scored.sort((a, b) => SUBTITLE_LANGUAGES.indexOf(a.h.language) - SUBTITLE_LANGUAGES.indexOf(b.h.language)
    || Number(b.h.hash) - Number(a.h.hash) || b.score - a.score || Number(b.h.trusted) - Number(a.h.trusted) || b.h.downloads - a.h.downloads);
  const taken = new Map<SubtitleLanguage, number>(), seen = new Set<string>(), out: SubtitleHit[] = [];
  for (const { h } of scored) {
    const key = `${h.language}|${h.release.toLowerCase()}|${h.hearingImpaired}`;
    if (seen.has(key) && !h.hash) continue;
    const n = taken.get(h.language) || 0; if (n >= perLanguage) continue;
    seen.add(key); taken.set(h.language, n + 1); out.push(h);
  }
  return out;
}

// A subtitle is timed against one cut of the film. When its last line ends well past the end of the file, it
// was made for a longer cut (or a different frame rate), and the lines drift. Ending early says little, since
// credits run without dialogue, so only a clearly short one is mentioned.
export function fitNote(lastEnd: number, duration: number): string {
  if (!(duration > 120) || !(lastEnd > 0)) return '';
  if (lastEnd > duration * 1.03 + 5) return 'Bu altyazı filmin süresinden uzun; başka bir sürüm için yapılmış olabilir. Satırlar kayıyorsa listeden başkasını deneyin.';
  if (lastEnd < duration * 0.5) return 'Bu altyazı filmin yalnızca ilk yarısını kapsıyor olabilir.';
  return '';
}
