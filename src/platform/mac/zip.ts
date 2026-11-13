// A subtitle that comes in a .zip (SubDL sends every one that way): pick the subtitle file out of the archive.
// Only what such an archive holds is supported: stored or deflated entries, no encryption, no zip64.
import { inflateRawSync } from 'zlib';

export interface ZipEntry { name: string; data: Buffer }
const MAX_ENTRY = 2 * 1024 * 1024;
export const isZip = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
export const isRar = (bytes: Uint8Array) => bytes.length > 4 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21;

// The subtitle files in the archive, in the archive's own order, with the contents of the one asked for. A season
// pack holds one per episode, so `episode` picks the one named for it; otherwise the first is taken.
export function subtitleFromZip(zip: Buffer, episode?: number): ZipEntry | undefined {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) return undefined;
  const count = zip.readUInt16LE(end + 10); let at = zip.readUInt32LE(end + 16);
  const found: Array<{ name: string; method: number; size: number; packed: number; local: number }> = [];
  for (let i = 0; i < count && at + 46 <= zip.length && zip.readUInt32LE(at) === 0x02014b50; i++) {
    const nameLength = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (/\.(?:srt|vtt)$/i.test(name) && !/(?:^|\/)(?:__MACOSX|\.)/.test(name) && !(zip.readUInt16LE(at + 8) & 1)) {
      found.push({ name, method: zip.readUInt16LE(at + 10), packed: zip.readUInt32LE(at + 20), size: zip.readUInt32LE(at + 24), local: zip.readUInt32LE(at + 42) });
    }
    at += 46 + nameLength + extra + comment;
  }
  if (!found.length) return undefined;
  const tagged = episode ? found.find(f => new RegExp(`(?:s\\d{1,2}[ ._-]?e|\\be|\\d{1,2}x|[ ._-])0*${episode}(?!\\d)`, 'i').test(f.name.replace(/^.*\//, '').replace(/\d{3,4}p|x26[45]|h26[45]|\b(?:19|20)\d\d\b/gi, ''))) : undefined;
  const pick = tagged || found[0];
  if (pick.size > MAX_ENTRY || pick.local + 30 > zip.length || zip.readUInt32LE(pick.local) !== 0x04034b50) return undefined;
  const start = pick.local + 30 + zip.readUInt16LE(pick.local + 26) + zip.readUInt16LE(pick.local + 28);
  const body = zip.subarray(start, start + pick.packed);
  try {
    const data = pick.method === 0 ? Buffer.from(body) : pick.method === 8 ? inflateRawSync(body, { maxOutputLength: MAX_ENTRY }) : undefined;
    return data ? { name: pick.name.replace(/^.*\//, ''), data } : undefined;
  } catch { return undefined; }
}
