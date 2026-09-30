import { object, text } from './errors';
import type { Programme } from './models';

// Providers return either UTF-8 base64 or ordinary text. Never render provider HTML.
export function decodeText(value: unknown): string {
  const s = text(value, 20000);
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return s;
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0, n = 0, encoded = '';
    for (const c of s.replace(/=+$/, '')) {
      bits = (bits << 6) | alphabet.indexOf(c); n += 6;
      if (n >= 8) { n -= 8; encoded += '%' + ((bits >>> n) & 255).toString(16).padStart(2, '0'); }
    }
    const decoded = decodeURIComponent(encoded);
    return /[\x00-\x08\x0e-\x1f]/.test(decoded) ? s : decoded;
  } catch { return s; }
}
export function normalizeEpg(value: unknown): Programme[] {
  const rows = object(value).epg_listings;
  if (!Array.isArray(rows)) return [];
  return rows.map((entry, index) => {
    const row = object(entry);
    const stamp = (v: unknown, fallback: unknown) => {
      const number = Number(v);
      if (Number.isFinite(number) && number > 0) return number > 1e12 ? number : number * 1000;
      // Provider wall-clock values without timezone are deliberately treated as local time.
      return Date.parse(text(fallback).replace(' ', 'T'));
    };
    return { id: text(row.id) || String(index), title: decodeText(row.title) || 'Program bilgisi yok', description: decodeText(row.description), start: stamp(row.start_timestamp, row.start), end: stamp(row.stop_timestamp ?? row.end_timestamp, row.end) };
  }).filter(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
    .sort((a, b) => a.start - b.start);
}
