// Where a film's subtitle set is kept (models.ts SavedSubtitles): one small JSON file per account and film in the
// app's data folder. The file name is a hash of the account and the film's key, so nothing about the film shows in a
// file name and one account cannot read another's. Only subtitle text and choices are stored, never an address.
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { atomicWrite, remove } from '../../runtime/storage';
import type { SavedSubtitles } from '../../core/models';
import { cleanSaved } from '../../core/subtitles';

export class SubtitleShelf {
  constructor(private dir: string) {}
  private file(profile: string, key: string) { return path.join(this.dir, `subtitles-${createHash('sha256').update(`${profile}\0${key}`).digest('hex').slice(0, 32)}.json`); }
  read = async (profile: string, key: string): Promise<SavedSubtitles | null> => {
    try { return cleanSaved(JSON.parse(await promisify(fs.readFile)(this.file(profile, key), 'utf8'))); } catch { return null; }
  };
  write = async (profile: string, key: string, saved: SavedSubtitles): Promise<void> => { await atomicWrite(this.file(profile, key), JSON.stringify(saved)); };
  delete = async (profile: string, key: string): Promise<void> => { await remove(this.file(profile, key)); };
  // Forgetting the account on this Mac takes every saved set with it.
  clear = async (): Promise<void> => {
    try { for (const name of await promisify(fs.readdir)(this.dir)) if (/^subtitles-[a-f0-9]{32}\.json$/.test(name)) await remove(path.join(this.dir, name)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  };
}
